// Handle messages from popup/background
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("Received message:", message);

  // Attempt to find the input field, prioritizing visible elements
  let potentialFields = document.querySelectorAll(
    "div#prompt-textarea.ProseMirror[contenteditable='true'], " + // Specific to ChatGPT
    "[contenteditable='true'][role='textbox'], " +
    "textarea:not([disabled]), " +
    "input[type='text']:not([disabled]), " +
    "[contenteditable='true'][aria-label*='prompt' i], " +
    "textarea[aria-label*='prompt' i], " +
    "input[aria-label*='prompt' i]"
  );

  // Select the first visible element
  let inputField = Array.from(potentialFields).find(field => field.offsetParent !== null);

  if (inputField) {
    console.log("Input field found:", inputField, "Tag:", inputField.tagName, "Visible:", inputField.offsetParent !== null);
  } else {
    console.log("No visible input field found with initial querySelector.");
  }

  // Retry finding the input field after a short delay if not found
  if (!inputField && (message.action === "sendPrompt" || message.action === "getPrompt")) {
    console.log("Retrying to find input field after 500ms...");
    setTimeout(() => {
      potentialFields = document.querySelectorAll(
        "div#prompt-textarea.ProseMirror[contenteditable='true'], " +
        "[contenteditable='true'][role='textbox'], " +
        "textarea:not([disabled]), " +
        "input[type='text']:not([disabled]), " +
        "[contenteditable='true'][aria-label*='prompt' i], " +
        "textarea[aria-label*='prompt' i], " +
        "input[aria-label*='prompt' i]"
      );
      inputField = Array.from(potentialFields).find(field => field.offsetParent !== null);
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
  widget = document.createElement('div');
  widget.id = 'promptstash-widget';
  widget.innerHTML = `
      <button class="extension-button" aria-label="Open PromptStash" title="Open PromptStash">
        <img src="${chrome.runtime.getURL('icon48.png')}" alt="PromptStash Icon" aria-hidden="true" draggable="false" style="width: 30px; height: 30px;">
      </button>
  `;
  document.body.appendChild(widget);

  // Position widget dynamically relative to the input container
  function updateWidgetPosition() {
    const containerRect = inputContainer.getBoundingClientRect();
    widget.style.position = 'absolute';
    widget.style.top = `${containerRect.top + window.scrollY + 10}px`;
    widget.style.left = `${containerRect.right + window.scrollX - 50}px`;
    widget.style.zIndex = '10000';
    widget.style.opacity = '0.5'; // Set initial idle opacity to 0.5
  }
  updateWidgetPosition();

  // Add hover event listeners for opacity toggle
  widget.addEventListener('mouseenter', () => {
    widget.style.opacity = '1'; // Set full opacity on hover
  });
  widget.addEventListener('mouseleave', () => {
    widget.style.opacity = '0.5'; // Revert to idle opacity when not hovered
  });

  // Observe input container resizing
  const resizeObserver = new ResizeObserver(() => {
    updateWidgetPosition();
  });
  resizeObserver.observe(inputContainer);
  widget.resizeObserver = resizeObserver;

  // Update position on window resize and scroll
  const resizeListener = () => updateWidgetPosition();
  const scrollListener = () => updateWidgetPosition();
  window.addEventListener('resize', resizeListener);
  window.addEventListener('scroll', scrollListener);
  widget.resizeListener = resizeListener;
  widget.scrollListener = scrollListener;

  makeDraggable(widget, inputContainer);

  // Event listener for extension button with click prevention
  const extensionButton = widget.querySelector('.extension-button');
  let isDragging = false;
  let startX, startY;
  let holdTimeout;

  extensionButton.addEventListener('mousedown', (e) => {
    startX = e.clientX;
    startY = e.clientY;
    isDragging = false;
    // Set isDragging to true after holding for 200ms
    holdTimeout = setTimeout(() => {
      isDragging = true;
    }, 200);
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
      if (popup) {
        chrome.runtime.sendMessage({ action: "closePopup" });
      } else {
        chrome.runtime.sendMessage({ action: "togglePopup" });
      }
    }
    isDragging = false;
  });

  // Clear hold timeout if mouse leaves button
  extensionButton.addEventListener('mouseleave', () => {
    clearTimeout(holdTimeout);
  });
}

// Make the widget draggable within input container bounds
function makeDraggable(element, inputContainer) {
  let isDragging = false;
  let offsetX, offsetY;

  element.addEventListener('mousedown', (e) => {
    isDragging = true;
    offsetX = e.clientX - element.getBoundingClientRect().left;
    offsetY = e.clientY - element.getBoundingClientRect().top;
    element.style.cursor = 'grabbing';
  });

  document.addEventListener('mousemove', (e) => {
    if (isDragging) {
      const containerRect = inputContainer.getBoundingClientRect();
      const widgetRect = element.getBoundingClientRect();
      
      // Calculate new position
      let newLeft = e.clientX - offsetX;
      let newTop = e.clientY - offsetY;

      // Restrict within input container bounds
      newLeft = Math.max(containerRect.left + window.scrollX, Math.min(newLeft, containerRect.right + window.scrollX - widgetRect.width));
      newTop = Math.max(containerRect.top + window.scrollY, Math.min(newTop, containerRect.bottom + window.scrollY - widgetRect.height));

      element.style.left = `${newLeft}px`;
      element.style.top = `${newTop}px`;
    }
  });

  document.addEventListener('mouseup', () => {
    isDragging = false;
    element.style.cursor = 'grab';
  });
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
const tryCreateWidget = debounce(function () {
  const newInputField = findInputField();
  const newInputContainer = findInputContainer(newInputField);
  
  // If no input field or container is found and widget exists, retry after a delay
  if (!newInputField || !newInputContainer && widgetCreated && widget) {
    console.log("Input field/container temporarily unavailable, retrying in 500ms...");
    setTimeout(tryCreateWidget, 500);
    return;
  }

  // If a new valid input field and container are found
  if (newInputField && newInputContainer) {
    if (!widgetCreated) {
      // Create widget for the first time
      createWidget(newInputField, newInputContainer);
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
        if (widget.scrollListener) {
          window.removeEventListener('scroll', widget.scrollListener);
        }
        widget.remove();
      }
      // Create new widget for the updated input field and container
      createWidget(newInputField, newInputContainer);
      currentInputField = newInputField;
      currentInputContainer = newInputContainer;
      console.log("Widget recreated for updated input field and container:", newInputField, newInputContainer);
    }
    // If input field and container are the same, no action needed
  } else if (widgetCreated && widget) {
    // No input field/container found, retain widget and retry
    console.log("No input field/container found, retaining widget and retrying...");
    setTimeout(tryCreateWidget, 500);
  }
}, 100);

// Initial widget creation
tryCreateWidget();

// Observe DOM changes for dynamic content
const observer = new MutationObserver(() => {
  tryCreateWidget();
});
observer.observe(document.body, { childList: true, subtree: true });