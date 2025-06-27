
// Listen for extension icon click to toggle popup
chrome.action.onClicked.addListener((tab) => {
  // Check for restricted protocols
  if (tab.url.match(/^(chrome|file|about):\/\//)) {
    console.error("Cannot inject into restricted URLs:", tab.url);
    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      function: showUnsupportedSiteToast,
      args: ["PromptStash cannot be used on restricted URLs (e.g., chrome://, file://, about://). Please navigate to a supported AI platform (e.g., grok.com, perplexity.ai, or chatgpt.com)."]
    });
    return;
  }

  // Check if the tab URL matches supported hosts
  const supportedHosts = [
    "https://grok.com/",
    "https://www.perplexity.ai/",
    "https://chatgpt.com/"
  ];
  const isSupported = supportedHosts.some(host => {
    const regex = new RegExp(`^${host.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}.*`);
    return regex.test(tab.url);
  });

  if (!isSupported) {
    console.error("Tab URL not supported:", tab.url);
    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      function: showUnsupportedSiteToast,
      args: ["PromptStash is only supported on grok.com, perplexity.ai, and chatgpt.com. Please navigate to a supported site."]
    });
    return;
  }

  chrome.scripting.executeScript({
    target: { tabId: tab.id },
    function: togglePopup
  }, () => {
    if (chrome.runtime.lastError) {
      console.error("Injection error:", chrome.runtime.lastError.message);
      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        function: showUnsupportedSiteToast,
        args: ["Failed to open PromptStash: " + chrome.runtime.lastError.message]
      });
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

    // Retrieve stored fullscreen state and apply styles
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
        chrome.storage.local.set({ isFullscreen: false });
      }
    });

    document.addEventListener("click", (e) => {
      const widget = document.getElementById("promptstash-widget");  
      if (popup && !popup.contains(e.target) && !widget.contains(e.target)) {
        popup.remove();
        console.log("Is widget targeted (background):" + !widget.contains(e.target))
        chrome.storage.local.set({ isFullscreen: false });
      }

    });
  }
}

// Function to display toast notification for unsupported sites
function showUnsupportedSiteToast(message) {
  let toast = document.getElementById("promptstash-toast");
  if (toast) {
    toast.remove();
  }

  toast = document.createElement("div");
  toast.id = "promptstash-toast";
  toast.className = "promptstash-toast";
  toast.textContent = message;
  document.body.appendChild(toast);

  // Apply styles to match popup.js toast
  Object.assign(toast.style, {
    position: "fixed",
    top: "20px",
    right: "20px",
    padding: "10px 20px",
    borderRadius: "6px",
    background: "#fdd",
    color: "#800",
    zIndex: "10001",
    opacity: "0",
    transform: "translateY(-20px)",
    transition: "opacity 0.3s ease, transform 0.3s ease"
  });

  // Show toast
  setTimeout(() => {
    toast.style.opacity = "1";
    toast.style.transform = "translateY(0)";
  }, 10);

  // Auto-hide after 3 seconds
  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateY(-20px)";
    setTimeout(() => toast.remove(), 300);
  }, 3000);
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
    });
  } else if (message.action === "toggleFullscreen") {
    chrome.storage.local.get(["isFullscreen"], (result) => {
      const isFullscreen = !result.isFullscreen;
      chrome.storage.local.set({ isFullscreen }, () => {
        if (chrome.runtime.lastError) {
          console.error("Storage set error:", chrome.runtime.lastError.message);
          return;
        }
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
                  transition: "width 0.3s ease, height 0.3s ease, top 0.3s ease, left 0.3s ease"
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
      if (tabs[0] && !tabs[0].url.match(/^(chrome|file|about):\/\//)) {
        // Check if the tab URL matches supported hosts
        const supportedHosts = [
          "https://grok.com/",
          "https://www.perplexity.ai/",
          "https://chatgpt.com/"
        ];
        const isSupported = supportedHosts.some(host => {
          const regex = new RegExp(`^${host.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}.*`);
          return regex.test(tabs[0].url);
        });

        if (isSupported) {
          sendResponse({ tabId: tabs[0].id });
        } else {
          console.error("Tab URL not supported:", tabs[0].url);
          chrome.scripting.executeScript({
            target: { tabId: tabs[0].id },
            function: showUnsupportedSiteToast,
            args: ["PromptStash is only supported on grok.com, perplexity.ai, and chatgpt.com. Please navigate to a supported site."]
          });
          sendResponse({ tabId: null });
        }
      } else {
        console.error("Restricted URL:", tabs[0]?.url || "No active tab");
        chrome.scripting.executeScript({
          target: { tabId: tabs[0]?.id },
          function: showUnsupportedSiteToast,
          args: ["PromptStash cannot be used on restricted URLs (e.g., chrome://, file://, about://). Please navigate to a supported AI platform (e.g., grok.com, perplexity.ai, or chatgpt.com)."]
        });
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
  } else if (message.action === "togglePopup") {
    // Open the popup normally
    chrome.storage.local.set({ openWithSearch: false }, () => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]) {
          chrome.scripting.executeScript({
            target: { tabId: tabs[0].id },
            function: togglePopup
          });
        }
      });
    });
  }
});