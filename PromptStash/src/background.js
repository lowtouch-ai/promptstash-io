// Store the ID of the popup window
let popupWindowId = null;
// Store the ID of the target tab
let targetTabId = null;

// Listen for extension icon click to toggle window
chrome.action.onClicked.addListener((tab) => {
  if (tab.url.startsWith("chrome://")) {
    console.error("Cannot open window for chrome:// URLs");
    alert("Cannot open window for chrome:// URLs");
    return;
  }
  // Set the target tab ID when the icon is clicked
  targetTabId = tab.id;
  if (popupWindowId !== null) {
    // Check if window still exists
    chrome.windows.get(popupWindowId, { populate: false }, (win) => {
      if (chrome.runtime.lastError || !win) {
        createPopupWindow();
      } else {
        // Focus the existing window
        chrome.windows.update(popupWindowId, { focused: true });
      }
    });
  } else {
    createPopupWindow();
  }
});

// Update targetTabId when the active tab changes
chrome.tabs.onActivated.addListener((activeInfo) => {
  chrome.tabs.get(activeInfo.tabId, (tab) => {
    if (chrome.runtime.lastError || !tab || tab.url.startsWith("chrome://")) {
      console.log("Cannot set targetTabId to invalid or chrome:// tab");
      targetTabId = null;
    } else {
      targetTabId = activeInfo.tabId;
      console.log("Updated targetTabId to:", targetTabId);
    }
  });
});

// Ensure targetTabId is set when a tab is updated (e.g., navigation)
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete" && tab.active && !tab.url.startsWith("chrome://")) {
    targetTabId = tabId;
    console.log("Updated targetTabId on tab update to:", targetTabId);
  }
});

// Function to create the popup window
function createPopupWindow() {
  chrome.system.display.getInfo((displays) => {
    const primaryDisplay = displays[0];
    const screenWidth = primaryDisplay.workArea.width;
    const screenHeight = primaryDisplay.workArea.height;
    const screenLeft = primaryDisplay.workArea.left;
    const screenTop = primaryDisplay.workArea.top;
    const popupWidth = 800;
    const popupHeight = 800;

    // Calculate center
    const left = screenLeft + Math.round((screenWidth - popupWidth) / 2);
    const top = screenTop + Math.round((screenHeight - popupHeight) / 2);

    // Create popup window
    chrome.windows.create({
      url: chrome.runtime.getURL("popup.html"),
      type: "popup",
      width: popupWidth,
      height: popupHeight,
      left: left,
      top: top,
      focused: true
    }, (window) => {
      popupWindowId = window.id;
    });
  });  
}

// Handle window removal to clear popupWindowId
chrome.windows.onRemoved.addListener((windowId) => {
  if (windowId === popupWindowId) {
    popupWindowId = null;
    // chrome.storage.local.set({ isFullscreen: false });
  }
});

// Handle messages for closing window, fullscreen, and window/tab ID requests
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "closePopup" && message.windowId) {
    chrome.windows.remove(message.windowId, () => {
      if (chrome.runtime.lastError) {
        console.error("Error closing window:", chrome.runtime.lastError);
      }
    });
  // } else if (message.action === "toggleFullscreen" && message.windowId) {
  //   chrome.storage.local.get(["isFullscreen"], (result) => {
  //     const isFullscreen = !result.isFullscreen;
  //     chrome.storage.local.set({ isFullscreen }, () => {
  //       chrome.windows.get(message.windowId, { populate: false }, (win) => {
  //         if (win) {
  //           chrome.windows.update(message.windowId, {
  //             state: isFullscreen ? "maximized" : "normal",
  //             width: isFullscreen ? win.width : 600,
  //             height: isFullscreen ? win.height : 800,
  //             left: isFullscreen ? win.left : Math.round((1920 - 600) / 2),
  //             top: isFullscreen ? win.top : Math.round((1080 - 800) / 2)
  //           });
  //         }
  //       });
  //     });
  //   });
  } else if (message.action === "getWindowId") {
    sendResponse({ windowId: popupWindowId });
  } else if (message.action === "getTargetTabId") {
    // Validate targetTabId before sending
    if (targetTabId !== null) {
      chrome.tabs.get(targetTabId, (tab) => {
        if (chrome.runtime.lastError || !tab || tab.url.startsWith("chrome://")) {
          console.log("Invalid targetTabId, clearing");
          targetTabId = null;
          sendResponse({ tabId: null });
        } else {
          sendResponse({ tabId: targetTabId });
        }
      });
    } else {
      sendResponse({ tabId: null });
    }
  }
});