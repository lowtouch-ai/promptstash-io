// Store the ID of the popup window
let popupWindowId = null;

// Listen for extension icon click to toggle window
chrome.action.onClicked.addListener((tab) => {
  if (tab.url.startsWith("chrome://")) {
    console.error("Cannot open window for chrome:// URLs");
    return;
  }
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

// Function to create the popup window
function createPopupWindow() {
  // Fallback screen dimensions (common 1080p resolution)
  const screenWidth = 1920;
  const screenHeight = 1080;
  const windowWidth = 600;
  const windowHeight = 800;
  const left = Math.round((screenWidth - windowWidth) / 2);
  const top = Math.round((screenHeight - windowHeight) / 2);

  chrome.windows.create({
    url: chrome.runtime.getURL("popup.html"),
    type: "popup",
    width: windowWidth,
    height: windowHeight,
    left: left,
    top: top,
    focused: true
  }, (window) => {
    popupWindowId = window.id;
  });
}

// Handle window removal to clear popupWindowId
chrome.windows.onRemoved.addListener((windowId) => {
  if (windowId === popupWindowId) {
    popupWindowId = null;
    chrome.storage.local.set({ isFullscreen: false });
  }
});

// Context menu for saving selected text
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "saveToPromptStash",
    title: "Save to PromptStash",
    contexts: ["selection"]
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "saveToPromptStash") {
    chrome.tabs.sendMessage(tab.id, { action: "getSelectedText" }, (response) => {
      if (response && response.selectedText) {
        chrome.storage.local.get(["nextIndex"], (result) => {
          let nextIndex = result.nextIndex || 0;
          chrome.storage.sync.get(["templates"], (result) => {
            const templates = result.templates || [];
            let defaultName = "New Template 1";
            let i = 1;
            while (templates.some(t => t.name === defaultName)) {
              defaultName = `New Template ${++i}`;
            }
            const details = prompt(`Enter template details:\nName (required, default: ${defaultName}):\nTags (optional, comma-separated):`, `${defaultName}\n`);
            if (!details) return;
            const [name, tags] = details.split("\n").map(s => s.trim());
            if (!name) return;
            templates.push({
              name,
              tags: tags ? tags.replace(/[^a-zA-Z0-9, ]/g, "").replace(/\s*,\s*/g, ", ").replace(/^,+\s*|,+\s*$/g, "") : "",
              content: response.selectedText,
              type: "custom",
              favorite: false,
              index: nextIndex++
            });
            chrome.storage.sync.set({ templates });
            chrome.storage.local.set({ nextIndex });
          });
        });
      }
    });
  }
});

// Handle messages for closing window, fullscreen, and window ID requests
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "closeSidebar" && message.windowId) {
    chrome.windows.remove(message.windowId, () => {
      if (chrome.runtime.lastError) {
        console.error("Error closing window:", chrome.runtime.lastError);
      }
    });
  } else if (message.action === "toggleFullscreen" && message.windowId) {
    chrome.storage.local.get(["isFullscreen"], (result) => {
      const isFullscreen = !result.isFullscreen;
      chrome.storage.local.set({ isFullscreen }, () => {
        chrome.windows.get(message.windowId, { populate: false }, (win) => {
          if (win) {
            chrome.windows.update(message.windowId, {
              state: isFullscreen ? "maximized" : "normal",
              width: isFullscreen ? win.width : 600,
              height: isFullscreen ? win.height : 800,
              left: isFullscreen ? win.left : Math.round((1920 - 600) / 2),
              top: isFullscreen ? win.top : Math.round((1080 - 800) / 2)
            });
          }
        });
      });
    });
  } else if (message.action === "getWindowId") {
    sendResponse({ windowId: popupWindowId });
  }
});