const supportedHosts = [
  "https://grok.com/",
  "https://chatgpt.com/",
  "https://www.perplexity.ai/",
  "https://gemini.google.com/",
  "https://claude.ai/"
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

  // Check if the tab URL matches supported hosts
  const isSupported = supportedHosts.some(host => {
    const regex = new RegExp(`^${host.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}.*`);
    return regex.test(tab.url);
  });

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

// Function to toggle popup visibility
function togglePopup(LARGE_SCREEN_MIN = 767, SMALL_SCREEN_MAX = 400, defaultWidthRatio = 0.5) {
  const POPUP_ID = "promptstash-popup";
  const DRAG_HANDLE_ID = "promptstash-drag-handle";
  const RESIZE_HANDLE_CLASS = "promptstash-resize-handle";
  let popup = document.getElementById(POPUP_ID);

  let isDragging = false;
  let isResizing = false;
  let offsetX, offsetY;
  let resizeDirection = '';
  let startRect, startPointer;
  let isPointerOutOfBounds = false;

  const getConstraints = () => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    
    return {
      minWidth: Math.max(400, vw * 0.25),  // 25% of viewport or 400px minimum (increased)
      minHeight: Math.max(500, vh * 0.35), // 35% of viewport or 500px minimum (increased)
      maxWidth: vw * 0.95,                 // 95% of viewport maximum
      maxHeight: vh * 0.95,                // 95% of viewport maximum
      boundaryPadding: 5                   // Reduced padding for more usable space
    };
  };

  // Check if pointer is outside viewport bounds
  const isPointerOutsideViewport = (e) => {
    return e.clientX < 0 || e.clientX > window.innerWidth || 
           e.clientY < 0 || e.clientY > window.innerHeight;
  };

  let rafId = null;
  const onPointerMove = (e) => {
    if (!isDragging && !isResizing) return;
    
    // Check if pointer is outside viewport
    const wasOutOfBounds = isPointerOutOfBounds;
    isPointerOutOfBounds = isPointerOutsideViewport(e);
    
    // If we just went out of bounds during resize, stop the resize
    if (isResizing && !wasOutOfBounds && isPointerOutOfBounds) {
      onPointerUp(e);
      return;
    }
    
    // Don't process if out of bounds
    if (isPointerOutOfBounds) return;
    
    if (rafId) return; // Throttle with RAF
    
    rafId = requestAnimationFrame(() => {
      if (isDragging) {
        handleDrag(e);
      } else if (isResizing) {
        handleResize(e);
      }
      rafId = null;
    });
  };

  const handleDrag = (e) => {
    e.preventDefault();

    // Check conditions to prevent dragging (e.g., fullscreen, small screen)
    const isSmallScreen = window.innerWidth < SMALL_SCREEN_MAX;
    chrome.storage.local.get(["isFullscreen"], (result) => {
      if (result.isFullscreen || isSmallScreen) {
        // If dragging is disallowed, reset the state and exit
        isDragging = false;
        return;
      }

      const constraints = getConstraints();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      
      let newLeft = e.clientX - offsetX;
      let newTop = e.clientY - offsetY;
      
      const currentWidth = popup.offsetWidth;
      const currentHeight = popup.offsetHeight;
      
      // Apply boundary constraints
      newLeft = Math.max(constraints.boundaryPadding, 
        Math.min(vw - currentWidth - constraints.boundaryPadding, newLeft));
      newTop = Math.max(constraints.boundaryPadding, 
        Math.min(vh - currentHeight - constraints.boundaryPadding, newTop));
      
      // Update popup position
      popup.style.left = `${newLeft}px`;
      popup.style.top = `${newTop}px`;
    });
  };

  const handleResize = (e) => {
    e.preventDefault();

    // Check conditions to prevent resizing
    const isSmallScreen = window.innerWidth < SMALL_SCREEN_MAX;
    chrome.storage.local.get(["isFullscreen"], (result) => {
      if (result.isFullscreen || isSmallScreen) {
        isResizing = false;
        return;
      }

      const constraints = getConstraints();
      const deltaX = e.clientX - startPointer.x;
      const deltaY = e.clientY - startPointer.y;
      
      let newRect = { ...startRect };

      const resizeTransforms = {
        e: () => { newRect.width = Math.max(constraints.minWidth, Math.min(constraints.maxWidth, startRect.width + deltaX)); },
        w: () => {
          const newWidth = startRect.width - deltaX;
          if (newWidth < constraints.minWidth) {
            newRect.width = constraints.minWidth;
            newRect.left = startRect.left + startRect.width - constraints.minWidth;
          } else {
            newRect.width = newWidth;
            newRect.left = startRect.left + deltaX;
          }
        },
        s: () => { newRect.height = Math.max(constraints.minHeight, Math.min(constraints.maxHeight, startRect.height + deltaY)); },
        n: () => {
          const newHeight = startRect.height - deltaY;
          if (newHeight < constraints.minHeight) {
            newRect.height = constraints.minHeight;
            newRect.top = startRect.top + startRect.height - constraints.minHeight;
          } else {
            newRect.height = newHeight;
            newRect.top = startRect.top + deltaY;
          }
        }
      };

      [...resizeDirection].forEach(dir => resizeTransforms[dir]?.());

      // Apply boundary constraints for position
      newRect.left = Math.max(constraints.boundaryPadding, newRect.left);
      newRect.top = Math.max(constraints.boundaryPadding, newRect.top);

      // Apply new styles
      popup.style.width = `${newRect.width}px`;
      popup.style.height = `${newRect.height}px`;
      popup.style.left = `${newRect.left}px`;
      popup.style.top = `${newRect.top}px`;
    });
  };

  const onPointerUp = (e) => {
    if (isDragging || isResizing) {
      // Cancel any pending RAF
      if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }

      isDragging = false;
      const dragHandle = document.getElementById(DRAG_HANDLE_ID);
      if (dragHandle) dragHandle.style.cursor = 'grab';
      isResizing = false;
      isPointerOutOfBounds = false;
      
      // Re-enable interactions
      const iframe = popup.querySelector('iframe');
      if (iframe) iframe.style.pointerEvents = 'auto';
      document.body.style.userSelect = '';
      
      
      // Re-enable outside click after a small delay to prevent immediate trigger
      setTimeout(() => {
        if (popup && popup.outsideClickListener) {
          document.addEventListener('click', popup.outsideClickListener);
        }
      }, 100);
      
    }
    
    // Remove global listeners
    document.removeEventListener('pointermove', onPointerMove, { passive: false });
    document.removeEventListener('pointerup', onPointerUp);
    document.removeEventListener('pointerleave', onPointerUp);
  };

  const onDragStart = (e) => {
    // Prevent dragging on interactive elements like inputs, buttons, or resize handles
    const interactiveElements = ['INPUT', 'TEXTAREA', 'BUTTON', 'SELECT', 'A'];
    if (interactiveElements.includes(e.target.tagName) || 
        e.target.closest('button, input, textarea, select, a') ||
        e.target.classList.contains(RESIZE_HANDLE_CLASS)) {
      return;
    }

    // Immediately start the drag process
    isDragging = true;
    isPointerOutOfBounds = false;
    const rect = popup.getBoundingClientRect();
    offsetX = e.clientX - rect.left;
    offsetY = e.clientY - rect.top;

    // Set initial position and disable transitions to prevent jumping
    popup.style.transition = 'none';
    popup.style.left = `${rect.left}px`;
    popup.style.top = `${rect.top}px`;
    popup.style.right = 'auto';

    // Disable interactions on other elements for a smooth drag
    const iframe = popup.querySelector('iframe');
    if (iframe) iframe.style.pointerEvents = 'none';
    document.body.style.userSelect = 'none';

    // Temporarily remove the outside click listener to prevent the popup from closing
    document.removeEventListener('click', popup.outsideClickListener);

    // Add global listeners to handle the drag and its completion
    document.addEventListener('pointermove', onPointerMove, { passive: false });
    document.addEventListener('pointerup', onPointerUp);
    document.addEventListener('pointerleave', onPointerUp);
  };

  const onResizeStart = (e, direction) => {
    e.stopPropagation();

    // Immediately start the resize process
    isResizing = true;
    isPointerOutOfBounds = false;
    resizeDirection = direction;

    // Store the initial state of the popup and pointer
    const rect = popup.getBoundingClientRect();
    startRect = {
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height
    };
    startPointer = { x: e.clientX, y: e.clientY };

    // Disable interactions to ensure smooth resizing
    const iframe = popup.querySelector('iframe');
    if (iframe) iframe.style.pointerEvents = 'none';
    document.body.style.userSelect = 'none';
    popup.style.transition = 'none';

    // Temporarily remove the outside click listener
    document.removeEventListener('click', popup.outsideClickListener);

    // Add global listeners to handle the resize and its completion
    document.addEventListener('pointermove', onPointerMove, { passive: false });
    document.addEventListener('pointerup', onPointerUp);
    document.addEventListener('pointerleave', onPointerUp);
  };

  const createResizeHandles = () => {
    const directions = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'];
    const fragment = document.createDocumentFragment();
    
    directions.forEach(dir => {
      const handle = document.createElement('div');
      handle.className = RESIZE_HANDLE_CLASS;
      handle.dataset.direction = dir;
      
      // Enhanced resize handle styles with better hit targets and visual feedback
      const baseStyle = {
        position: 'absolute',
        zIndex: '3',
        backgroundColor: 'transparent',
        transition: 'all 0.15s ease',
        borderRadius: '2px'
      };
      
      const styles = {
        n: { ...baseStyle, top: '-4px', left: '12px', right: '12px', height: '8px', cursor: 'ns-resize' },
        ne: { ...baseStyle, top: '-4px', right: '-4px', width: '16px', height: '16px', cursor: 'nesw-resize' },
        e: { ...baseStyle, top: '12px', right: '-4px', bottom: '12px', width: '8px', cursor: 'ew-resize' },
        se: { ...baseStyle, bottom: '-4px', right: '-4px', width: '16px', height: '16px', cursor: 'nwse-resize' },
        s: { ...baseStyle, bottom: '-4px', left: '12px', right: '12px', height: '8px', cursor: 'ns-resize' },
        sw: { ...baseStyle, bottom: '-4px', left: '-4px', width: '16px', height: '16px', cursor: 'nesw-resize' },
        w: { ...baseStyle, top: '12px', left: '-4px', bottom: '12px', width: '8px', cursor: 'ew-resize' },
        nw: { ...baseStyle, top: '-4px', left: '-4px', width: '16px', height: '16px', cursor: 'nwse-resize' }
      };
      
      Object.assign(handle.style, styles[dir]);
      
      // Enhanced hover effects
      const addHoverEffects = () => {
        handle.addEventListener('mouseenter', () => {
          handle.style.backgroundColor = 'rgba(59, 130, 246, 0.4)';
          handle.style.transform = 'scale(1.1)';
        });
        handle.addEventListener('mouseleave', () => {
          handle.style.backgroundColor = 'transparent';
          handle.style.transform = 'scale(1)';
        });
      };
      
      addHoverEffects();
      handle.addEventListener('pointerdown', (e) => onResizeStart(e, dir));
      fragment.appendChild(handle);
    });
    
    return fragment;
  };

  const cleanup = () => {
    if (!popup) return;
    
    // Cancel any pending animation frames
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    
    // Remove all event listeners
    window.removeEventListener('resize', popup.resizeListener);
    document.removeEventListener('keydown', popup.escapeListener);
    document.removeEventListener('click', popup.outsideClickListener);
    document.removeEventListener('pointermove', onPointerMove);
    document.removeEventListener('pointerup', onPointerUp);
    document.removeEventListener('pointerleave', onPointerUp);
    
    const dragHandle = document.getElementById(DRAG_HANDLE_ID);
    if (dragHandle) dragHandle.style.cursor = 'grabbing';
    
    popup.remove();
  };

  if (popup) {
    cleanup();
  } else {
    popup = document.createElement("div");
    popup.id = POPUP_ID;
    popup.style.cssText = `
      position: fixed;
      user-select: none;
      will-change: transform, width, height;
    `;
    
    // Create drag handle with optimized styles
    const dragHandle = document.createElement("div");
    dragHandle.id = DRAG_HANDLE_ID;
    dragHandle.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      right: 90px; /* Leave space on the right for the popup's own controls */
      height: 32px;
      cursor: grab;
      z-index: 3; /* Above iframe (iframe is z-index: 2) */
      touch-action: none;
      background: transparent;
    `;
    
    const iframe = document.createElement("iframe");
    iframe.src = chrome.runtime.getURL("popup.html");
    iframe.style.cssText = `
      width: 100%; 
      height: 100%; 
      border: none; 
      position: relative; 
      z-index: 2;
      display: block;
    `;
    
    const resizeHandles = createResizeHandles();
    
    popup.appendChild(dragHandle);
    popup.appendChild(iframe);
    popup.appendChild(resizeHandles);
    document.body.appendChild(popup);

    const applyPopupStyles = (isFullscreen) => {
      const isLargeScreen = window.innerWidth > LARGE_SCREEN_MIN;
      const isSmallScreen = window.innerWidth < SMALL_SCREEN_MAX;
      const needFullscreen = isFullscreen || isSmallScreen;
      const constraints = getConstraints();
      
      // Show/hide interactive elements based on fullscreen state
      dragHandle.style.display = needFullscreen ? "none" : "block";
      const handles = popup.querySelectorAll(`.${RESIZE_HANDLE_CLASS}`);
      handles.forEach(handle => {
        handle.style.display = needFullscreen ? "none" : "block";
        handle.style.pointerEvents = needFullscreen ? "none" : "auto";
      });
    
      // Calculate dimensions
      let popupWidth, popupHeight;
      
      if (needFullscreen) {
        popupWidth = window.innerWidth;
        popupHeight = window.innerHeight;
      } else {
        // Use original default calculation only if no saved size
        popupWidth = isLargeScreen ? 
                    defaultWidthRatio * window.innerWidth : 
                    defaultWidthRatio * LARGE_SCREEN_MIN;
        popupHeight = window.innerHeight * 0.96;
        
        // Enforce minimum constraints on defaults
        popupWidth = Math.max(constraints.minWidth, Math.min(constraints.maxWidth, popupWidth));
        popupHeight = Math.max(constraints.minHeight, Math.min(constraints.maxHeight, popupHeight));
      }
      
      // Calculate position
      let finalPos = { x: 'auto', y: '8px', right: '8px' };
      
      if (needFullscreen) {
        finalPos = { x: '0px', y: '0px', right: '0' };
      }
      // If no saved position, keep default right-side positioning
    
      // Apply styles with optimized CSS
      popup.style.cssText += `
        width: ${popupWidth}px;
        height: ${popupHeight}px;
        left: ${finalPos.x};
        top: ${finalPos.y};
        right: ${finalPos.right};
        z-index: 10000;
        border: 2px solid #8888;
        border-radius: ${needFullscreen ? "0" : "12px"};
        box-shadow: ${needFullscreen ? "none" : "0 12px 40px rgba(0, 0, 0, 0.15), 0 4px 12px rgba(0, 0, 0, 0.1)"};
        overflow: hidden;
        transition: width 0.2s ease-out, height 0.2s ease-out, top 0.2s ease-out, right 0.2s ease-out, left 0.2s ease-out;
        backdrop-filter: blur(1px);
      `;
    };

    // Initialize popup with saved state
    chrome.storage.local.get(["isFullscreen"], (result) => {
      applyPopupStyles(result.isFullscreen || false);
    });

    let resizeTimeout;
    const debouncedUpdate = () => {
      clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(() => {
        if (!document.getElementById(POPUP_ID)) return;
        chrome.storage.local.get(["isFullscreen"], (result) => {
          applyPopupStyles(result.isFullscreen || false);
        });
      }, 100);
    };
    
    // Optimized event handlers
    const handleEscape = (e) => e.key === "Escape" && cleanup();
    const handleOutsideClick = (e) => {
      // Don't close if currently dragging or resizing
      if (isDragging || isResizing) return;
      
      const p = document.getElementById(POPUP_ID);
      if (p && !p.contains(e.target)) cleanup();
    };
    
    // Add event listeners
    window.addEventListener('resize', debouncedUpdate, { passive: true });
    document.addEventListener('keydown', handleEscape);
    setTimeout(() => document.addEventListener('click', handleOutsideClick), 100);
    dragHandle.addEventListener('pointerdown', onDragStart);
    
    // Store references for cleanup
    popup.resizeListener = debouncedUpdate;
    popup.escapeListener = handleEscape;
    popup.outsideClickListener = handleOutsideClick;
    popup.updateStyles = () => {
      if (!document.getElementById(POPUP_ID)) return;
      chrome.storage.local.get(["isFullscreen"], (result) => {
        applyPopupStyles(result.isFullscreen || false);
      });
    };
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
          if (popup.resizeListener) {
            window.removeEventListener('resize', popup.resizeListener); // Clean up resize listener
          }
          if (popup) {
            popup.remove(); // Remove the popup
          }
        }
      }, () => {
        if (chrome.runtime.lastError) {
          console.error("Close popup error:", chrome.runtime.lastError.message);
        }
      });
    });
  } else if (message.action === "toggleFullscreen") {
    chrome.storage.local.get(["isFullscreen"], (result) => {
      const isFullscreen = result.isFullscreen;
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (!tabs[0]) return;
        chrome.scripting.executeScript({
          target: { tabId: tabs[0].id },
          function: (isFullscreen, LARGE_SCREEN_MIN, SMALL_SCREEN_MAX, defaultWidthRatio) => {
            const popup = document.getElementById("promptstash-popup");
            if (popup) {
              const isLargeScreen = window.innerWidth > LARGE_SCREEN_MIN;
              const isSmallScreen = window.innerWidth < SMALL_SCREEN_MAX;
              const needFullscreen = isFullscreen || isSmallScreen;
  
              // Update drag handle
              const dragHandle = document.getElementById("promptstash-drag-handle");
              if (dragHandle) {
                dragHandle.style.display = needFullscreen ? "none" : "block";
              }
  
              // Update resize handles
              const handles = popup.querySelectorAll(".promptstash-resize-handle");
              handles.forEach(handle => {
                handle.style.display = needFullscreen ? "none" : "block";
                handle.style.pointerEvents = needFullscreen ? "none" : "auto";
              });
  
              if (needFullscreen) {
                // Apply fullscreen styles
                Object.assign(popup.style, {
                  width: "100vw",
                  height: "100vh",
                  right: "0",
                  left: "0",
                  top: "0",
                  borderRadius: "0",
                  boxShadow: "none",
                  transition: "width 0.3s ease, height 0.3s ease, top 0.3s ease, left 0.3s ease"
                });
              } else {
                // Exiting fullscreen - restore to default dimensions
                const constraints = {
                  minWidth: Math.max(400, window.innerWidth * 0.25),
                  minHeight: Math.max(500, window.innerHeight * 0.35),
                  maxWidth: window.innerWidth * 0.95,
                  maxHeight: window.innerHeight * 0.95
                };

                let width = isLargeScreen ? 
                              defaultWidthRatio * window.innerWidth :
                              defaultWidthRatio * LARGE_SCREEN_MIN;
                let height = window.innerHeight * 0.96;

                width = Math.max(constraints.minWidth, Math.min(constraints.maxWidth, width));
                height = Math.max(constraints.minHeight, Math.min(constraints.maxHeight, height));

                const styles = {
                  width: `${width}px`,
                  height: `${height}px`,
                  left: 'auto',
                  top: '8px',
                  right: '8px',
                  borderRadius: "12px",
                  boxShadow: "0 12px 40px rgba(0, 0, 0, 0.15), 0 4px 12px rgba(0, 0, 0, 0.1)",
                  transition: "width 0.3s ease, height 0.3s ease, top 0.3s ease, left 0.3s ease, right 0.3s ease"
                };
                Object.assign(popup.style, styles);
              }
            }
          },
          args: [isFullscreen, LARGE_SCREEN_MIN, SMALL_SCREEN_MAX, defaultWidthRatio]
        }, () => {
          if (chrome.runtime.lastError) {
            console.error("Fullscreen toggle error:", chrome.runtime.lastError.message);
          }
        });
      });
    });
  } else if (message.action === "getTargetTabId") {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0] && !tabs[0].url.match(/^(chrome|file|about):\/\//)) {
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
            args: [`PromptStash is only supported on ${supportedHostsString}. Please navigate to a supported site.`]
          });
          sendResponse({ tabId: null });
        }
      } else {
        console.error("Restricted URL:", tabs[0]?.url || "No active tab");
        chrome.scripting.executeScript({
          target: { tabId: tabs[0]?.id },
          function: showUnsupportedSiteToast,
          args: [`PromptStash cannot be used on restricted URLs (e.g., chrome://, file://, about://). Please navigate to a supported AI platform (e.g., ${supportedHostsString.replace(", and ", ", or ")}).`]
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
        // console.log("Content script re-injected successfully");
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
  } else if (message.action === "ping") {
    sendResponse({ status: "alive" });
  }
});