chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'captureScreenshot') {
    captureFullPageSimple(request.tabId)
      .then(() => sendResponse({ success: true }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }
});

async function captureFullPageSimple(tabId) {
  try {
    // Get page dimensions
    const [info] = await chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: () => {
        // Find scrollable element
        const selectors = [
          '.scaffold-layout__list-detail',
          '.scaffold-layout__list-container',
          'main',
          'div[role="main"]'
        ];
        
        let scrollTarget = null;
        for (const sel of selectors) {
          const elem = document.querySelector(sel);
          if (elem && elem.scrollHeight > elem.clientHeight) {
            scrollTarget = elem;
            break;
          }
        }
        
        window.__scrollTarget = scrollTarget;
        
        const scrollHeight = scrollTarget ? scrollTarget.scrollHeight : 
          Math.max(document.documentElement.scrollHeight, document.body.scrollHeight);
        const currentScroll = scrollTarget ? scrollTarget.scrollTop : window.scrollY;
        
        return {
          scrollHeight,
          currentScroll,
          viewportHeight: window.innerHeight,
          viewportWidth: window.innerWidth,
          dpr: window.devicePixelRatio
        };
      }
    });

    const { scrollHeight, currentScroll, viewportHeight, viewportWidth, dpr } = info.result;
    
    console.log(`Page height: ${scrollHeight}px, Viewport: ${viewportHeight}px`);

    // Scroll to top first
    await chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: () => {
        const target = window.__scrollTarget;
        if (target) {
          target.scrollTop = 0;
        } else {
          window.scrollTo(0, 0);
        }
      }
    });

    await new Promise(resolve => setTimeout(resolve, 500));

    // Capture with SMALL steps - scroll by 70% of viewport each time
    const stepSize = Math.floor(viewportHeight * 0.7);
    const screenshots = [];
    let position = 0;

    while (position < scrollHeight) {
      console.log(`Capturing at position ${position}/${scrollHeight}`);
      
      // Capture current view
      const dataUrl = await chrome.tabs.captureVisibleTab(null, { format: 'png' });
      
      screenshots.push({
        dataUrl,
        position: position
      });

      // Move to next position
      position += stepSize;
      
      if (position < scrollHeight) {
        await chrome.scripting.executeScript({
          target: { tabId: tabId },
          func: (pos) => {
            const target = window.__scrollTarget;
            if (target) {
              target.scrollTop = pos;
            } else {
              window.scrollTo(0, pos);
            }
          },
          args: [position]
        });

        await new Promise(resolve => setTimeout(resolve, 800));
      }
    }

    // Restore scroll
    await chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: (pos) => {
        const target = window.__scrollTarget;
        if (target) {
          target.scrollTop = pos;
        } else {
          window.scrollTo(0, pos);
        }
      },
      args: [currentScroll]
    });

    console.log(`Captured ${screenshots.length} screenshots, stitching...`);

    // Stitch together
    const result = await stitchSimple(screenshots, scrollHeight, viewportHeight, viewportWidth, dpr, stepSize);

    // Download
    const now = new Date();
    const filename = `fullpage_${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}-${String(now.getSeconds()).padStart(2, '0')}.png`;

    await chrome.downloads.download({
      url: result,
      filename: filename,
      saveAs: false
    });

    console.log('Done!');

  } catch (error) {
    console.error('Error:', error);
    throw error;
  }
}

async function stitchSimple(screenshots, totalHeight, viewportHeight, viewportWidth, dpr, stepSize) {
  const canvasWidth = viewportWidth * dpr;
  const canvasHeight = totalHeight * dpr;
  
  const canvas = new OffscreenCanvas(canvasWidth, canvasHeight);
  const ctx = canvas.getContext('2d');
  
  ctx.fillStyle = 'white';
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);

  // Load and draw each screenshot
  for (let i = 0; i < screenshots.length; i++) {
    const { dataUrl, position } = screenshots[i];
    const img = await loadImage(dataUrl);
    
    const y = position * dpr;
    
    // For overlapping regions, only draw the new content (top portion)
    if (i === 0) {
      // First image - draw entire thing
      ctx.drawImage(img, 0, y);
      console.log(`Drew image 0 at ${y}, full height ${img.height}`);
    } else {
      // Subsequent images - only draw the new part (skip the overlap)
      const overlapPx = (viewportHeight - stepSize) * dpr;
      const sourceY = overlapPx;
      const sourceHeight = img.height - overlapPx;
      const destY = y + overlapPx;
      
      if (sourceHeight > 0 && destY < canvasHeight) {
        ctx.drawImage(
          img,
          0, sourceY, img.width, sourceHeight,  // source: skip overlap
          0, destY, img.width, sourceHeight      // dest: place after previous
        );
        console.log(`Drew image ${i} at ${destY}, height ${sourceHeight} (skipped ${overlapPx}px overlap)`);
      }
    }
  }

  const blob = await canvas.convertToBlob({ type: 'image/png', quality: 1.0 });
  
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.readAsDataURL(blob);
  });
}

async function loadImage(dataUrl) {
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  return await createImageBitmap(blob);
}