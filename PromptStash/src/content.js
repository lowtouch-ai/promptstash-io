// Establish a keep-alive connection with background script
const keepAlivePort = chrome.runtime.connect({ name: "keepAlive" });
keepAlivePort.postMessage({ status: "connected" });

// Periodic heartbeat to maintain connection
setInterval(() => {
  keepAlivePort.postMessage({ status: "heartbeat" });
}, 60000); // Send heartbeat every 1 minute

// Supported platforms with selectors for primary input and editable previous prompts
const SUPPORTED_HOSTS = {
  "grok.com": {
    primarySelector: "div.query-bar textarea",
    previousPromptSelector: "div.message-bubble textarea[placeholder='Enter prompt here']",
    name: "Grok"
  },
  "perplexity.ai": {
    primarySelector: "div#ask-input, textarea[aria-placeholder='Ask anything…'], textarea#ask-input",
    previousPromptSelector: "textarea:not(#ask-input)",
    name: "Perplexity.ai"
  },
  "chatgpt.com": {
    primarySelector: "div#prompt-textarea.ProseMirror[contenteditable='true']",
    previousPromptSelector: "textarea:not(#prompt-textarea)",
    name: "ChatGPT"
  },
  "gemini.google.com": {
    primarySelector: "div.ql-editor, div.textarea[data-placeholder='Ask Gemini'], rich-textarea[aria-label='Enter a prompt here'] div.ql-editor",
    previousPromptSelector: "textarea[aria-label='Edit prompt']",
    name: "Gemini"
  },
  "claude.ai": {
    primarySelector: "div[aria-label='Write your prompt to Claude'].ProseMirror",
    previousPromptSelector: "textarea.bg-bg-000, div.bg-bg-000, textarea[aria-label*='screen reader interactions']",
    name: "Claude"
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

  // Attach a document-level focusin listener to track focus on editable fields
  document.addEventListener('focusin', (event) => {
    const target = event.target;
    if (target.matches(allEditableSelectors)) {
      lastFocusedField = target;
      // console.log(`Focused field updated via focusin:`, target);
    }
  });

  // Check if an editable field is already focused on initialization
  const currentFocused = document.activeElement;
  if (currentFocused && currentFocused.matches(allEditableSelectors)) {
    lastFocusedField = currentFocused;
    // console.log(`Initial focused field set:`, currentFocused);
  }
}

// Handle messages from popup/background
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // console.log("Received message:", message);

  // Use cached input field or find new one for widget positioning
  let inputField = cachedInputField || findPrimaryInputField();
  let targetField = lastFocusedField && isFieldValid(lastFocusedField) ? lastFocusedField : inputField;

  if (inputField) {
    // console.log("Primary input field found:", inputField.tagName, "Visible:", inputField.offsetParent !== null);
  } else {
    // console.log("No primary input field found with initial querySelector.");
  }

  // Retry finding the input field up to 3 times if not found for widget positioning
  if (!inputField && (message.action === "sendPrompt" || message.action === "getPrompt")) {
    // console.log("Retrying to find primary input field...");
    let retryCount = 0;
    const maxRetries = 3;
    const retryInterval = 500;
    const retry = () => {
      retryCount++;
      inputField = findPrimaryInputField();
      if (inputField) {
        // console.log(`Primary input field found on retry ${retryCount}:`, inputField.tagName, "Visible:", inputField.offsetParent !== null);
        cachedInputField = inputField;
        targetField = lastFocusedField && isFieldValid(lastFocusedField) ? lastFocusedField : inputField;
        processMessage(message, targetField, sendResponse);
      } else if (retryCount < maxRetries) {
        // console.log(`Retry ${retryCount} failed, retrying in ${retryInterval}ms...`);
        setTimeout(retry, retryInterval);
      } else {
        // console.log("No primary input field found after max retries.");
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

function isFieldEditable(field) {
  if (field.tagName === "TEXTAREA" || field.tagName === "INPUT") {
    return !field.disabled && !field.readOnly;
  } else if (field.tagName === "DIV" && field.contentEditable === "true") {
    return true;
  }
  return false;
}

// Process the message with the target field (focused or primary)
function processMessage(message, targetField, sendResponse) {
  if (message.action === "sendPrompt") {
    if (!message.prompt || !message.prompt.trim()) {
      // console.log("Empty or invalid prompt received.");
      sendResponse({ success: false, error: "Prompt is empty or invalid" });
      return;
    }

    if (targetField) {
      if (isFieldEditable(targetField)) {
        // console.log("Target field for sendPrompt:", targetField, "Type:", targetField.tagName);
        const hostname = window.location.hostname;
        // console.log(`Target field innerHTML before clearing:`, targetField.innerHTML);

        // Clear existing content based on field type
        if (targetField.tagName === "TEXTAREA" || targetField.tagName === "INPUT") {
          targetField.value = "";
          // console.log(`Target field value after clearing:`, targetField.value);
        } else {
          targetField.innerHTML = "";
          // console.log(`Target field innerHTML after clearing:`, targetField.innerHTML);
        }

        // Handle Perplexity.ai
        if (hostname.includes("perplexity.ai")) {
          // Handle Lexical editor for fresh chats (#ask-input div)
          if (targetField.id === "ask-input" && targetField.getAttribute("data-lexical-editor") === "true") {
            // Focus the field first to ensure proper state
            targetField.focus();
            
            // Clear existing content by selecting all and replacing
            const selectAllEvent = new KeyboardEvent("keydown", {
              key: "a",
              ctrlKey: true,
              bubbles: true,
              cancelable: true
            });
            targetField.dispatchEvent(selectAllEvent);
            
            // Small delay to ensure selection is processed
            setTimeout(() => {
              // Clear the innerHTML directly
              targetField.innerHTML = "";
              
              // Create new paragraph for the prompt
              const p = document.createElement("p");
              p.setAttribute("dir", "ltr");
              
              // Handle empty prompt
              if (!message.prompt.trim()) {
                const span = document.createElement("span");
                span.setAttribute("data-lexical-text", "true");
                span.textContent = "";
                p.appendChild(span);
              } else {
                // Split by lines and preserve line breaks
                const lines = message.prompt.split("\n");
                lines.forEach((line, index) => {
                  const span = document.createElement("span");
                  span.setAttribute("data-lexical-text", "true");
                  span.textContent = line;
                  p.appendChild(span);
                  
                  // Add line break except for the last line
                  if (index < lines.length - 1) {
                    p.appendChild(document.createElement("br"));
                  }
                });
              }
              
              // Set the new content
              targetField.appendChild(p);
              
              // Dispatch only ONE input event to notify Lexical editor
              const inputEvent = new InputEvent("input", {
                bubbles: true,
                cancelable: true,
                inputType: "insertText",
                data: message.prompt
              });
              targetField.dispatchEvent(inputEvent);
              
              // Set cursor position to end of content
              const range = document.createRange();
              const selection = window.getSelection();
              range.selectNodeContents(p);
              range.collapse(false);
              selection.removeAllRanges();
              selection.addRange(range);
              
              // console.log("Perplexity Lexical editor updated with new content");
            }, 5);
          }
          // Handle textarea elements for follow-up queries and edit-mode
          else if (targetField.tagName === "TEXTAREA") {
            // For textarea, simply replace the value
            targetField.focus();
            targetField.value = message.prompt;
            
            // Dispatch only one input event
            targetField.dispatchEvent(new Event("input", { bubbles: true }));
            
            // Set cursor to end
            targetField.setSelectionRange(targetField.value.length, targetField.value.length);
            
            // console.log("Perplexity textarea updated with new content");
          }
        }
        // Handle ProseMirror or Quill editor
        else if (targetField.tagName === "DIV" && targetField.contentEditable === "true" && (targetField.classList.contains("ProseMirror") || targetField.classList.contains("ql-editor"))) {
          const lines = message.prompt.split("\n");
          targetField.innerHTML = lines.map(line => `<p>${line}<br></p>`).join("");
          // console.log("Set innerHTML for ProseMirror or Quill editor with <p> and <br> tags.");
        }
        // Handle generic contenteditable div
        else if (targetField.tagName === "DIV" && targetField.contentEditable === "true") {
          targetField.innerHTML = message.prompt.replace(/\n/g, "<br>");
          // console.log("Set innerHTML for contenteditable div with <br> for newlines.");
        }
        // Handle textarea or input elements
        else {
          targetField.value = message.prompt;
          // console.log("Set value for input/textarea.");
        }

        // Dispatch input and change events for non-Perplexity platforms
        if (!hostname.includes("perplexity.ai")) {
          targetField.dispatchEvent(new Event("input", { bubbles: true }));
          targetField.dispatchEvent(new Event("change", { bubbles: true }));
        }
      targetField.focus(); // Restore focus to the target field
      sendResponse({ success: true });
      } else {
        // console.log("Target field is not editable");
        sendResponse({ success: false, error: "Target field is not editable" });
      }
    } else {
      // console.log("No target field found for sendPrompt");
      sendResponse({ success: false, error: "No target field found" });
    }
  } else if (message.action === "getPrompt") {
    if (targetField) {
      // console.log("Target field for getPrompt:", targetField, "Type:", targetField.tagName);
      let prompt;
      // Retrieve prompt from Perplexity.ai Lexical editor
      if (window.location.hostname.includes("perplexity.ai") && targetField.id === "ask-input" && targetField.getAttribute("data-lexical-editor") === "true") {
        const spans = targetField.querySelectorAll("span[data-lexical-text='true']");
        if (spans.length > 0) {
          prompt = Array.from(spans)
            .map(span => span.textContent.trimEnd())
            .filter(text => text)
            .join("\n");
          // console.log("Retrieved prompt from Perplexity.ai Lexical editor:", prompt);
        } else {
          prompt = targetField.textContent.replace(/\n+/g, "\n").trimEnd();
          // console.log("Retrieved prompt from Perplexity.ai Lexical editor (fallback):", prompt);
        }
      }
      // Retrieve prompt from ProseMirror or Quill editor
      else if (targetField.tagName === "DIV" && targetField.contentEditable === "true" && (targetField.classList.contains("ProseMirror") || targetField.classList.contains("ql-editor"))) {
        const paragraphs = Array.from(targetField.querySelectorAll("p"));
        if (paragraphs.length > 0) {
          prompt = paragraphs.map(p => p.textContent.trimEnd()).join("\n");
          // console.log("Retrieved prompt from ProseMirror or Quill editor:", prompt);
        } else {
          prompt = targetField.textContent.replace(/\n+/g, "\n").trimEnd();
          // console.log("Retrieved prompt from ProseMirror or Quill editor (fallback):", prompt);
        }
      }
      // Retrieve prompt from generic contenteditable div
      else if (targetField.tagName === "DIV" && targetField.contentEditable === "true") {
        prompt = targetField.innerHTML.replace(/<br\s*\/?>/gi, "\n").replace(/<\/?[^>]+(>|$)/g, "").trimEnd();
        // console.log("Retrieved prompt from contenteditable div:", prompt);
      }
      // Retrieve prompt from textarea or input
      else {
        prompt = targetField.value || "";
        // console.log("Retrieved prompt from input/textarea:", prompt);
      }
      sendResponse({ prompt });
    } else {
      // console.log("No target field found for getPrompt");
      sendResponse({ prompt: "" });
    }
  } else if (message.action === "getSelectedText") {
    const selectedText = window.getSelection().toString();
    // console.log("Retrieved selected text:", selectedText);
    sendResponse({ selectedText });
  } else if (message.action === "ping") {
    sendResponse({ status: "alive" });
  }
}

// Find the primary input field based on platform-specific selectors
function findPrimaryInputField() {
  const hostname = window.location.hostname;
  // console.log("Checking hostname for platform detection:", hostname);
  const platform = Object.keys(SUPPORTED_HOSTS).find(host => hostname.includes(host));
  if (!platform) {
    // console.log("No supported platform detected for hostname:", hostname);
    return null;
  }
  const { primarySelector, name } = SUPPORTED_HOSTS[platform];
  // console.log(`Attempting to find primary input field for ${name} with selector: ${primarySelector}`);
  const inputField = document.querySelector(primarySelector);
  if (inputField && inputField.offsetParent !== null) {
    // console.log(`Found primary input field for ${name}:`, inputField.tagName, "Visible:", true);
    return inputField;
  }
  // console.log(`No primary input field found for ${name} with selector: ${primarySelector}`);
  return null;
}

// Find the input container (parent element containing primary input field)
function findInputContainer(inputField) {
  if (!inputField) return null;
  // For grok.com, use query-bar as the container
  if (window.location.hostname.includes("grok.com")) {
    const queryBar = inputField.closest("div.query-bar");
    if (queryBar) {
      // console.log("Found query-bar container for grok.com:", queryBar);
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

// Utility function to compare two DOMRect objects for position/size changes
function rectsAreEqual(rect1, rect2) {
  if (!rect1 || !rect2) return false;
  return rect1.top === rect2.top && rect1.left === rect2.left &&
         rect1.width === rect2.width && rect1.height === rect2.height;
}

// Create the movable widget with only the extension button
function createWidget(inputField, inputContainer) {
  const widget = document.createElement('div');
  widget.id = 'promptstash-widget';
  widget.setAttribute('aria-live', 'polite'); // Accessibility: announce changes
  widget.innerHTML = `
    <button class="extension-button" style="background: none; border: none; border-radius: 100%;" aria-label="Open PromptStash" title="Open PromptStash">
      <img src="${chrome.runtime.getURL('icon48.png')}" alt="PromptStash" aria-hidden="true" draggable="false" style="width: 30px; height: 30px;">
    </button>
  `;

  // Initialize widget with hidden visibility to prevent flashing
  widget.style.position = 'absolute';
  widget.style.zIndex = '9999';
  widget.style.visibility = 'hidden'; // Hide until positioned
  widget.style.borderRadius = '100%';

  // Initialize widget position with default offset
  let widgetOffset = { x: 30, y: -30 }; // Default offset from bottom-right corner

  // Create an offscreen container to measure widget size
  // const offscreenContainer = document.createElement('div');
  // offscreenContainer.style.position = 'absolute';
  // offscreenContainer.style.top = '-9999px';
  // offscreenContainer.style.left = '-9999px';
  // offscreenContainer.appendChild(widget);
  // document.body.appendChild(offscreenContainer);

  // Calculate initial position using input container and widget size
  if (inputContainer && inputContainer.offsetParent) {
    const containerRect = inputContainer.getBoundingClientRect();
    const parentRect = inputContainer.parentElement.getBoundingClientRect();
    const widgetRect = widget.getBoundingClientRect();
    let newLeft = containerRect.right + window.scrollX + widgetOffset.x;
    let newTop = containerRect.top + window.scrollY + widgetOffset.y;
    let maxMinOffset = 0.3 * widgetRect.width;
    // Enforce boundaries within parent element
    newLeft = Math.max(parentRect.left + window.scrollX - maxMinOffset, Math.min(newLeft, parentRect.right + window.scrollX - widgetRect.width + maxMinOffset));
    newTop = Math.max(parentRect.top + window.scrollY - maxMinOffset, Math.min(newTop, parentRect.bottom + window.scrollY - widgetRect.height + maxMinOffset));
    widget.style.left = `${newLeft}px`;
    widget.style.top = `${newTop}px`;
  }

  // Remove from offscreen container and append to body, then make visible
  // offscreenContainer.remove();
  document.body.appendChild(widget);
  setTimeout(() => {
    widget.style.visibility = 'visible'; // Show widget after positioning
  }, 50); // Small delay to ensure visibility after positioning

  // Store initial container rectangle to detect position changes later
  widget.previousContainerRect = inputContainer.getBoundingClientRect();

  // Update position with saved offset if available
  chrome.storage.local.get(['widgetOffset'], (result) => {
    if (result.widgetOffset) {
      widgetOffset = result.widgetOffset;
      updateWidgetPosition();
    }
  });

  // Enforce widget position within container boundaries
  function enforceBoundaries(containerRect, parentRect, widgetRect) {
    let newLeft = containerRect.right + window.scrollX + widgetOffset.x;
    let newTop = containerRect.top + window.scrollY + widgetOffset.y;
    let maxMinOffset = 0.3 * widgetRect.width;
    // For grok.com, constrain strictly to query-bar bounds
    if (window.location.hostname.includes("grok.com")) {
      newLeft = Math.max(containerRect.left + window.scrollX - maxMinOffset, Math.min(newLeft, containerRect.right + window.scrollX - widgetRect.width + maxMinOffset));
      newTop = Math.max(containerRect.top + window.scrollY - maxMinOffset, Math.min(newTop, containerRect.bottom + window.scrollY - widgetRect.height + maxMinOffset));
    } else {
      // Generic bounds for other platforms
      newLeft = Math.max(parentRect.left + window.scrollX - maxMinOffset, Math.min(newLeft, parentRect.right + window.scrollX - widgetRect.width + maxMinOffset));
      newTop = Math.max(parentRect.top + window.scrollY - maxMinOffset, Math.min(newTop, parentRect.bottom + window.scrollY - widgetRect.height + maxMinOffset));
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

  // Expose updateWidgetPosition for dynamic updates
  widget.updatePosition = updateWidgetPosition;

  const extensionButton = widget.querySelector('.extension-button');

  // Add hover effect for visual feedback
  extensionButton.addEventListener('pointerenter', () => {
    extensionButton.style.transform = 'scale(1.02)';
  });
  extensionButton.addEventListener('pointerleave', () => {
    extensionButton.style.transform = 'scale(1)';
  });

  // Observe input container resizing (e.g., while typing)
  const resizeObserver = new ResizeObserver(debounce(() => {
    updateWidgetPosition();
  }, 100));
  resizeObserver.observe(inputContainer);
  widget.resizeObserver = resizeObserver;

  // Update position on window resize
  const updatePositionDebounced = debounce(() => updateWidgetPosition(), 100);
  const resizeListener = () => updatePositionDebounced();
  window.addEventListener('resize', resizeListener);
  widget.resizeListener = resizeListener;

  // Make widget draggable and handle popup interaction
  makeDraggable(widget, inputContainer, (newOffset) => {
    widgetOffset = newOffset;
    // console.log("Widget position updated:", widgetOffset);
    chrome.storage.local.set({ widgetOffset }, () => {});
  });

  // Handle pointer events for button interaction
  let isDragging = false;
  let startX, startY;
  let holdTimeout;
  let pointerStartTime;

  // Trottle togglePopup to prevent rapid clicks
  const throttledTogglePopup = throttle(() => {
      chrome.runtime.sendMessage({ action: "togglePopup" })
  }, 500);

  widget.addEventListener('pointerdown', (e) => {
    e.preventDefault(); // Prevent default behaviors like text selection or scrolling
    if (document.getElementById('promptstash-popup')) return; // Prevent interaction if popup is open
    startX = e.clientX;
    startY = e.clientY;
    pointerStartTime = Date.now();
    isDragging = false;
    holdTimeout = setTimeout(() => {
      isDragging = true;
      widget.style.cursor = 'grabbing'; // Visual feedback for drag mode
    }, 300);

  const onPointerMove = (e) => {
    if (!isDragging && (Math.abs(e.clientX - startX) > 1 || Math.abs(e.clientY - startY) > 1)) {
      isDragging = true;
      widget.style.cursor = 'grabbing';
    }
  };

  const onPointerUp = () => {
    // Handle popup opening on quick tap/click
    clearTimeout(holdTimeout);
    const duration = Date.now() - pointerStartTime;
    if (!isDragging && duration < 300 && !document.getElementById('promptstash-popup')) {
      throttledTogglePopup();
    }
    isDragging = false;
    widget.style.cursor = '';
    document.removeEventListener('pointermove', onPointerMove);
    document.removeEventListener('pointerup', onPointerUp);
  };

  document.addEventListener('pointermove', onPointerMove);
  document.addEventListener('pointerup', onPointerUp);
  });

  widget.addEventListener('pointercancel', () => {
    // Handle interrupted interactions
    clearTimeout(holdTimeout);
    isDragging = false;
    widget.style.cursor = ''; // Reset cursor
  });

  widget.addEventListener('pointerleave', () => {
    clearTimeout(holdTimeout);
    isDragging = false;
    widget.style.cursor = ''; // Reset cursor
  });

  // Ensure keyboard accessibility
  extensionButton.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { // Space key support per accessibility standards
      e.preventDefault();
      if (!document.getElementById('promptstash-popup')) {
        throttledTogglePopup();
      }
      isDragging = false;
      widget.style.cursor = ''; // Reset cursor
    }
  });

  // Add ARIA attributes for accessibility
  extensionButton.setAttribute('role', 'button');
  extensionButton.setAttribute('tabindex', '0'); // Make button focusable

  return widget;
}

// Make the widget draggable within input container bounds
function makeDraggable(element, inputContainer, onPositionChange) {
  let isDragging = false;
  let offsetX, offsetY;

  element.addEventListener('pointerdown', (e) => {
    e.preventDefault(); // Prevent default behaviors
    if (document.getElementById('promptstash-popup')) return; // Prevent dragging if popup is open
    isDragging = true;
    offsetX = e.clientX - element.getBoundingClientRect().left;
    offsetY = e.clientY - element.getBoundingClientRect().top;
    element.style.cursor = 'grabbing'; // Visual feedback
  });

  window.addEventListener('pointermove', (e) => {
    // Handle drag movement
    if (!isDragging) return;
    const containerRect = inputContainer.getBoundingClientRect();
    const widgetRect = element.getBoundingClientRect();
    const boundaryRect = window.location.hostname.includes("grok.com") 
      ? containerRect 
      : inputContainer.parentElement.getBoundingClientRect();

    let newLeft = e.clientX - offsetX;
    let newTop = e.clientY - offsetY;
    let maxMinOffset = 0.3 * widgetRect.width;

    newLeft = Math.max(boundaryRect.left + window.scrollX - maxMinOffset, Math.min(newLeft, boundaryRect.right + window.scrollX - widgetRect.width + maxMinOffset));
    newTop = Math.max(boundaryRect.top + window.scrollY - maxMinOffset, Math.min(newTop, boundaryRect.bottom + window.scrollY - widgetRect.height + maxMinOffset));

    element.style.left = `${newLeft}px`;
    element.style.top = `${newTop}px`;

    // Calculate offset from bottom-right corner
    const newOffsetX = newLeft - (containerRect.right + window.scrollX);
    const newOffsetY = newTop - (containerRect.top + window.scrollY);
    onPositionChange({ x: newOffsetX, y: newOffsetY });
  }, { capture: true }); // Capture phase for iframe compatibility

  window.addEventListener('pointerup', () => {
    isDragging = false;
    element.style.cursor = ''; // Reset cursor
  }, { capture: true });

  window.addEventListener('pointercancel', () => {
    // Handle interrupted drags
    isDragging = false;
    element.style.cursor = ''; // Reset cursor
  }, { capture: true });

  // Observe popup creation dynamically
  const observer = new MutationObserver(() => {
    const popup = document.getElementById('promptstash-popup');
    if (popup && !popup.dataset.pointerenterAttached) {
      popup.addEventListener('pointerenter', () => {
        isDragging = false;
        element.style.cursor = ''; // Reset cursor
      });
      popup.dataset.pointerenterAttached = 'true'; // Prevent multiple listeners
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

// Throttle function to limit rapid calls to a function
function throttle(func, wait) {
  let inThrottle = false;
  return function (...args) {
    if (!inThrottle) {
      func.apply(this, args);
      inThrottle = true;
      setTimeout(() => {
        inThrottle = false;
      }, wait);
    }
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
      // console.log("Primary input field/container temporarily unavailable, retrying in 500ms...");
      setTimeout(tryCreateWidget, 500);
    } else {
      // console.log("No primary input field/container found, skipping widget creation.");
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
      // console.log("Widget created for primary input field and container:", newInputField, newInputContainer);
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
        widget.remove();
      }
      // Create new widget for the updated primary input field and container
      widget = createWidget(newInputField, newInputContainer);
      currentInputField = newInputField;
      currentInputContainer = newInputContainer;
      cachedInputField = newInputField;
      widgetCreated = true;
    } else {
      // Check for position changes in the same input container (e.g., ChatGPT input field moving)
      if (widgetCreated && widget && newInputContainer) {
        const currentRect = newInputContainer.getBoundingClientRect();
        if (!widget.previousContainerRect || !rectsAreEqual(widget.previousContainerRect, currentRect)) {
          widget.updatePosition(); // Reposition widget if container's bounding rect changes
          widget.previousContainerRect = currentRect; // Update stored rect for next comparison
        }
      }
    }
  }
}, 150); // Debounce delay for dynamic DOM updates

// Initial setup
tryCreateWidget();
setupFocusTracking();

// Observe DOM changes for dynamic content
const observer = new MutationObserver(debounce(() => {
  tryCreateWidget();
  setupFocusTracking();
}, 150));
observer.observe(document.body, {
  childList: true,
  subtree: true,
  attributes: true,
  attributeFilter: ['class', 'style', 'aria-label', 'placeholder'] // Include 'style' to catch position-related changes
});