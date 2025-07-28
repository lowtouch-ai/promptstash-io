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

// Track widgets for all editable fields
let widgetManager = {
  widgets: new Map(), // Map of element -> widget
  widgetCreated: false,
  currentInputField: null,
  currentInputContainer: null
};

// Enhanced visibility check function
function isElementVisible(element) {
  const rect = element.getBoundingClientRect();
  const style = window.getComputedStyle(element);
  
  // Basic visibility checks
  if (rect.width <= 0 || rect.height <= 0 || 
      style.display === 'none' || 
      style.visibility === 'hidden' || 
      style.opacity === '0') {
    return false;
  }
  
  // Check if element is behind another element (like a modal)
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  const elementAtPoint = document.elementFromPoint(centerX, centerY);
  
  // Check if the element or one of its children is at the top
  return element.contains(elementAtPoint) || elementAtPoint === element;
}


/**
 * Finds all relevant editable elements and filters out known interfering elements.
 */
function findAllEditableElements() {
  const hostname = window.location.hostname;
  const platform = Object.keys(SUPPORTED_HOSTS).find(host => hostname.includes(host));
  if (!platform) return [];

  const { primarySelector, previousPromptSelector } = SUPPORTED_HOSTS[platform];
  const allSelectors = [primarySelector, previousPromptSelector, 'textarea:not([disabled]):not([readonly])', 'div[contenteditable="true"]'].filter(Boolean).join(', ');

  return Array.from(document.querySelectorAll(allSelectors))
    // THE FIX: Ignore elements injected by Grammarly
    // .filter(el => !el.matches('[class*="grammarly"], [data-gramm="false"], [aria-label*="Grammarly" i]'))
    .filter(el => isElementVisible(el) && isFieldEditable(el));
}

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

// Generate unique ID for widget
function generateWidgetId(element) {
  return `promptstash-widget`;
  // return `promptstash-widget-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}
// ADD THIS NEW HELPER FUNCTION to content.js

/**
 * Generates a unique and stable storage key for a given input field.
 * It creates a "fingerprint" based on the element's attributes.
 * @param {HTMLElement} inputField The textarea or contenteditable div.
 * @returns {string} A unique key for chrome.storage, e.g., "promptstash-widget-pos-grok.com-instructions"
 */
function getWidgetStorageKey(inputField) {
  const hostname = window.location.hostname;
  let uniquePart = 'default';

  const placeholder = inputField.getAttribute('placeholder');
  const ariaLabel = inputField.getAttribute('aria-label');
  
  // NEW PRIORITY: id > placeholder > aria-label
  if (inputField.id) {
    uniquePart = inputField.id;
  } else if (placeholder) {
    uniquePart = placeholder;
  } else if (ariaLabel) {
    uniquePart = ariaLabel;
  }

  const sanitizedPart = uniquePart.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  return `promptstash-widget-pos-${hostname}-${sanitizedPart}`;
}

// REPLACE your createWidget function with this version
function createWidget(inputField, inputContainer) {
    const containerStyle = window.getComputedStyle(inputContainer);
    if (containerStyle.position === 'static') {
        inputContainer.style.position = 'relative';
    }

    const widget = document.createElement('div');
    const widgetId = generateWidgetId(inputField);
    widget.id = widgetId;
    widget.className = 'promptstash-widget';

    // Set base styles
    widget.style.position = 'absolute';
    widget.style.zIndex = '9999';
    widget.style.cursor = 'pointer';
    widget.style.width = '30px';
    widget.style.height = '30px';

    // *** NEW: Generate the element-specific key ***
    const storageKey = getWidgetStorageKey(inputField);

    // Load the saved top/right offset using the specific key
    chrome.storage.local.get(storageKey, (result) => {
        const savedPosition = result[storageKey];
        if (savedPosition && savedPosition.right && savedPosition.top) {
            widget.style.right = savedPosition.right;
            widget.style.top = savedPosition.top;
            widget.style.left = 'auto';
            console.log(`PromptStash: Loaded position for key: ${storageKey}`);
        } else {
            widget.style.right = '10px';
            widget.style.top = '10px';
            console.log(`PromptStash: Using default position for key: ${storageKey}`);
        }
    });

    widget.innerHTML = `
        <img src="${chrome.runtime.getURL('icon48.png')}" alt="Open PromptStash" title="Open PromptStash" style="width: 100%; height: 100%; display: block; user-select: none; -webkit-user-drag: none;" draggable="false">
    `;

    inputContainer.appendChild(widget);
    widget.associatedField = inputField;

    // *** NEW: Pass the inputField to makeDraggable so it can generate the same key ***
    makeDraggable(widget, inputContainer, inputField, () => {});

    // ... (rest of the function is the same)
    widget.setAttribute('role', 'button');
    widget.setAttribute('tabindex', '0');
    widget.setAttribute('aria-label', 'Open PromptStash');
    
    widget.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            if (!document.getElementById('promptstash-popup')) {
                if (widget.associatedField && isFieldValid(widget.associatedField)) {
                    widget.associatedField.focus();
                    lastFocusedField = widget.associatedField;
                }
                chrome.runtime.sendMessage({ action: "togglePopup" });
            }
        }
    });
    
    return widget;
}

// REPLACE your makeDraggable function with this version
function makeDraggable(widget, container, inputField, onPositionChange) {
    let isDragging = false;
    let dragStarted = false;
    let startX, startY, initialLeft, initialTop;

    // *** NEW: Generate the element-specific key for saving ***
    const storageKey = getWidgetStorageKey(inputField);

    const onPointerDown = (e) => {
        if (e.button !== 0) return;
        if (document.getElementById('promptstash-popup')) return;

        e.preventDefault();
        isDragging = true;
        dragStarted = false;
        startX = e.clientX;
        startY = e.clientY;

        const rect = widget.getBoundingClientRect();
        const containerRect = container.getBoundingClientRect();

        initialLeft = rect.left - containerRect.left;
        initialTop = rect.top - containerRect.top;

        widget.style.left = `${initialLeft}px`;
        widget.style.top = `${initialTop}px`;
        widget.style.right = 'auto';

        window.addEventListener('pointermove', onPointerMove);
        window.addEventListener('pointerup', onPointerUp);
    };

    const onPointerMove = (e) => {
        if (!isDragging) return;
        if (!dragStarted && (Math.abs(e.clientX - startX) > 5 || Math.abs(e.clientY - startY) > 5)) {
            dragStarted = true;
            widget.style.cursor = 'grabbing';
        }

        if (dragStarted) {
            e.preventDefault();
            const dx = e.clientX - startX;
            const dy = e.clientY - startY;

            let newLeft = initialLeft + dx;
            let newTop = initialTop + dy;

            newLeft = Math.max(0, Math.min(newLeft, container.offsetWidth - widget.offsetWidth));
            newTop = Math.max(0, Math.min(newTop, container.offsetHeight - widget.offsetHeight));

            widget.style.left = `${newLeft}px`;
            widget.style.top = `${newTop}px`;
        }
    };

    const onPointerUp = (e) => {
        if (!isDragging) return;

        if (dragStarted) {
            const finalLeft = parseFloat(widget.style.left);
            const newRight = container.offsetWidth - finalLeft - widget.offsetWidth;
            
            const positionToSave = {
                right: `${newRight}px`,
                top: widget.style.top
            };

            // *** NEW: Save using the specific key ***
            chrome.storage.local.set({ [storageKey]: positionToSave }, () => {
                console.log(`PromptStash: Position saved for key: ${storageKey}`);
            });

            widget.style.right = positionToSave.right;
            widget.style.left = 'auto';
        } else {
            // Click logic
            if (widget.associatedField && isFieldValid(widget.associatedField)) {
                widget.associatedField.focus();
                lastFocusedField = widget.associatedField;
            }
            chrome.runtime.sendMessage({ action: "togglePopup" });
        }

        isDragging = false;
        widget.style.cursor = 'pointer';

        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', onPointerUp);
    };

    widget.addEventListener('pointerdown', onPointerDown);
}

// Clean up widget resources
function cleanupWidget(widget) {
  if (widget.resizeObserver) {
    widget.resizeObserver.disconnect();
  }
  if (widget.resizeListener) {
    window.removeEventListener('resize', widget.resizeListener);
  }
  if (widget.parentNode) {
    widget.remove();
  }
}

// Manage widgets for all editable elements
function manageWidgets() {
  // <<<--- ADD THIS CHECK HERE ---<<<
  // If the popup is open, do nothing. This prevents the widget from being
  // destroyed and recreated, which would reset its position.
  if (document.getElementById('promptstash-popup')) {
    return;
  }
  // --- END OF ADDITION --- >>>
  const editableElements = findAllEditableElements();
  const currentWidgets = new Set(widgetManager.widgets.keys());
  

  // Remove widgets for elements that are no longer visible or valid
  for (const element of currentWidgets) {
    if (!editableElements.includes(element) || !isFieldValid(element)) {
      const widget = widgetManager.widgets.get(element);
      if (widget) {
        cleanupWidget(widget);
        widgetManager.widgets.delete(element);
        console.log("Removed widget for element:", element);
      }
    }
  }
  
  // Create widgets for new editable elements
  for (const element of editableElements) {
    if (!widgetManager.widgets.has(element)) {
      const container = findInputContainer(element);
      if (container) {
        const widget = createWidget(element, container);
        widgetManager.widgets.set(element, widget);
        console.log("Created widget for element:", element);
      }
    } else {
      // Update existing widget position if needed
      const widget = widgetManager.widgets.get(element);
      const container = findInputContainer(element);
      if (widget && container && widget.updatePosition) {
        const currentRect = container.getBoundingClientRect();
        if (!widget.previousContainerRect || !rectsAreEqual(widget.previousContainerRect, currentRect)) {
          widget.updatePosition();
          widget.previousContainerRect = currentRect;
        }
      }
    }
  }
  
  // Update primary field tracking for backward compatibility
  const primaryField = findPrimaryInputField();
  if (primaryField) {
    widgetManager.currentInputField = primaryField;
    widgetManager.currentInputContainer = findInputContainer(primaryField);
    cachedInputField = primaryField;
    cachedInputContainer = widgetManager.currentInputContainer;
    widgetManager.widgetCreated = widgetManager.widgets.size > 0;
  }
}

// Track widget creation and current input field/container (kept for compatibility)
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

// Enhanced widget creation and management
const tryCreateWidget = debounce(function () {
  // Use new widget management system
  manageWidgets();
  
  // Maintain backward compatibility with original logic
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
      // Create widget for the first time (this is now handled by manageWidgets)
      currentInputField = newInputField;
      currentInputContainer = newInputContainer;
      cachedInputField = newInputField;
      cachedInputContainer = newInputContainer;
      widgetCreated = true;
      // Get the widget from the new system
      widget = widgetManager.widgets.get(newInputField);
      // console.log("Widget created for primary input field and container:", newInputField, newInputContainer);
    } else if (newInputField !== currentInputField || newInputContainer !== currentInputContainer) {
      // Input field or container changed, this is now handled by manageWidgets
      currentInputField = newInputField;
      currentInputContainer = newInputContainer;
      cachedInputField = newInputField;
      widgetCreated = true;
      widget = widgetManager.widgets.get(newInputField);
    } else {
      // Check for position changes in the same input container (handled by manageWidgets)
      widget = widgetManager.widgets.get(newInputField);
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