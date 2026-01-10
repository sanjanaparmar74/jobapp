document.getElementById('captureBtn').addEventListener('click', async () => {
  const button = document.getElementById('captureBtn');
  const status = document.getElementById('status');
  
  button.disabled = true;
  status.textContent = 'Capturing...';
  
  try {
    // Get the active tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    
    // Send message to background script to capture screenshot
    chrome.runtime.sendMessage({ 
      action: 'captureScreenshot', 
      tabId: tab.id 
    }, (response) => {
      if (response.success) {
        status.textContent = 'Screenshot saved!';
        setTimeout(() => {
          status.textContent = '';
          button.disabled = false;
        }, 2000);
      } else {
        status.textContent = 'Error: ' + response.error;
        button.disabled = false;
      }
    });
  } catch (error) {
    status.textContent = 'Error capturing screenshot';
    console.error(error);
    button.disabled = false;
  }
});