// Content script for screenshot preparation
console.log('Screenshot content script loaded');

// Helper function to ensure images are loaded
function ensureImagesLoaded() {
  return new Promise((resolve) => {
    const images = document.querySelectorAll('img');
    let loadedCount = 0;
    const totalImages = images.length;

    if (totalImages === 0) {
      resolve();
      return;
    }

    images.forEach(img => {
      if (img.complete) {
        loadedCount++;
        if (loadedCount === totalImages) resolve();
      } else {
        img.addEventListener('load', () => {
          loadedCount++;
          if (loadedCount === totalImages) resolve();
        });
        img.addEventListener('error', () => {
          loadedCount++;
          if (loadedCount === totalImages) resolve();
        });
      }
    });

    // Timeout after 5 seconds
    setTimeout(resolve, 5000);
  });
}