const SUPPORTED_HOSTS = {
  "grok.com": {
    selector: ".query-bar textarea, textarea[aria-label='Ask Grok anything']",
    name: "Grok"
  },
  "perplexity.ai": {
    selector: "textarea#ask-input, textarea[aria-placeholder='Ask anything or @ mention a Space'], div#ask-input", 
    name: "Perplexity.ai"
  },
  "chatgpt.com": {
    selector: "div#prompt-textarea.ProseMirror[contenteditable='true']",
    name: "ChatGPT"
  }
};

// Handle messages from popup/background
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("Received message:", message);

  // Use the primary input field
  let inputField = findPrimaryInputField();

  if (inputField) {
    console.log("Primary input field found:", inputField, "Tag:", inputField.tagName, "Visible:", inputField.offsetParent !== null);
  } else {
    console.log("No primary input field found with initial querySelector.");
  }

  // Retry finding the input field up to 3 times if not found
  if (!inputField && (message.action === "sendPrompt" || message.action === "getPrompt")) {
    console.log("Retrying to find primary input field...");
    let retryCount = 0;
    const maxRetries = 3;
    const retryInterval = 500; // 500ms delay between retries
    const retry = () => {
      retryCount++;
      inputField = findPrimaryInputField();
      if (inputField) {
        console.log(`Primary input field found on retry ${retryCount}:`, inputField, "Tag:", inputField.tagName, "Visible:", inputField.offsetParent !== null);
        processMessage(message, inputField, sendResponse);
      } else if (retryCount < maxRetries) {
        console.log(`Retry ${retryCount} failed, retrying in ${retryInterval}ms...`);
        setTimeout(retry, retryInterval);
      } else {
        console.log("No primary input field found after max retries.");
        processMessage(message, null, sendResponse);
      }
    };
    setTimeout(retry, retryInterval);
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
      console.log("No primary input field found for sendPrompt");
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
      console.log("No primary input field found for getPrompt");
      sendResponse({ prompt: "" });
    }
  } else if (message.action === "getSelectedText") {
    const selectedText = window.getSelection().toString();
    console.log("Retrieved selected text:", selectedText);
    sendResponse({ selectedText });
  }
};

// Find the primary input field based on platform-specific selectors
function findPrimaryInputField() {
  const hostname = window.location.hostname;
  console.log("Checking hostname for platform detection:", hostname);
  const platform = Object.keys(SUPPORTED_HOSTS).find(host => hostname.includes(host));
  if (!platform) {
    console.log("No supported platform detected for hostname:", hostname);
    return null;
  }
  const { selector, name } = SUPPORTED_HOSTS[platform];
  console.log(`Attempting to find primary input field for ${name} with selector: ${selector}`);
  const inputField = document.querySelector(selector);
  if (inputField) {
    console.log(`Found primary input field for ${name}:`, inputField, "Visible:", inputField.offsetParent !== null);
    return inputField.offsetParent !== null ? inputField : null;
  }
  console.log(`No primary input field found for ${name} with selector: ${selector}`);
  return null;
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
        return; //chrome.runtime.sendMessage({ action: "closePopup" });
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
  }, 100);

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
      console.log("Widget recreated for updated primary input field and container:", newInputField, newInputContainer);
    }
    // If primary input field and container are the same, no action needed
  }
}, 150); // Debounce delay for dynamic DOM updates

// Initial widget creation
tryCreateWidget();

// Observe DOM changes for dynamic content
const observer = new MutationObserver(debounce(() => {
  tryCreateWidget();
}, 150)); // Debounce delay for dynamic DOM updates
observer.observe(document.body, { childList: true, subtree: true, attributes: true });