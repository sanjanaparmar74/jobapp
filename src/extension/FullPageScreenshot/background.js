chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'captureScreenshot') {
    captureFullPageStitched(request.tabId)
      .then(() => sendResponse({ success: true }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }
});

async function captureFullPageStitched(tabId) {
  try {
    // Get initial page info
    const [pageInfo] = await chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: getPageDimensions
    });

    const { width, height, devicePixelRatio, scrollY: originalScrollY } = pageInfo.result;
    
    // Get viewport height
    const [viewportInfo] = await chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: () => ({
        viewportHeight: window.innerHeight,
        viewportWidth: window.innerWidth
      })
    });

    const { viewportHeight, viewportWidth } = viewportInfo.result;
    
    // Calculate how many screenshots we need
    const numScreenshots = Math.ceil(height / viewportHeight);
    const screenshots = [];

    console.log(`Capturing ${numScreenshots} screenshots for page of height ${height}px`);

    // Capture each section
    for (let i = 0; i < numScreenshots; i++) {
      const scrollY = i * viewportHeight;
      
      // Scroll to position
      await chrome.scripting.executeScript({
        target: { tabId: tabId },
        func: (y) => {
          window.scrollTo(0, y);
        },
        args: [scrollY]
      });

      // Wait for scroll to complete and page to render
      await new Promise(resolve => setTimeout(resolve, 600));

      // Capture visible tab
      const dataUrl = await chrome.tabs.captureVisibleTab(null, { 
        format: 'png'
      });

      screenshots.push({
        dataUrl,
        offsetY: scrollY
      });
    }

    // Restore original scroll position
    await chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: (y) => {
        window.scrollTo(0, y);
      },
      args: [originalScrollY]
    });

    // Stitch images together
    const stitchedImage = await stitchScreenshots(screenshots, width, height, viewportHeight, viewportWidth, devicePixelRatio);

    // Generate filename
    const now = new Date();
    const filename = `fullpage_${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}-${String(now.getSeconds()).padStart(2, '0')}.png`;

    // Download
    await chrome.downloads.download({
      url: stitchedImage,
      filename: filename,
      saveAs: false
    });

    console.log('Full page screenshot saved!');

  } catch (error) {
    console.error('Screenshot capture failed:', error);
    throw error;
  }
}

function getPageDimensions() {
  return {
    width: Math.max(
      document.body.scrollWidth,
      document.documentElement.scrollWidth,
      document.body.offsetWidth,
      document.documentElement.offsetWidth,
      document.body.clientWidth,
      document.documentElement.clientWidth
    ),
    height: Math.max(
      document.body.scrollHeight,
      document.documentElement.scrollHeight,
      document.body.offsetHeight,
      document.documentElement.offsetHeight,
      document.body.clientHeight,
      document.documentElement.clientHeight
    ),
    devicePixelRatio: window.devicePixelRatio,
    scrollY: window.scrollY
  };
}

async function stitchScreenshots(screenshots, pageWidth, pageHeight, viewportHeight, viewportWidth, dpr) {
  // Create an offscreen canvas
  const canvas = new OffscreenCanvas(pageWidth * dpr, pageHeight * dpr);
  const ctx = canvas.getContext('2d');

  // Process each screenshot
  for (let i = 0; i < screenshots.length; i++) {
    const { dataUrl, offsetY } = screenshots[i];
    
    // Load image
    const img = await loadImage(dataUrl);
    
    // Calculate where to draw this screenshot
    const destY = offsetY * dpr;
    
    // Draw the image
    ctx.drawImage(img, 0, destY);
  }

  // Convert canvas to blob
  const blob = await canvas.convertToBlob({ type: 'image/png' });
  
  // Convert blob to data URL
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.readAsDataURL(blob);
  });
}

async function loadImage(dataUrl) {
  // Convert data URL to blob
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  
  // Create ImageBitmap (works in service workers)
  return await createImageBitmap(blob);
}