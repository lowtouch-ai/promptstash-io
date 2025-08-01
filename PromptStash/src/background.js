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
    const constraints = getConstraints();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    
    let newLeft = e.clientX - offsetX;
    let newTop = e.clientY - offsetY;
    
    // Get current dimensions
    const currentWidth = popup.offsetWidth;
    const currentHeight = popup.offsetHeight;
    
    // Apply boundary constraints for dragging
    newLeft = Math.max(constraints.boundaryPadding, 
      Math.min(vw - currentWidth - constraints.boundaryPadding, newLeft));
    newTop = Math.max(constraints.boundaryPadding, 
      Math.min(vh - currentHeight - constraints.boundaryPadding, newTop));
    
    // Batch DOM updates
    popup.style.cssText += `
      left: ${newLeft}px;
      top: ${newTop}px;
      right: auto;
      transition: none;
    `;
  };

  const handleResize = (e) => {
    e.preventDefault();
    const constraints = getConstraints();
    const deltaX = e.clientX - startPointer.x;
    const deltaY = e.clientY - startPointer.y;
    
    let newRect = {
      left: startRect.left,
      top: startRect.top,
      width: startRect.width,
      height: startRect.height
    };

    const resizeTransforms = {
      e: () => { 
        const newWidth = startRect.width + deltaX;
        if (newWidth >= constraints.minWidth && newWidth <= constraints.maxWidth) {
          newRect.width = newWidth;
        } else {
          // Clamp to constraints without reverting
          newRect.width = Math.max(constraints.minWidth, Math.min(constraints.maxWidth, newWidth));
        }
      },
      w: () => { 
        const newWidth = startRect.width - deltaX;
        const newLeft = startRect.left + deltaX;
        if (newWidth >= constraints.minWidth && newLeft >= constraints.boundaryPadding) {
          newRect.width = newWidth;
          newRect.left = newLeft;
        } else if (newWidth < constraints.minWidth) {
          // Hit minimum width constraint
          newRect.width = constraints.minWidth;
          newRect.left = startRect.left + startRect.width - constraints.minWidth;
        } else if (newLeft < constraints.boundaryPadding) {
          // Hit left boundary constraint
          newRect.left = constraints.boundaryPadding;
          newRect.width = startRect.left + startRect.width - constraints.boundaryPadding;
        }
      },
      s: () => { 
        const newHeight = startRect.height + deltaY;
        if (newHeight >= constraints.minHeight && newHeight <= constraints.maxHeight) {
          newRect.height = newHeight;
        } else {
          // Clamp to constraints without reverting
          newRect.height = Math.max(constraints.minHeight, Math.min(constraints.maxHeight, newHeight));
        }
      },
      n: () => { 
        const newHeight = startRect.height - deltaY;
        const newTop = startRect.top + deltaY;
        if (newHeight >= constraints.minHeight && newTop >= constraints.boundaryPadding) {
          newRect.height = newHeight;
          newRect.top = newTop;
        } else if (newHeight < constraints.minHeight) {
          // Hit minimum height constraint
          newRect.height = constraints.minHeight;
          newRect.top = startRect.top + startRect.height - constraints.minHeight;
        } else if (newTop < constraints.boundaryPadding) {
          // Hit top boundary constraint
          newRect.top = constraints.boundaryPadding;
          newRect.height = startRect.top + startRect.height - constraints.boundaryPadding;
        }
      }
    };

    // Execute transforms for each direction
    [...resizeDirection].forEach(dir => {
      resizeTransforms[dir]?.();
    });

    popup.style.cssText += `
      width: ${newRect.width}px;
      height: ${newRect.height}px;
      left: ${newRect.left}px;
      top: ${newRect.top}px;
      right: auto;
      transition: none;
    `;
  };

  const onPointerUp = (e) => {
    if (isDragging || isResizing) {
      // Cancel any pending RAF
      if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }

      isDragging = false;
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
      
      // Save position to storage
      savePosition();
    }
    
    // Remove global listeners
    document.removeEventListener('pointermove', onPointerMove, { passive: false });
    document.removeEventListener('pointerup', onPointerUp);
    document.removeEventListener('pointerleave', onPointerUp);
  };

  const savePosition = () => {
    const rect = popup.getBoundingClientRect();
    chrome.storage.local.set({
      popupPosition: { x: rect.left, y: rect.top },
      popupSize: { width: rect.width, height: rect.height }
    });
  };

  const onDragStart = (e) => {
    // Prevent dragging on interactive elements
    const interactiveElements = ['INPUT', 'TEXTAREA', 'BUTTON', 'SELECT', 'A'];
    const isInteractive = interactiveElements.includes(e.target.tagName) || 
                         e.target.closest('button, input, textarea, select, a') ||
                         e.target.classList.contains(RESIZE_HANDLE_CLASS);
    
    if (isInteractive) return;

    const isSmallScreen = window.innerWidth < SMALL_SCREEN_MAX;
    chrome.storage.local.get(["isFullscreen"], (result) => {
      if (result.isFullscreen || isSmallScreen) return;
      
      isDragging = true;
      isPointerOutOfBounds = false;
      const rect = popup.getBoundingClientRect();
      offsetX = e.clientX - rect.left;
      offsetY = e.clientY - rect.top;
      
      // Disable interactions during drag
      const iframe = popup.querySelector('iframe');
      if (iframe) iframe.style.pointerEvents = 'none';
      document.body.style.userSelect = 'none';
      popup.style.transition = 'none';
      popup.style.right = 'auto';

      // Disable outside click during drag
      document.removeEventListener('click', popup.outsideClickListener);

      // Add global listeners including pointer leave
      document.addEventListener('pointermove', onPointerMove, { passive: false });
      document.addEventListener('pointerup', onPointerUp);
      document.addEventListener('pointerleave', onPointerUp);
    });
  };

  const onResizeStart = (e, direction) => {
    e.stopPropagation();
    const isSmallScreen = window.innerWidth < SMALL_SCREEN_MAX;
    
    chrome.storage.local.get(["isFullscreen"], (result) => {
      // Block resize in fullscreen mode or small screens
    if (result.isFullscreen || isSmallScreen) {
      e.preventDefault();
      return;
    }
      
      isResizing = true;
      isPointerOutOfBounds = false;
      resizeDirection = direction;
      
      // Store initial state
      const rect = popup.getBoundingClientRect();
      startRect = {
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height
      };
      startPointer = { x: e.clientX, y: e.clientY };
      
      // Disable interactions during resize
      const iframe = popup.querySelector('iframe');
      if (iframe) iframe.style.pointerEvents = 'none';
      document.body.style.userSelect = 'none';
      popup.style.transition = 'none';

      // Disable outside click during resize
      document.removeEventListener('click', popup.outsideClickListener);

      // Add global listeners including pointer leave
      document.addEventListener('pointermove', onPointerMove, { passive: false });
      document.addEventListener('pointerup', onPointerUp);
      document.addEventListener('pointerleave', onPointerUp);
    });
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
    if (dragHandle) dragHandle.removeEventListener('pointerdown', onDragStart);
    
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
      width: 100%; 
      height: 100%; 
      cursor: move; 
      z-index: 1;
      touch-action: none;
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

    const applyPopupStyles = (isFullscreen, position, savedSize) => {
      const isLargeScreen = window.innerWidth > LARGE_SCREEN_MIN;
      const isSmallScreen = window.innerWidth < SMALL_SCREEN_MAX;
      const needFullscreen = isFullscreen || isSmallScreen;
      const constraints = getConstraints();
      
      // Show/hide interactive elements based on fullscreen state
      dragHandle.style.display = needFullscreen ? "none" : "block";
      const handles = popup.querySelectorAll(`.${RESIZE_HANDLE_CLASS}`);
      handles.forEach(handle => {
        handle.style.display = needFullscreen ? "none" : "block";
        // Also disable pointer events to be extra safe
        handle.style.pointerEvents = needFullscreen ? "none" : "auto";
      });

      // Calculate dimensions with original behavior but enforce minimums
      let popupWidth, popupHeight;
      
      if (needFullscreen) {
        popupWidth = window.innerWidth;
        popupHeight = window.innerHeight;
      } else {
        // Use saved size or calculate defaults like original
        popupWidth = isLargeScreen ? 
        defaultWidthRatio * window.innerWidth : 
        defaultWidthRatio * LARGE_SCREEN_MIN;
        popupHeight = window.innerHeight * 0.96;
        
        // Only enforce minimums if the calculated size is smaller
        if (popupWidth < constraints.minWidth) {
          popupWidth = constraints.minWidth;
        }
        if (popupHeight < constraints.minHeight) {
          popupHeight = constraints.minHeight;
        }
        
        // Apply maximum constraints
        popupWidth = Math.min(constraints.maxWidth, popupWidth);
        popupHeight = Math.min(constraints.maxHeight, popupHeight);
      }
      // Calculate position - use original right-side positioning
      let finalPos = { x: 'auto', y: '8px', right: '8px' };
      
      if (position && !needFullscreen) {
        // Ensure saved positions respect current constraints
        const constrainedLeft = Math.max(constraints.boundaryPadding, 
          Math.min(window.innerWidth - popupWidth - constraints.boundaryPadding, position.x));
        const constrainedTop = Math.max(constraints.boundaryPadding, 
          Math.min(window.innerHeight - popupHeight - constraints.boundaryPadding, position.y));
        
        // finalPos = { 
        //   x: `${constrainedLeft}px`, 
        //   y: `${constrainedTop}px`, 
        //   right: '0' 
        // };
      } else if (needFullscreen) {
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
    chrome.storage.local.get(["isFullscreen", "popupPosition", "popupSize"], (result) => {
      applyPopupStyles(result.isFullscreen || false, result.popupPosition, result.popupSize);
    });

    let resizeTimeout;
    const debouncedUpdate = () => {
      clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(() => {
        if (!document.getElementById(POPUP_ID)) return;
        chrome.storage.local.get(["isFullscreen", "popupPosition", "popupSize"], (result) => {
          applyPopupStyles(result.isFullscreen || false, result.popupPosition, result.popupSize);
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
      chrome.storage.local.get(["isFullscreen", "popupPosition", "popupSize"], (result) => {
        applyPopupStyles(result.isFullscreen || false, result.popupPosition, result.popupSize);
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
  
              // Update popup styles
              Object.assign(popup.style, {
                width: needFullscreen ? "100vw" : isLargeScreen ? `${defaultWidthRatio * 100}vw` : `${defaultWidthRatio * LARGE_SCREEN_MIN}px`,
                height: needFullscreen ? "100vh" : "96vh",
                right: needFullscreen ? "0" : "8px",
                left: needFullscreen?"0":"unset",
                top: needFullscreen ? "0" : "8px",
                borderRadius: needFullscreen ? "0" : "10px",
                boxShadow: needFullscreen ? "none" : "0 4px 15px rgba(0, 0, 0, 0.2)",
                transition: "width 0.3s ease, height 0.3s ease, top 0.3s ease, left 0.3s ease"
              });
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