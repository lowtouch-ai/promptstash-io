// Handle messages from popup/background
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("Received message:", message);

  // Use the last focused input field or find a visible one
  let inputField = currentInputField || findInputField();

  if (inputField) {
    console.log("Input field found:", inputField, "Tag:", inputField.tagName, "Visible:", inputField.offsetParent !== null);
  } else {
    console.log("No visible input field found with initial querySelector.");
  }

  // Retry finding the input field after a short delay if not found
  if (!inputField && (message.action === "sendPrompt" || message.action === "getPrompt")) {
    console.log("Retrying to find input field after 500ms...");
    setTimeout(() => {
      inputField = currentInputField || findInputField();
      if (inputField) {
        console.log("Input field found on retry:", inputField, "Tag:", inputField.tagName, "Visible:", inputField.offsetParent !== null);
      } else {
        console.log("No visible input field found after retry.");
      }
      processMessage(message, inputField, sendResponse);
    }, 500); // Wait 500ms for page elements to load
    return true; // Keep the message channel open for async response
  }

  processMessage(message, inputField, sendResponse);
});

// Process the message with the found input field
function processMessage(message, inputField, sendResponse) {
  if (message.action === "sendPrompt") {
    if (inputField) {
      console.log("Setting prompt:", message.prompt);
      if (inputField.tagName === "DIV" && inputField.contentEditable === "true" && inputField.classList.contains("ProseMirror")) {
        // Handle ChatGPT's ProseMirror: clear existing content, then set prompt with <p> and <br> tags, preserving empty lines
        inputField.innerHTML = ""; // Clear existing content to prevent submission
        const lines = message.prompt.split("\n"); // Split by newlines, keep empty lines
        inputField.innerHTML = lines.map(line => `<p>${line}<br></p>`).join("");
        console.log("Cleared and set innerHTML for ChatGPT ProseMirror div with <p> and <br> tags, preserving empty lines.");
      } else if (inputField.tagName === "DIV" && inputField.contentEditable === "true") {
        // Other contenteditable divs: clear content and use <br> for newlines
        inputField.innerHTML = "";
        inputField.innerHTML = message.prompt.replace(/\n/g, "<br>");
        console.log("Cleared and set innerHTML for contenteditable div with <br> for newlines.");
      } else {
        // Clear input/textarea before setting value
        inputField.value = "";
        inputField.value = message.prompt;
        console.log("Cleared and set value for input/textarea.");
      }
      // Dispatch input and change events to ensure compatibility
      inputField.dispatchEvent(new Event("input", { bubbles: true }));
      inputField.dispatchEvent(new Event("change", { bubbles: true }));
      inputField.focus();
      console.log("Dispatched input and change events.");
      sendResponse({ success: true });
    } else {
      console.log("No input field found for sendPrompt");
      sendResponse({ success: false });
    }
  } else if (message.action === "getPrompt") {
    if (inputField) {
      let prompt;
      if (inputField.tagName === "DIV" && inputField.contentEditable === "true" && inputField.classList.contains("ProseMirror")) {
        // Handle ChatGPT's ProseMirror: extract text from <p> tags, preserving empty lines
        const paragraphs = Array.from(inputField.querySelectorAll("p"));
        if (paragraphs.length > 0) {
          prompt = paragraphs.map(p => p.textContent.trimEnd()).join("\n"); // Preserve empty lines, trim trailing spaces
          console.log("Retrieved prompt from ChatGPT ProseMirror div with empty lines preserved:", prompt);
        } else {
          // Fallback for other contenteditable structures
          prompt = inputField.textContent.replace(/\n+/g, "\n").trimEnd();
          console.log("Retrieved prompt from ChatGPT ProseMirror div (fallback):", prompt);
        }
      } else if (inputField.tagName === "DIV" && inputField.contentEditable === "true") {
        // Handle other contenteditable divs, preserving newlines from <br>
        prompt = inputField.innerHTML.replace(/<br\s*\/?>/gi, "\n").replace(/<\/?[^>]+(>|$)/g, "").trimEnd();
        console.log("Retrieved prompt from contenteditable div:", prompt);
      } else {
        prompt = inputField.value || "";
        console.log("Retrieved prompt from input/textarea:", prompt);
      }
      sendResponse({ prompt });
    } else {
      console.log("No input field found for getPrompt");
      sendResponse({ prompt: "" });
    }
  } else if (message.action === "getSelectedText") {
    const selectedText = window.getSelection().toString();
    console.log("Retrieved selected text:", selectedText);
    sendResponse({ selectedText });
  }
};

// Detect clicks outside popup to close it
document.addEventListener("click", (event) => {
  const popup = document.getElementById("promptstash-popup");
  if (popup && !popup.contains(event.target)) {
    chrome.runtime.sendMessage({ action: "closePopup" });
  }
});

// --- Widget Functionality ---

// Find the primary input field using existing selectors
function findInputField() {
  const potentialFields = document.querySelectorAll(
    "div#prompt-textarea.ProseMirror[contenteditable='true'], " +
    "[contenteditable='true'][role='textbox'], " +
    "textarea:not([disabled]), " +
    "input[type='text']:not([disabled]), " +
    "[contenteditable='true'][aria-label*='prompt' i], " +
    "textarea[aria-label*='prompt' i], " +
    "input[aria-label*='prompt' i]"
  );
  return Array.from(potentialFields).find(field => field.offsetParent !== null);
}

// Find the input container (parent element containing input field and buttons)
function findInputContainer(inputField) {
  if (!inputField) return null;
  // Traverse up the DOM to find a parent with buttons or a form-like structure
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
  widget.innerHTML = `
      <button class="extension-button" aria-label="Open PromptStash" title="Open PromptStash">
        <img src="${chrome.runtime.getURL('icon48.png')}" alt="PromptStash Icon" aria-hidden="true" draggable="false" style="width: 30px; height: 30px;">
      </button>
  `;
  document.body.appendChild(widget);

  // Initialize widget position storage
  let widgetOffset = { x: -100, y: -90 }; // Default offset from bottom-right corner
  chrome.storage.local.get(['widgetOffset'], (result) => {
    if (result.widgetOffset) {
      widgetOffset = result.widgetOffset;
    }
    updateWidgetPosition(); // Apply stored or default position
  });

  // Enforce widget position within container parent boundaries
  function enforceBoundaries(containerRect, parentRect, widgetRect) {
    let newLeft = containerRect.right + window.scrollX + widgetOffset.x;
    let newTop = containerRect.bottom + window.scrollY + widgetOffset.y;

    // Ensure widget stays within parent's bounding rectangle
    newLeft = Math.max(parentRect.left + window.scrollX, Math.min(newLeft, parentRect.right + window.scrollX - widgetRect.width));
    newTop = Math.max(parentRect.top + window.scrollY, Math.min(newTop, parentRect.bottom + window.scrollY - widgetRect.height));

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

    widget.style.position = 'absolute';
    widget.style.top = `${newTop}px`;
    widget.style.left = `${newLeft}px`;
    widget.style.zIndex = '9999';
    widget.style.transition = 'top 0.3s ease, left 0.3s ease'; // Smooth transition for position changes
  }
  updateWidgetPosition();

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

  // Update position on window resize and scroll (debounced for performance)
  const updatePositionDebounced = debounce(() => updateWidgetPosition(), 50);
  const resizeListener = () => updatePositionDebounced();
  const scrollListener = () => updatePositionDebounced();
  window.addEventListener('resize', resizeListener);
  window.addEventListener('scroll', scrollListener);
  // Add chat window scroll listener to track container movement
  const chatContainer = findChatContainer(inputContainer);
  if (chatContainer) {
    chatContainer.addEventListener('scroll', scrollListener);
  }
  widget.resizeListener = resizeListener;
  widget.scrollListener = scrollListener;
  widget.chatContainer = chatContainer;

  // Make widget draggable and save new position
  makeDraggable(widget, inputContainer, (newOffset) => {
    widgetOffset = newOffset;
    chrome.storage.local.set({ widgetOffset }, () => {
      console.log("Widget offset saved:", widgetOffset);
    });
  });

  // Event listener for extension button with click prevention
  const extensionButton = widget.querySelector('.extension-button');
  let isDragging = false;
  let startX, startY;
  let holdTimeout;

  extensionButton.addEventListener('mousedown', (e) => {
    startX = e.clientX;
    startY = e.clientY;
    isDragging = false;
    // Set isDragging to true after holding for 300ms
    holdTimeout = setTimeout(() => {
      isDragging = true;
    }, 300);
  });

  extensionButton.addEventListener('mousemove', (e) => {
    if (Math.abs(e.clientX - startX) > 1 || Math.abs(e.clientY - startY) > 1) {
      isDragging = true;
    }
  });

  extensionButton.addEventListener('mouseup', (e) => {
    clearTimeout(holdTimeout); // Clear hold timeout
    if (!isDragging) {
      // Check if popup is open
      const popup = document.getElementById("promptstash-popup");
      chrome.runtime.sendMessage({ action: "togglePopup" });
    }
    isDragging = false;
  });

  // Clear hold timeout if mouse leaves button
  extensionButton.addEventListener('mouseleave', () => {
    clearTimeout(holdTimeout);
  });

  return widget;
}

// Make the widget draggable within input container bounds
function makeDraggable(element, inputContainer, onPositionChange) {
  let isDragging = false;
  let offsetX, offsetY;

  element.addEventListener('mousedown', (e) => {
    isDragging = true;
    offsetX = e.clientX - element.getBoundingClientRect().left;
    offsetY = e.clientY - element.getBoundingClientRect().top;
    // element.style.cursor = 'grabbing';
    element.style.transition = 'none'; // Disable transition during drag for instant response
  });

  document.addEventListener('mousemove', (e) => {
    if (isDragging) {
      const containerRect = inputContainer.getBoundingClientRect();
      const widgetRect = element.getBoundingClientRect();
      const parentRect = inputContainer.parentElement.getBoundingClientRect();
      
      // Calculate new position
      let newLeft = e.clientX - offsetX;
      let newTop = e.clientY - offsetY;

      // Restrict within parent container bounds
      newLeft = Math.max(parentRect.left + window.scrollX, Math.min(newLeft, parentRect.right + window.scrollX - widgetRect.width));
      newTop = Math.max(parentRect.top + window.scrollY, Math.min(newTop, parentRect.bottom + window.scrollY - widgetRect.height));

      element.style.left = `${newLeft}px`;
      element.style.top = `${newTop}px`;

      // Calculate offset from bottom-right corner
      const newOffsetX = newLeft - (containerRect.right + window.scrollX);
      const newOffsetY = newTop - (containerRect.bottom + window.scrollY);
      onPositionChange({ x: newOffsetX, y: newOffsetY });
    }
  });

  document.addEventListener('mouseup', () => {
    isDragging = false;
    // element.style.cursor = 'grab';
    element.style.transition = 'top 0.3s ease, left 0.3s ease'; // Restore transition after drag
  });
}

// Find the chat container (scrollable parent of the input/edit container)
function findChatContainer(container) {
  let parent = container.parentElement;
  while (parent && parent !== document.body) {
    if (parent.scrollHeight > parent.clientHeight || parent.classList.contains('chat-container')) {
      return parent;
    }
    parent = parent.parentElement;
  }
  return null; // Fallback to null if no scrollable container is found
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

// Attempt to create or update widget when input field/container changes
const tryCreateWidget = debounce(function (focusedField = null) {
  // Use focused field if provided, otherwise use currentInputField or find a visible input field
  let newInputField = focusedField || currentInputField || findInputField();
  let newInputContainer = findInputContainer(newInputField);
  
  // If no input field or container is found and widget exists, retry after a delay
  if (!newInputField || !newInputContainer) {
    if (widgetCreated && widget) {
      console.log("Input field/container temporarily unavailable, retrying in 500ms...");
      setTimeout(tryCreateWidget, 500);
    } else {
      console.log("No valid input field/container found, skipping widget creation.");
    }
    return;
  }

  // If a new valid input field and container are found
  if (newInputField && newInputContainer) {
    if (!widgetCreated) {
      // Create widget for the first time
      widget = createWidget(newInputField, newInputContainer);
      currentInputField = newInputField;
      currentInputContainer = newInputContainer;
      widgetCreated = true;
      console.log("Widget created for new input field and container:", newInputField, newInputContainer);
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
        if (widget.scrollListener && widget.chatContainer) {
          widget.chatContainer.removeEventListener('scroll', widget.scrollListener);
        }
        if (widget.scrollListener) {
          window.removeEventListener('scroll', widget.scrollListener);
        }
        widget.remove();
      }
      // Create new widget for the updated input field and container
      widget = createWidget(newInputField, newInputContainer);
      currentInputField = newInputField;
      currentInputContainer = newInputContainer;
      console.log("Widget recreated for updated input field and container:", newInputField, newInputContainer);
    }
    // If input field and container are the same, no action needed
  }
}, 100);

// Handle focus and input events to track the last interacted input field
function handleInputInteraction(event) {
  const interactedField = event.target;
  // Verify if the interacted element is a valid input/edit field
  const isValidField = interactedField.matches(
    "div#prompt-textarea.ProseMirror[contenteditable='true'], " +
    "[contenteditable='true'][role='textbox'], " +
    "textarea:not([disabled]), " +
    "input[type='text']:not([disabled]), " +
    "[contenteditable='true'][aria-label*='prompt' i], " +
    "textarea[aria-label*='prompt' i], " +
    "input[aria-label*='prompt' i]"
  ) && interactedField.offsetParent !== null;

  if (isValidField) {
    console.log("Interaction detected on valid input/edit field:", interactedField);
    currentInputField = interactedField; // Update the current input field
    tryCreateWidget(interactedField); // Move widget to the interacted field
  }
}

// Add focus and input event listeners with debouncing for efficiency
const debouncedHandleInputInteraction = debounce(handleInputInteraction, 50);
document.addEventListener('focusin', debouncedHandleInputInteraction, true); // Use focusin for broader compatibility
document.addEventListener('input', debouncedHandleInputInteraction, true); // Track typing interactions
document.addEventListener('click', debouncedHandleInputInteraction, true); // Track click interactions (e.g., edit mode)

// Initial widget creation
tryCreateWidget();

// Observe DOM changes for dynamic content
const observer = new MutationObserver(debounce(() => {
  // Only trigger widget update if no focused field to avoid overriding interaction-based positioning
  if (!document.activeElement || !document.activeElement.matches(
    "div#prompt-textarea.ProseMirror[contenteditable='true'], " +
    "[contenteditable='true'][role='textbox'], " +
    "textarea:not([disabled]), " +
    "input[type='text']:not([disabled]), " +
    "[contenteditable='true'][aria-label*='prompt' i], " +
    "textarea[aria-label*='prompt' i], " +
    "input[aria-label*='prompt' i]"
  )) {
    tryCreateWidget();
  }
}, 100));
observer.observe(document.body, { childList: true, subtree: true });