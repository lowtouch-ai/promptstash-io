// Listen for extension icon click to toggle popup
chrome.action.onClicked.addListener((tab) => {
  if (tab.url.startsWith("chrome://")) {
    console.error("Cannot inject into chrome:// URLs");
    alert("Cannot inject into chrome:// URLs");
    return;
  }
  chrome.scripting.executeScript({
    target: { tabId: tab.id },
    function: togglePopup
  }, () => {
    if (chrome.runtime.lastError) {
      console.error("Injection error:", chrome.runtime.lastError.message);
    }
  });
});

// Function to toggle popup visibility
function togglePopup() {
  const popupId = "promptstash-popup";
  let popup = document.getElementById(popupId);

  if (popup) {
    popup.remove();
  } else {
    popup = document.createElement("div");
    popup.id = popupId;
    popup.innerHTML = `
      <iframe src="${chrome.runtime.getURL("popup.html")}" style="width: 100%; height: 100%; border: none;"></iframe>
    `;
    document.body.appendChild(popup);

    // Check if fullscreen mode is active
    chrome.storage.local.get(["isFullscreen"], (result) => {
      const isFullscreen = result.isFullscreen || false;
      const isSmallScreen = window.innerWidth <= 768;
      const defaultWidth = isFullscreen ? "100vw" : isSmallScreen ? "100vw" : "50vw";
      const defaultHeight = isFullscreen ? "100vh" : isSmallScreen ? "100vh" : "96vh";
      const defaultLeft = isFullscreen ? "0" : isSmallScreen ? "0" : `${window.innerWidth * 0.49}px`;
      const defaultTop = isFullscreen ? "0" : isSmallScreen ? "0" : "2vh";

      Object.assign(popup.style, {
        width: defaultWidth,
        height: defaultHeight,
        position: "absolute",
        top: defaultTop,
        left: defaultLeft,
        zIndex: "10000",
        backgroundColor: "none",
        border: "2px solid #8888",
        borderRadius: isFullscreen ? "0" : "10px",
        boxShadow: isFullscreen ? "none" : "0 4px 15px rgba(0, 0, 0, 0.2)",
        overflow: "hidden",
        transition: "width 0.3s ease, height 0.3s ease, top 0.3s ease, left 0.3s ease"
      });
    });

    // Universal close functionality
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && popup) {
        popup.remove();
      }
    });

    document.addEventListener("click", (e) => {
      if (popup && !popup.contains(e.target)) {
        popup.remove();
      }
    });
  }
}

// Handle messages for closing popup, fullscreen, and re-injecting content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "closePopup") {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs[0]) return;
      chrome.scripting.executeScript({
        target: { tabId: tabs[0].id },
        function: () => {
          const popup = document.getElementById("promptstash-popup");
          if (popup) popup.remove();
        }
      }, () => {
        if (chrome.runtime.lastError) {
          console.error("Close popup error:", chrome.runtime.lastError.message);
        }
        chrome.storage.local.set({ isFullscreen: false }, () => {
          if (chrome.runtime.lastError) {
            console.error("Storage error:", chrome.runtime.lastError.message);
          }
        });
      });
      // Reset fullscreen state
      chrome.storage.local.set({ isFullscreen: false });
    });
  } else if (message.action === "toggleFullscreen") {
    chrome.storage.local.get(["isFullscreen"], (result) => {
      const isFullscreen = !result.isFullscreen;
      chrome.storage.local.set({ isFullscreen }, () => {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          if (!tabs[0]) return;
          chrome.scripting.executeScript({
            target: { tabId: tabs[0].id },
            function: (isFullscreen) => {
              const popup = document.getElementById("promptstash-popup");
              if (popup) {
                const isSmallScreen = window.innerWidth <= 768;
                Object.assign(popup.style, {
                  width: isFullscreen ? "100vw" : isSmallScreen ? "100vw" : "50vw",
                  height: isFullscreen ? "100vh" : isSmallScreen ? "100vh" : "96vh",
                  left: isFullscreen ? "0" : isSmallScreen ? "0" : `${window.innerWidth * 0.49}px`,
                  top: isFullscreen ? "0" : isSmallScreen ? "0" : "2vh",
                  borderRadius: isFullscreen ? "0" : "10px",
                  boxShadow: isFullscreen ? "none" : "0 4px 15px rgba(0, 0, 0, 0.2)",
                  transition: "width 0.3s ease, height 0.3s ease, top 0.3s ease, left 0.3s ease",
                  transform: "none"
                });
              }
            },
            args: [isFullscreen]
          }, () => {
            if (chrome.runtime.lastError) {
              console.error("Fullscreen toggle error:", chrome.runtime.lastError.message);
            }
          });
        });
      });
    });
  } else if (message.action === "getTargetTabId") {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0] && !tabs[0].url.startsWith("chrome://")) {
        sendResponse({ tabId: tabs[0].id });
      } else {
        sendResponse({ tabId: null });
      }
    });
    return true; // Keep message channel open for async response
  } else if (message.action === "reInjectContentScript") {
    // Re-inject content.js into the specified tab
    chrome.scripting.executeScript({
      target: { tabId: message.tabId },
      files: ["content.js"]
    }, () => {
      if (chrome.runtime.lastError) {
        console.error("Content script re-injection error:", chrome.runtime.lastError.message);
        sendResponse({ success: false });
      } else {
        console.log("Content script re-injected successfully");
        sendResponse({ success: true });
      }
    });
    return true; // Keep message channel open for async response
  }
});