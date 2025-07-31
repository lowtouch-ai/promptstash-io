const supportedHosts = [
  "grok.com",
  "chatgpt.com",
  "perplexity.ai",
  "gemini.google.com",
  "claude.ai"
];
const supportedHostsString = "grok.com, chatgpt.com, perplexity.ai, gemini.google.com, and claude.ai";

const LARGE_SCREEN_MIN = 767;
const SMALL_SCREEN_MAX = 400; // Half of LARGE_SCREEN_MIN + padding on both sides
const defaultWidthRatio = 0.5;

// Periodic check to ensure content script is active
setInterval(() => {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0] && !tabs[0].url.match(/^(chrome|file|about):\/\//)) {
      chrome.tabs.sendMessage(tabs[0].id, { action: "ping" }, (response) => {
        if (chrome.runtime.lastError) {
          // console.log("Content script not responding, re-injecting...");
          chrome.scripting.executeScript({
            target: { tabId: tabs[0].id },
            files: ["content.js"]
          }, () => {
            if (chrome.runtime.lastError) {
              console.error("Periodic content script injection error:", chrome.runtime.lastError.message);
            }
          });
        }
      });
    }
  });
}, 300000); // Check every 5 minutes

// Listen for extension icon click to toggle popup
chrome.action.onClicked.addListener((tab) => {
  // Check for restricted protocols
  if (tab.url.match(/^(chrome|file|about):\/\//)) {
    console.error("Cannot inject into restricted URLs:", tab.url);
    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      function: showUnsupportedSiteToast,
      args: [`PromptStash cannot be used on restricted URLs (e.g., chrome://, file://, about://). Please navigate to a supported AI platform (e.g., ${supportedHostsString.replace(", and ", ", or ")}).`]
    });
    return;
  }

  // 2. MODIFICATION: Replace regex with a simple, reliable hostname check.
  const tabHostname = new URL(tab.url).hostname;
  const isSupported = supportedHosts.some(host => tabHostname.includes(host));

  if (!isSupported) {
    console.error("Tab URL not supported:", tab.url);
    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      function: showUnsupportedSiteToast,
      args: [`PromptStash is only supported on ${supportedHostsString}. Please navigate to a supported site.`]
    });
    return;
  }

  chrome.scripting.executeScript({
    target: { tabId: tab.id },
    function: togglePopup,
    args: [LARGE_SCREEN_MIN, SMALL_SCREEN_MAX, defaultWidthRatio]
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

// Debounce utility to limit resize event frequency
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

/**
 * This function is injected into the content page to create/destroy the PromptStash popup.
 * It is self-contained and handles all its own logic for styling, dragging, and event listener cleanup.
 */
function togglePopup(LARGE_SCREEN_MIN, SMALL_SCREEN_MAX, defaultWidthRatio) {
  const POPUP_ID = "promptstash-popup";
  const DRAG_HANDLE_ID = "promptstash-drag-handle";
  let popup = document.getElementById(POPUP_ID);

  let isDragging = false;
  let offsetX, offsetY;

  const onPointerMove = (e) => {
    if (!isDragging) return;
    e.preventDefault();
    let newLeft = e.clientX - offsetX;
    let newTop = e.clientY - offsetY;
    popup.style.left = `${newLeft}px`;
    popup.style.top = `${newTop}px`;
    popup.style.right = 'auto';
    popup.style.transition = 'none';
  };

  const onPointerUp = (e) => {
    if (!isDragging) return;
    isDragging = false;
    const dragHandle = document.getElementById(DRAG_HANDLE_ID);
    const iframe = popup.querySelector('iframe');
    if (dragHandle) dragHandle.style.cursor = 'grab';
    if (iframe) iframe.style.pointerEvents = 'auto';
    document.body.style.userSelect = '';
    
    // FIX #1: Restore transition *after* dragging is finished.
    popup.style.transition = "width 0.3s ease, height 0.3s ease, top 0.3s ease, right 0.3s ease, left 0.3s ease";
    
    const rect = popup.getBoundingClientRect();
    // Constrain the final saved position to be within the viewport
    let finalX = rect.left;
    let finalY = rect.top;
    if (finalX + rect.width > window.innerWidth) finalX = window.innerWidth - rect.width;
    if (finalY + rect.height > window.innerHeight) finalY = window.innerHeight - rect.height;
    if (finalX < 0) finalX = 0;
    if (finalY < 0) finalY = 0;

    // chrome.storage.local.set({ popupPosition: { x: finalX, y: finalY } });

    document.removeEventListener('pointermove', onPointerMove);
    document.removeEventListener('pointerup', onPointerUp);
  };

  const onPointerDown = (e) => {
    const isSmallScreen = window.innerWidth < SMALL_SCREEN_MAX;
    chrome.storage.local.get(["isFullscreen"], (result) => {
      if (result.isFullscreen || isSmallScreen) return;
      isDragging = true;
      const rect = popup.getBoundingClientRect();
      offsetX = e.clientX - rect.left;
      offsetY = e.clientY - rect.top;
      e.target.style.cursor = 'grabbing';
      popup.querySelector('iframe').style.pointerEvents = 'none';
      document.body.style.userSelect = 'none';

      // FIX #1: Disable transition *during* drag for smooth movement.
      popup.style.transition = 'none'; 
      // FIX #2: Ensure 'right' doesn't conflict with 'left'.
      popup.style.right = 'auto';

      document.addEventListener('pointermove', onPointerMove);
      document.addEventListener('pointerup', onPointerUp);
    });
  };

  const cleanup = () => {
    if (!popup) return;
    window.removeEventListener('resize', popup.resizeListener);
    document.removeEventListener('keydown', popup.escapeListener);
    document.removeEventListener('click', popup.outsideClickListener);
    const dragHandle = document.getElementById(DRAG_HANDLE_ID);
    if(dragHandle) dragHandle.removeEventListener('pointerdown', onPointerDown);
    document.removeEventListener('pointermove', onPointerMove);
    document.removeEventListener('pointerup', onPointerUp);
    popup.remove();
  };

  if (popup) {
    cleanup();
  } else {
    popup = document.createElement("div");
    popup.id = POPUP_ID;
    popup.style.position = "fixed";
    popup.style.userSelect = "none";
    const dragHandle = document.createElement("div");
    dragHandle.id = DRAG_HANDLE_ID;
    dragHandle.style.cssText = `position: absolute; top: 0; left: 0; width: 88%; height: 30px; cursor: grab; z-index: 1;`;
    const iframe = document.createElement("iframe");
    iframe.src = chrome.runtime.getURL("popup.html");
    iframe.style.cssText = "width: 100%; height: 100%; border: none;";
    popup.append(dragHandle, iframe);
    document.body.appendChild(popup);

    const applyPopupStyles = (isFullscreen, position) => {
      const isLargeScreen = window.innerWidth > LARGE_SCREEN_MIN;
      const isSmallScreen = window.innerWidth < SMALL_SCREEN_MAX;
      const needFullscreen = isFullscreen || isSmallScreen;
      dragHandle.style.display = needFullscreen ? "none" : "block";

      const popupWidth = needFullscreen ? window.innerWidth : (isLargeScreen ? defaultWidthRatio * window.innerWidth : defaultWidthRatio * LARGE_SCREEN_MIN);
      const popupHeight = needFullscreen ? window.innerHeight : window.innerHeight * 0.96;
      
      let finalPos = { x: 'auto', y: '8px', right: '8px' };
      if (position && !needFullscreen) {
        // FIX #3: Validate the saved position against current window size.
        let validatedX = position.x;
        let validatedY = position.y;
        if (validatedX + popupWidth > window.innerWidth) validatedX = window.innerWidth - popupWidth;
        if (validatedY + popupHeight > window.innerHeight) validatedY = window.innerHeight - popupHeight;
        if (validatedX < 0) validatedX = 0;
        if (validatedY < 0) validatedY = 0;
        finalPos = { x: `${validatedX}px`, y: `${validatedY}px`, right: 'auto' };
      } else if (needFullscreen) {
        finalPos = { x: '0px', y: '0px', right: 'auto' };
      }

      Object.assign(popup.style, {
        width: `${popupWidth}px`,
        height: `${popupHeight}px`,
        left: finalPos.x,
        top: finalPos.y,
        right: finalPos.right,
        zIndex: "10000",
        border: "2px solid #8888",
        borderRadius: needFullscreen ? "0" : "10px",
        boxShadow: needFullscreen ? "none" : "0 4px 15px rgba(0, 0, 0, 0.2)",
        overflow: "hidden",
        transition: "width 0.3s ease, height 0.3s ease, top 0.3s ease, right 0.3s ease, left 0.3s ease"
      });
    };

    chrome.storage.local.get(["isFullscreen", "popupPosition"], (result) => {
      applyPopupStyles(result.isFullscreen || false, result.popupPosition);
    });

    const debouncedUpdate = debounce(() => {
        if(!document.getElementById(POPUP_ID)) return;
        chrome.storage.local.get(["isFullscreen", "popupPosition"], (result) => {
            applyPopupStyles(result.isFullscreen || false, result.popupPosition);
        });
    }, 150);
    const handleEscape = (e) => e.key === "Escape" && cleanup();
    const handleOutsideClick = (e) => {
        const p = document.getElementById(POPUP_ID);
        if (p && !p.contains(e.target)) cleanup();
    };
    window.addEventListener('resize', debouncedUpdate);
    document.addEventListener('keydown', handleEscape);
    setTimeout(() => document.addEventListener('click', handleOutsideClick), 100);
    dragHandle.addEventListener('pointerdown', onPointerDown);
    popup.resizeListener = debouncedUpdate;
    popup.escapeListener = handleEscape;
    popup.outsideClickListener = handleOutsideClick;
    popup.updateStyles = () => {
        if(!document.getElementById(POPUP_ID)) return;
        chrome.storage.local.get(["isFullscreen", "popupPosition"], (result) => {
            applyPopupStyles(result.isFullscreen || false, result.popupPosition);
        });
    };
  }
}

function showUnsupportedSiteToast(message) {
  let toast = document.getElementById("promptstash-toast");
  if (toast) toast.remove();
  toast = document.createElement("div");
  toast.id = "promptstash-toast";
  toast.className = "promptstash-toast";
  toast.textContent = message;
  document.body.appendChild(toast);

  // Apply styles to match popup.js toast
  Object.assign(toast.style, {
    position: "fixed", top: "20px", right: "20px", padding: "10px 20px",
    borderRadius: "6px", background: "#fdd", color: "#800", zIndex: "10001",
    opacity: "0", transform: "translateY(-20px)",
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
      if (tabs[0]) {
        chrome.scripting.executeScript({
          target: { tabId: tabs[0].id },
          function: () => {
            const popup = document.getElementById("promptstash-popup");
            if (popup && typeof popup.escapeListener === 'function') {
              popup.escapeListener({ key: "Escape" }); 
            }
          }
        });
      }
    });
  } else if (message.action === "toggleFullscreen") {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.scripting.executeScript({
          target: { tabId: tabs[0].id },
          function: () => {
            const popup = document.getElementById("promptstash-popup");
            if (popup && typeof popup.updateStyles === 'function') {
              popup.updateStyles();
            }
          }
        });
      }
    });
  } else if (message.action === "getTargetTabId") {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0] && tabs[0].url && !tabs[0].url.match(/^(chrome|file|about):\/\//)) {
        // 2. MODIFICATION: Use the same reliable hostname check here.
        const tabHostname = new URL(tabs[0].url).hostname;
        const isSupported = supportedHosts.some(host => tabHostname.includes(host));
        
        if (isSupported) {
          sendResponse({ tabId: tabs[0].id });
        } else {
          sendResponse({ tabId: null });
        }
      } else {
        sendResponse({ tabId: null });
      }
    });
    return true;
  } else if (message.action === "reInjectContentScript") {
    // Re-inject content.js into the specified tab
    chrome.scripting.executeScript({
      target: { tabId: message.tabId },
      files: ["content.js"]
    }, () => {
      sendResponse({ success: !chrome.runtime.lastError });
    });
    return true;
  } else if (message.action === "togglePopup") {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.scripting.executeScript({
          target: { tabId: tabs[0].id },
          function: togglePopup,
          args: [LARGE_SCREEN_MIN, SMALL_SCREEN_MAX, defaultWidthRatio]
        });
      }
    });
  } else if (message.action === "ping") {
    sendResponse({ status: "alive" });
  }
  return true; // Keep channel open for async responses in general
});