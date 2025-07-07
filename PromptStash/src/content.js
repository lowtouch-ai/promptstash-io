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
      console.log(`Focused field updated:`/* , lastFocusedField */);
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
                console.log(`Focused field updated (dynamic):`/* , lastFocusedField */);
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
    console.log("Primary input field found:"/* , inputField */, "Tag:", inputField.tagName, "Visible:", inputField.offsetParent !== null);
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
        console.log(`Primary input field found on retry ${retryCount}:`/* , inputField */, "Tag:", inputField.tagName, "Visible:", inputField.offsetParent !== null);
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
    if (!message.prompt || !message.prompt.trim()) {
      console.log("Empty or invalid prompt received.");
      sendResponse({ success: false, error: "Prompt is empty or invalid" });
      return;
    }

    if (targetField) {
      console.log("Setting the prompt to target field:\n" + message.prompt/* , targetField */);
      const hostname = window.location.hostname;
      // console.log(`Target field value before clearing:\n${targetField.value}`);
      console.log(`Target field innerHTML before clearing:\n${targetField.innerHTML}`);

      // Clear existing content based on field type
      if (targetField.tagName === "TEXTAREA" || targetField.tagName === "INPUT") {
        targetField.value = "";
        console.log(`Target field value after clearing globally: ${targetField.value}`);
      } else {
        targetField.innerHTML = "";
        console.log(`Target field innerHTML after clearing globally: ${targetField.innerHTML}`);
      }

      // Handle Perplexity.ai
      if (hostname.includes("perplexity.ai")) {
        // Handle Lexical editor for fresh chats (#ask-input div)
        if (targetField.id === "ask-input" && targetField.getAttribute("data-lexical-editor") === "true") {
          // Create new paragraph for the prompt in a single operation
          const p = document.createElement("p");
          p.setAttribute("dir", "ltr");
          const lines = message.prompt.split("\n").filter(line => line.trim());
          lines.forEach((line, index) => {
            if (line) {
              const span = document.createElement("span");
              span.setAttribute("data-lexical-text", "true");
              span.textContent = line;
              p.appendChild(span);
            }
            if (index < lines.length - 1 || !line) {
              p.appendChild(document.createElement("br"));
            }
          });
          
          // Clear and set content in one step to avoid partial updates
          targetField.innerHTML = "";
          console.log(`Target field innerHTML after clearing locally: ${targetField.innerHTML}`);
          targetField.appendChild(p);
          console.log(`Target field innerHTML after appendChild(p):\n${targetField.innerHTML}`);

          // Dispatch events to ensure Lexical editor updates
          const beforeInputEvent = new InputEvent("beforeinput", {
            bubbles: true,
            cancelable: true,
            inputType: "insertParagraph",
            data: message.prompt
          });
          console.log(`Target field innerHTML before targetField.dispatchEvent(beforeInputEvent):\n${targetField.innerHTML}`);
          targetField.dispatchEvent(beforeInputEvent);
          console.log(`Target field innerHTML after targetField.dispatchEvent(beforeInputEvent):\n${targetField.innerHTML}`);

          // Dispatch additional events for Lexical editor compatibility
          targetField.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: message.prompt }));
          console.log(`Target field innerHTML after targetField.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: message.prompt })):\n${targetField.innerHTML}`);
          targetField.dispatchEvent(new Event("change", { bubbles: true }));
          console.log(`Target field innerHTML after targetField.dispatchEvent(new Event("change", { bubbles: true })):\n${targetField.innerHTML}`);
          targetField.dispatchEvent(new Event("selectionchange", { bubbles: true }));
          console.log(`Target field innerHTML after targetField.dispatchEvent(new Event("selectionchange", { bubbles: true })):\n${targetField.innerHTML}`);

          // Update Lexical editor selection to ensure UI reflects the change
          const range = document.createRange();
          console.log(`range after document.createRange():\n` + range);
          const selection = window.getSelection();
          console.log(`selection after window.getSelection():\n` + selection);
          range.selectNodeContents(p);
          console.log(`range after range.selectNodeContents(p):\n` + range);
          range.collapse(false); // Collapse to the end of the content
          console.log(`range after range.collapse(false):\n` + range);
          selection.removeAllRanges();
          console.log(`selection after selection.removeAllRanges():\n` + selection);
          selection.addRange(range);
          console.log(`selection after selection.addRange(range):\n` + selection);
          console.log("FINAL TARGET FIELD INNERHTML:\n" + targetField.innerHTML);
          // console.log("FINAL TARGET FIELD VALUE:\n" + targetField.value);
          // console.log("FINAL TARGET FIELD INNERHTML VALUE:\n" + targetField.innerHTML.value);
        }
        // Handle textarea elements for follow-up queries and edit-mode
        else if (targetField.tagName === "TEXTAREA") {
          targetField.value = message.prompt;
          console.log("Set value for Perplexity.ai textarea:"/* , targetField */);
          targetField.dispatchEvent(new Event("input", { bubbles: true }));
          targetField.dispatchEvent(new Event("change", { bubbles: true }));
        }
      }
      // Handle ChatGPT ProseMirror editor
      else if (targetField.tagName === "DIV" && targetField.contentEditable === "true" && targetField.classList.contains("ProseMirror")) {
        const lines = message.prompt.split("\n");
        targetField.innerHTML = lines.map(line => `<p>${line}<br></p>`).join("");
        console.log("Set innerHTML for ChatGPT ProseMirror div with <p> and <br> tags.");
      }
      // Handle generic contenteditable div
      else if (targetField.tagName === "DIV" && targetField.contentEditable === "true") {
        targetField.innerHTML = message.prompt.replace(/\n/g, "<br>");
        console.log("Set innerHTML for contenteditable div with <br> for newlines.");
      }
      // Handle textarea or input elements
      else {
        targetField.value = message.prompt;
        console.log("Set value for input/textarea.");
      }

      // Dispatch input and change events for non-Perplexity platforms
      if (!hostname.includes("perplexity.ai")) {
        targetField.dispatchEvent(new Event("input", { bubbles: true }));
        targetField.dispatchEvent(new Event("change", { bubbles: true }));
      }
      targetField.focus(); // Restore focus to the target field
      sendResponse({ success: true });
    } else {
      console.log("No target field found for sendPrompt");
      sendResponse({ success: false, error: "No target field found" });
    }
  } else if (message.action === "getPrompt") {
    if (targetField) {
      let prompt;
      // Retrieve prompt from Perplexity.ai Lexical editor
      if (window.location.hostname.includes("perplexity.ai") && targetField.id === "ask-input" && targetField.getAttribute("data-lexical-editor") === "true") {
        const spans = targetField.querySelectorAll("span[data-lexical-text='true']");
        if (spans.length > 0) {
          prompt = Array.from(spans)
            .map(span => span.textContent.trimEnd())
            .filter(text => text)
            .join("\n");
          console.log("Retrieved prompt from Perplexity.ai Lexical editor:", prompt);
        } else {
          prompt = targetField.textContent.replace(/\n+/g, "\n").trimEnd();
          console.log("Retrieved prompt from Perplexity.ai Lexical editor (fallback):", prompt);
        }
      }
      // Retrieve prompt from ChatGPT ProseMirror editor
      else if (targetField.tagName === "DIV" && targetField.contentEditable === "true" && targetField.classList.contains("ProseMirror")) {
        const paragraphs = Array.from(targetField.querySelectorAll("p"));
        if (paragraphs.length > 0) {
          prompt = paragraphs.map(p => p.textContent.trimEnd()).join("\n");
          console.log("Retrieved prompt from ChatGPT ProseMirror div:", prompt);
        } else {
          prompt = targetField.textContent.replace(/\n+/g, "\n").trimEnd();
          console.log("Retrieved prompt from ChatGPT ProseMirror div (fallback):", prompt);
        }
      }
      // Retrieve prompt from generic contenteditable div
      else if (targetField.tagName === "DIV" && targetField.contentEditable === "true") {
        prompt = targetField.innerHTML.replace(/<br\s*\/?>/gi, "\n").replace(/<\/?[^>]+(>|$)/g, "").trimEnd();
        console.log("Retrieved prompt from contenteditable div:", prompt);
      }
      // Retrieve prompt from textarea or input
      else {
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
    console.log(`Found primary input field for ${name}:`/* , inputField */, "Visible:", true);
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
      <button class="extension-button" style="border-radius: 100%;" aria-label="Open PromptStash" title="Open PromptStash">
        <img src="${chrome.runtime.getURL('icon48.png')}" alt="PromptStash Icon" aria-hidden="true" draggable="false" style="width: 30px; height: 30px;">
      </button>
  `;

  // Initialize widget with hidden visibility to prevent flashing
  widget.style.position = 'absolute';
  widget.style.zIndex = '9999';
  widget.style.visibility = 'hidden'; // Hide until positioned
  widget.style.borderRadius = '100%';

  // Initialize widget position with default offset
  let widgetOffset = { x: -100, y: -100 }; // Default offset from bottom-right corner

  // Create an offscreen container to measure widget size
  const offscreenContainer = document.createElement('div');
  offscreenContainer.style.position = 'absolute';
  offscreenContainer.style.top = '-9999px';
  offscreenContainer.style.left = '-9999px';
  offscreenContainer.appendChild(widget);
  document.body.appendChild(offscreenContainer);

  // Calculate initial position using input container and widget size
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

  // Store initial container rectangle to detect position changes later
  widget.previousContainerRect = inputContainer.getBoundingClientRect();

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

  // Observe input container resizing
  const resizeObserver = new ResizeObserver(debounce(() => {
    updateWidgetPosition();
  }, 5)); // Debounced to prevent excessive updates
  resizeObserver.observe(inputContainer);
  widget.resizeObserver = resizeObserver;

  // Update position on window resize (debounced for performance)
  const updatePositionDebounced = debounce(() => updateWidgetPosition(), 5);
  const resizeListener = () => updatePositionDebounced();
  window.addEventListener('resize', resizeListener);
  widget.resizeListener = resizeListener;

  // Make widget draggable and handle popup interaction
  makeDraggable(widget, inputContainer, (newOffset) => {
    widgetOffset = newOffset;
    chrome.storage.local.set({ widgetOffset }, () => {});
  });

  // Handle pointer events for button interaction
  let isDragging = false;
  let startX, startY;
  let holdTimeout;
  let pointerStartTime;

  extensionButton.addEventListener('pointerdown', (e) => {
    e.preventDefault(); // Prevent default behaviors like text selection or scrolling
    if (document.getElementById('promptstash-popup')) return; // Prevent interaction if popup is open
    startX = e.clientX;
    startY = e.clientY;
    pointerStartTime = Date.now();
    isDragging = false;
    holdTimeout = setTimeout(() => {
      isDragging = true;
      extensionButton.style.cursor = 'grabbing'; // Visual feedback for drag mode
    }, 300);
  });

  extensionButton.addEventListener('pointermove', (e) => {
    // Detect movement to confirm drag intent
    if (Math.abs(e.clientX - startX) > 1 || Math.abs(e.clientY - startY) > 1) {
      // isDragging = true;
      // extensionButton.style.cursor = 'grabbing';
    }
  });

  extensionButton.addEventListener('pointerup', (e) => {
    // Handle popup opening on quick tap/click
    clearTimeout(holdTimeout);
    const duration = Date.now() - pointerStartTime;
    if (!isDragging && duration < 300 && !document.getElementById('promptstash-popup')) {
      chrome.runtime.sendMessage({ action: "togglePopup" });
    }
    isDragging = false;
    extensionButton.style.cursor = ''; // Reset cursor
  });

  extensionButton.addEventListener('pointercancel', () => {
    // Handle interrupted interactions
    clearTimeout(holdTimeout);
    isDragging = false;
    extensionButton.style.cursor = ''; // Reset cursor
  });

  extensionButton.addEventListener('pointerleave', () => {
    clearTimeout(holdTimeout);
    isDragging = false;
    extensionButton.style.cursor = ''; // Reset cursor
  });

  // Ensure keyboard accessibility
  extensionButton.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { // Space key support per accessibility standards
      e.preventDefault();
      if (!document.getElementById('promptstash-popup')) {
        chrome.runtime.sendMessage({ action: "togglePopup" });
      }
      isDragging = false;
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

    newLeft = Math.max(boundaryRect.left + window.scrollX, Math.min(newLeft, boundaryRect.right + window.scrollX - widgetRect.width));
    newTop = Math.max(boundaryRect.top + window.scrollY, Math.min(newTop, boundaryRect.bottom + window.scrollY - widgetRect.height));

    element.style.left = `${newLeft}px`;
    element.style.top = `${newTop}px`;

    // Calculate offset from bottom-right corner
    const newOffsetX = newLeft - (containerRect.right + window.scrollX);
    const newOffsetY = newTop - (containerRect.bottom + window.scrollY);
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

  // Stop dragging when pointer enters the popup
  const popup = document.getElementById('promptstash-popup');
  if (popup) {
    popup.addEventListener('pointerenter', () => {
      isDragging = false;
      element.style.cursor = ''; // Reset cursor
    });
  }

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
      cachedInputContainer = newInputContainer;
      // console.log("Widget recreated for updated primary input field and container:", newInputField, newInputContainer);
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