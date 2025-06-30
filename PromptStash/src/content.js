// Supported platforms with selectors for primary input and editable previous prompts
const SUPPORTED_HOSTS = {
  "grok.com": {
    primarySelector: "div.query-bar textarea",
    previousPromptSelector: "div.message-bubble textarea[placeholder='Enter prompt here']",
    name: "Grok"
  },
  "perplexity.ai": {
    primarySelector: "textarea#ask-input, textarea[aria-placeholder='Ask anything or @ mention a Space'], div#ask-input",
    previousPromptSelector: "textarea:not(#ask-input)",
    name: "Perplexity.ai"
  },
  "chatgpt.com": {
    primarySelector: "div#prompt-textarea.ProseMirror[contenteditable='true']",
    previousPromptSelector: "textarea:not(#prompt-textarea)",
    name: "ChatGPT"
  }
};

// Cache for input field, container, and last focused field to reduce DOM queries
let cachedInputField = null;
let cachedInputContainer = null;
let lastFocusedField = null;

// Track the last focused editable field across supported platforms
function setupFocusTracking() {
  const hostname = window.location.hostname;
  const platform = Object.keys(SUPPORTED_HOSTS).find(host => hostname.includes(host));
  if (!platform) return;

  const { primarySelector, previousPromptSelector } = SUPPORTED_HOSTS[platform];

  // Combine selectors for all editable fields
  const allEditableSelectors = `${primarySelector}, ${previousPromptSelector}`;
  document.querySelectorAll(allEditableSelectors).forEach(field => {
    field.addEventListener('focus', () => {
      lastFocusedField = field;
      console.log(`Focused field updated:`, lastFocusedField);
    });
  });

  // Use MutationObserver to detect new editable fields dynamically
  const observer = new MutationObserver((mutations) => {
    mutations.forEach(mutation => {
      if (mutation.addedNodes.length) {
        mutation.addedNodes.forEach(node => {
          if (node.nodeType === Node.ELEMENT_NODE) {
            const fields = node.matches(allEditableSelectors) ? [node] : node.querySelectorAll(allEditableSelectors);
            fields.forEach(field => {
              field.addEventListener('focus', () => {
                lastFocusedField = field;
                console.log(`Focused field updated (dynamic):`, lastFocusedField);
              });
            });
          }
        });
      }
    });
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

// Handle messages from popup/background
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("Received message:", message);

  // Use cached input field or find new one for widget positioning
  let inputField = cachedInputField || findPrimaryInputField();
  let targetField = lastFocusedField && isFieldValid(lastFocusedField) ? lastFocusedField : inputField;

  if (inputField) {
    console.log("Primary input field found:", inputField, "Tag:", inputField.tagName, "Visible:", inputField.offsetParent !== null);
  } else {
    console.log("No primary input field found with initial querySelector.");
  }

  // Retry finding the input field up to 3 times if not found for widget positioning
  if (!inputField && (message.action === "sendPrompt" || message.action === "getPrompt")) {
    console.log("Retrying to find primary input field...");
    let retryCount = 0;
    const maxRetries = 3;
    const retryInterval = 500;
    const retry = () => {
      retryCount++;
      inputField = findPrimaryInputField();
      if (inputField) {
        console.log(`Primary input field found on retry ${retryCount}:`, inputField, "Tag:", inputField.tagName, "Visible:", inputField.offsetParent !== null);
        cachedInputField = inputField;
        targetField = lastFocusedField && isFieldValid(lastFocusedField) ? lastFocusedField : inputField;
        processMessage(message, targetField, sendResponse);
      } else if (retryCount < maxRetries) {
        console.log(`Retry ${retryCount} failed, retrying in ${retryInterval}ms...`);
        setTimeout(retry, retryInterval);
      } else {
        console.log("No primary input field found after max retries.");
        processMessage(message, targetField, sendResponse);
      }
    };
    setTimeout(retry, retryInterval);
    return true;
  }

  processMessage(message, targetField, sendResponse);
  return true; // Ensure async response
});

// Validate if a field is still valid (exists and is visible)
function isFieldValid(field) {
  return field && field.offsetParent !== null && document.body.contains(field);
}

// Process the message with the target field (focused or primary)
function processMessage(message, targetField, sendResponse) {
  if (message.action === "sendPrompt") {
    if (targetField) {
      console.log("Setting prompt to target field:", message.prompt, targetField);
      if (targetField.tagName === "DIV" && targetField.contentEditable === "true" && targetField.classList.contains("ProseMirror")) {
        targetField.innerHTML = "";
        const lines = message.prompt.split("\n");
        targetField.innerHTML = lines.map(line => `<p>${line}<br></p>`).join("");
        console.log("Cleared and set innerHTML for ChatGPT ProseMirror div with <p> and <br> tags.");
      } else if (targetField.tagName === "DIV" && targetField.contentEditable === "true") {
        targetField.innerHTML = "";
        targetField.innerHTML = message.prompt.replace(/\n/g, "<br>");
        console.log("Cleared and set innerHTML for contenteditable div with <br> for newlines.");
      } else {
        targetField.value = "";
        targetField.value = message.prompt;
        console.log("Cleared and set value for input/textarea.");
      }
      targetField.dispatchEvent(new Event("input", { bubbles: true }));
      targetField.dispatchEvent(new Event("change", { bubbles: true }));
      targetField.focus(); // Restore focus to the target field
      sendResponse({ success: true });
    } else {
      console.log("No target field found for sendPrompt");
      sendResponse({ success: false });
    }
  } else if (message.action === "getPrompt") {
    if (targetField) {
      let prompt;
      if (targetField.tagName === "DIV" && targetField.contentEditable === "true" && targetField.classList.contains("ProseMirror")) {
        const paragraphs = Array.from(targetField.querySelectorAll("p"));
        if (paragraphs.length > 0) {
          prompt = paragraphs.map(p => p.textContent.trimEnd()).join("\n");
          console.log("Retrieved prompt from ChatGPT ProseMirror div:", prompt);
        } else {
          prompt = targetField.textContent.replace(/\n+/g, "\n").trimEnd();
          console.log("Retrieved prompt from ChatGPT ProseMirror div (fallback):", prompt);
        }
      } else if (targetField.tagName === "DIV" && targetField.contentEditable === "true") {
        prompt = targetField.innerHTML.replace(/<br\s*\/?>/gi, "\n").replace(/<\/?[^>]+(>|$)/g, "").trimEnd();
        console.log("Retrieved prompt from contenteditable div:", prompt);
      } else {
        prompt = targetField.value || "";
        console.log("Retrieved prompt from input/textarea:", prompt);
      }
      sendResponse({ prompt });
    } else {
      console.log("No target field found for getPrompt");
      sendResponse({ prompt: "" });
    }
  } else if (message.action === "getSelectedText") {
    const selectedText = window.getSelection().toString();
    console.log("Retrieved selected text:", selectedText);
    sendResponse({ selectedText });
  }
}

// Find the primary input field based on platform-specific selectors
function findPrimaryInputField() {
  const hostname = window.location.hostname;
  console.log("Checking hostname for platform detection:", hostname);
  const platform = Object.keys(SUPPORTED_HOSTS).find(host => hostname.includes(host));
  if (!platform) {
    console.log("No supported platform detected for hostname:", hostname);
    return null;
  }
  const { primarySelector, name } = SUPPORTED_HOSTS[platform];
  console.log(`Attempting to find primary input field for ${name} with selector: ${primarySelector}`);
  const inputField = document.querySelector(primarySelector);
  if (inputField && inputField.offsetParent !== null) {
    console.log(`Found primary input field for ${name}:`, inputField, "Visible:", true);
    return inputField;
  }
  console.log(`No primary input field found for ${name} with selector: ${primarySelector}`);
  return null;
}

// Find the input container (parent element containing primary input field)
function findInputContainer(inputField) {
  if (!inputField) return null;
  // For grok.com, use query-bar as the container
  if (window.location.hostname.includes("grok.com")) {
    const queryBar = inputField.closest("div.query-bar");
    if (queryBar) {
      console.log("Found query-bar container for grok.com:", queryBar);
      return queryBar;
    }
  }
  // Generic logic for other platforms
  let parent = inputField.parentElement;
  while (parent && parent !== document.body) {
    // Look for common indicators of an input container (buttons, form, or specific classes)
    const hasButtons = parent.querySelectorAll('button, [role="button"], [type="submit"]').length > 0;
    const isForm = parent.tagName === 'FORM' || parent.tagName === 'DIV' && parent.classList.contains('input-container');
    if (hasButtons || isForm || parent.querySelector('[aria-label*="send" i], [aria-label*="submit" i]')) {
      return parent;
    }
    parent = parent.parentElement;
  }
  // Fallback to immediate parent if no suitable container is found
  return inputField.parentElement || document.body;
}

// Create the movable widget with only the extension button
function createWidget(inputField, inputContainer) {
  const widget = document.createElement('div');
  widget.id = 'promptstash-widget';
  widget.setAttribute('aria-live', 'polite'); // Accessibility: announce changes
  widget.innerHTML = `
      <button class="extension-button" aria-label="Open PromptStash" title="Open PromptStash">
        <img src="${chrome.runtime.getURL('icon48.png')}" alt="PromptStash Icon" aria-hidden="true" draggable="false" style="width: 30px; height: 30px;">
      </button>
  `;

  // Initialize widget with hidden visibility to prevent flashing at default position
  widget.style.position = 'absolute';
  widget.style.zIndex = '9999';
  widget.style.visibility = 'hidden'; // Hide until positioned
  widget.style.transition = 'top 0.3s ease, left 0.3s ease'; // Smooth transition for position changes

  // Initialize widget position with default offset
  let widgetOffset = { x: -100, y: -90 }; // Default offset from bottom-right corner

  // Create an offscreen container to measure widget size
  const offscreenContainer = document.createElement('div');
  offscreenContainer.style.position = 'absolute';
  offscreenContainer.style.top = '-9999px';
  offscreenContainer.style.left = '-9999px';
  offscreenContainer.appendChild(widget);
  document.body.appendChild(offscreenContainer);

  // Calculate initial position using input container and actual widget size
  if (inputContainer && inputContainer.offsetParent) {
    const containerRect = inputContainer.getBoundingClientRect();
    const parentRect = inputContainer.parentElement.getBoundingClientRect();
    const widgetRect = widget.getBoundingClientRect();
    let newLeft = containerRect.right + window.scrollX + widgetOffset.x;
    let newTop = containerRect.bottom + window.scrollY + widgetOffset.y;
    // Enforce boundaries within parent element
    newLeft = Math.max(parentRect.left + window.scrollX, Math.min(newLeft, parentRect.right + window.scrollX - widgetRect.width));
    newTop = Math.max(parentRect.top + window.scrollY, Math.min(newTop, parentRect.bottom + window.scrollY - widgetRect.height));
    widget.style.left = `${newLeft}px`;
    widget.style.top = `${newTop}px`;
  }

  // Remove from offscreen container and append to body, then make visible
  offscreenContainer.remove();
  document.body.appendChild(widget);
  widget.style.visibility = 'visible'; // Show widget after positioning

  // Update position with saved offset if available
  chrome.storage.local.get(['widgetOffset'], (result) => {
    if (result.widgetOffset) {
      widgetOffset = result.widgetOffset;
      updateWidgetPosition(); // Apply saved position
    }
  });

  // Enforce widget position within container boundaries
  function enforceBoundaries(containerRect, parentRect, widgetRect) {
    let newLeft = containerRect.right + window.scrollX + widgetOffset.x;
    let newTop = containerRect.bottom + window.scrollY + widgetOffset.y;

    // For grok.com, constrain strictly to query-bar bounds
    if (window.location.hostname.includes("grok.com")) {
      newLeft = Math.max(containerRect.left + window.scrollX, Math.min(newLeft, containerRect.right + window.scrollX - widgetRect.width));
      newTop = Math.max(containerRect.top + window.scrollY, Math.min(newTop, containerRect.bottom + window.scrollY - widgetRect.height));
    } else {
      // Generic bounds for other platforms
      newLeft = Math.max(parentRect.left + window.scrollX, Math.min(newLeft, parentRect.right + window.scrollX - widgetRect.width));
      newTop = Math.max(parentRect.top + window.scrollY, Math.min(newTop, parentRect.bottom + window.scrollY - widgetRect.height));
    }

    return { newLeft, newTop };
  }

  // Position widget relative to the bottom-right corner of the input container
  function updateWidgetPosition() {
    if (!inputContainer || !inputContainer.offsetParent) return; // Skip if container is not visible
    const containerRect = inputContainer.getBoundingClientRect();
    const widgetRect = widget.getBoundingClientRect();
    const parentRect = inputContainer.parentElement.getBoundingClientRect();

    // Enforce boundaries within parent element
    const { newLeft, newTop } = enforceBoundaries(containerRect, parentRect, widgetRect);

    widget.style.top = `${newTop}px`;
    widget.style.left = `${newLeft}px`;
  }

  // Add hover event listeners for opacity toggle
  widget.addEventListener('mouseenter', () => {
    widget.style.transform = 'scale(1.02)';
  });
  widget.addEventListener('mouseleave', () => {
    widget.style.transform = 'scale(1)';
  });

  // Observe input container resizing
  const resizeObserver = new ResizeObserver(debounce(() => {
    updateWidgetPosition();
  }, 50)); // Debounced to prevent excessive updates
  resizeObserver.observe(inputContainer);
  widget.resizeObserver = resizeObserver;

  // Update position on window resize (debounced for performance)
  const updatePositionDebounced = debounce(() => updateWidgetPosition(), 50);
  const resizeListener = () => updatePositionDebounced();
  window.addEventListener('resize', resizeListener);
  widget.resizeListener = resizeListener;

  // Obsolete: Widget repositioning for chat scrolling removed in v2.0
  // Scroll listeners for window and chat container were previously used but are no longer needed
  // const scrollListener = () => updatePositionDebounced();
  // window.addEventListener('scroll', scrollListener);
  // const chatContainer = findChatContainer(inputContainer);
  // if (chatContainer) {
  //   chatContainer.addEventListener('scroll', scrollListener);
  // }
  // widget.scrollListener = scrollListener;
  // widget.chatContainer = chatContainer;

  // Make widget draggable and save new position
  makeDraggable(widget, inputContainer, (newOffset) => {
    widgetOffset = newOffset;
    chrome.storage.local.set({ widgetOffset }, () => {
      console.log("Widget offset saved:", widgetOffset);
    });
  });

  // Event listeners for extension button with click and touch support
  const extensionButton = widget.querySelector('.extension-button');
  let isDragging = false;
  let startX, startY;
  let holdTimeout;
  let touchStartTime;

  // Handle mousedown to initiate potential drag
  extensionButton.addEventListener('mousedown', (e) => {
    startX = e.clientX;
    startY = e.clientY;
    isDragging = false;
    // Set isDragging to true after holding for 300ms
    holdTimeout = setTimeout(() => {
      isDragging = true;
    }, 300);
  });

  // Track movement to detect drag
  extensionButton.addEventListener('mousemove', (e) => {
    if (Math.abs(e.clientX - startX) > 1 || Math.abs(e.clientY - startY) > 1) {
      isDragging = true;
    }
  });

  // Handle click to open popup
  extensionButton.addEventListener('click', (e) => {
    clearTimeout(holdTimeout); // Clear hold timeout
    if (!isDragging) {
      // Check if popup is open
      const popup = document.getElementById("promptstash-popup");
      if (popup) {
        return;
      } else {
        chrome.runtime.sendMessage({ action: "togglePopup" });
      }
    }
    isDragging = false;
  });

  // Handle touchstart to record start time
  extensionButton.addEventListener('touchstart', (e) => {
    touchStartTime = Date.now();
    isDragging = false;
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    // Prevent default touch behavior to avoid scrolling/zooming
    e.preventDefault();
    // Set isDragging to true after holding for 300ms
    holdTimeout = setTimeout(() => {
      isDragging = true;
    }, 300);
  });

  // Handle touchmove to detect drag
  extensionButton.addEventListener('touchmove', (e) => {
    if (Math.abs(e.touches[0].clientX - startX) > 1 || Math.abs(e.touches[0].clientY - startY) > 1) {
      isDragging = true;
    }
  });

  // Debounced touchend handler to open popup on quick tap
  const debouncedTouchEnd = debounce((e) => {
    clearTimeout(holdTimeout); // Clear hold timeout
    const touchDuration = Date.now() - touchStartTime;
    if (!isDragging && touchDuration < 300) {
      // Trigger popup open on quick tap
      chrome.runtime.sendMessage({ action: "togglePopup" });
    }
    isDragging = false;
    e.preventDefault(); // Prevent default to avoid unintended clicks
  }, 300);

  // Handle touchend with debounced logic
  extensionButton.addEventListener('touchend', debouncedTouchEnd);

  // Handle touchcancel to reset state on interrupted touches
  extensionButton.addEventListener('touchcancel', () => {
    clearTimeout(holdTimeout); // Clear hold timeout
    isDragging = false; // Reset drag state
  });

  // Clear hold timeout if mouse leaves button
  extensionButton.addEventListener('mouseleave', () => {
    clearTimeout(holdTimeout);
  });

  // Ensure keyboard accessibility
  extensionButton.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === 'Space') {
      e.preventDefault();
      chrome.runtime.sendMessage({ action: "togglePopup" });
    }
  });

  return widget;
}

// Make the widget draggable within input container bounds
function makeDraggable(element, inputContainer, onPositionChange) {
  let isDragging = false;
  let offsetX, offsetY;

  // Start dragging on mousedown
  element.addEventListener('mousedown', (e) => {
    isDragging = true;
    offsetX = e.clientX - element.getBoundingClientRect().left;
    offsetY = e.clientY - element.getBoundingClientRect().top;
    element.style.transition = 'none'; // Disable transition during drag for instant response
  });

  // Update position during drag
  document.addEventListener('mousemove', (e) => {
    if (isDragging) {
      const containerRect = inputContainer.getBoundingClientRect();
      const widgetRect = element.getBoundingClientRect();
      // Use query-bar as boundary for grok.com, otherwise use parent
      const boundaryRect = window.location.hostname.includes("grok.com") ? containerRect : inputContainer.parentElement.getBoundingClientRect();

      let newLeft = e.clientX - offsetX;
      let newTop = e.clientY - offsetY;

      newLeft = Math.max(boundaryRect.left + window.scrollX, Math.min(newLeft, boundaryRect.right + window.scrollX - widgetRect.width));
      newTop = Math.max(boundaryRect.top + window.scrollY, Math.min(newTop, boundaryRect.bottom + window.scrollY - widgetRect.height));

      element.style.left = `${newLeft}px`;
      element.style.top = `${newTop}px`;

      // Calculate offset from bottom-right corner
      const newOffsetX = newLeft - (containerRect.right + window.scrollX);
      const newOffsetY = newTop - (containerRect.bottom + window.scrollY);
      onPositionChange({ x: newOffsetX, y: newOffsetY });
    }
  });

  // Stop dragging on mouseup, capturing events globally including over iframes
  window.addEventListener('mouseup', () => {
    if (isDragging) {
      isDragging = false;
      element.style.transition = 'top 0.3s ease, left 0.3s ease'; // Restore transition after drag
      console.log("Drag stopped on mouseup (global window listener)");
    }
  }, { capture: true }); // Use capture phase to ensure event is caught before iframe boundary

  // Stop dragging when pointer enters the popup iframe to prevent unintended dragging
  const popup = document.getElementById('promptstash-popup');
  if (popup) {
    popup.addEventListener('mouseenter', () => {
      if (isDragging) {
        isDragging = false;
        element.style.transition = 'top 0.3s ease, left 0.3s ease'; // Restore transition after drag
        console.log("Drag stopped on mouseenter popup iframe");
      }
    });
  }

  // Observe popup creation to attach mouseenter listener dynamically
  const observer = new MutationObserver(() => {
    const popup = document.getElementById('promptstash-popup');
    if (popup && !popup.dataset.mouseenterAttached) {
      popup.addEventListener('mouseenter', () => {
        if (isDragging) {
          isDragging = false;
          element.style.transition = 'top 0.3s ease, left 0.3s ease'; // Restore transition after drag
          console.log("Drag stopped on mouseenter popup iframe (dynamic listener)");
        }
      });
      popup.dataset.mouseenterAttached = 'true'; // Prevent multiple listeners
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

// Track widget creation and current input field/container
let currentInputField = null;
let currentInputContainer = null;
let widget = null;
let widgetCreated = false;

// Debounce function to limit rapid widget creation/removal
function debounce(func, wait) {
  let timeout;
  return function (...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), wait);
  };
}

// Attempt to create or update widget for the primary input field
const tryCreateWidget = debounce(function () {
  // Find the primary input field and its container
  let newInputField = findPrimaryInputField();
  let newInputContainer = findInputContainer(newInputField);
  
  // If no primary input field or container is found and widget exists, retry after a delay
  if (!newInputField || !newInputContainer) {
    if (widgetCreated && widget) {
      console.log("Primary input field/container temporarily unavailable, retrying in 500ms...");
      setTimeout(tryCreateWidget, 500);
    } else {
      console.log("No primary input field/container found, skipping widget creation.");
    }
    return;
  }

  // If a new valid primary input field and container are found
  if (newInputField && newInputContainer) {
    if (!widgetCreated) {
      // Create widget for the first time
      widget = createWidget(newInputField, newInputContainer);
      currentInputField = newInputField;
      currentInputContainer = newInputContainer;
      cachedInputField = newInputField;
      cachedInputContainer = newInputContainer;
      widgetCreated = true;
      console.log("Widget created for primary input field and container:", newInputField, newInputContainer);
    } else if (newInputField !== currentInputField || newInputContainer !== currentInputContainer) {
      // Input field or container changed, update widget
      if (widget) {
        // Clean up existing widget resources
        if (widget.resizeObserver) {
          widget.resizeObserver.disconnect();
        }
        if (widget.resizeListener) {
          window.removeEventListener('resize', widget.resizeListener);
        }
        // Obsolete: Widget repositioning for chat scrolling removed in v2.0
        // if (widget.scrollListener && widget.chatContainer) {
        //   widget.chatContainer.removeEventListener('scroll', widget.scrollListener);
        // }
        // if (widget.scrollListener) {
        //   window.removeEventListener('scroll', widget.scrollListener);
        // }
        widget.remove();
      }
      // Create new widget for the updated primary input field and container
      widget = createWidget(newInputField, newInputContainer);
      currentInputField = newInputField;
      currentInputContainer = newInputContainer;
      cachedInputField = newInputField;
      cachedInputContainer = newInputContainer;
      console.log("Widget recreated for updated primary input field and container:", newInputField, newInputContainer);
    }
    // If primary input field and container are the same, no action needed
  }
}, 150); // Debounce delay for dynamic DOM updates

// Initial setup
tryCreateWidget();
setupFocusTracking();

// Observe DOM changes for dynamic content
const observer = new MutationObserver(debounce(() => {
  // Only trigger if input field or container has changed
  const newInputField = findPrimaryInputField();
  const newInputContainer = findInputContainer(newInputField);
  if (newInputField !== cachedInputField || newInputContainer !== cachedInputContainer) {
    tryCreateWidget();
  }
  // Re-run focus tracking to catch new editable fields
  setupFocusTracking();
}, 150));
observer.observe(document.body, {
  childList: true,
  subtree: true,
  attributes: true,
  attributeFilter: ['class', 'aria-label', 'placeholder']
});