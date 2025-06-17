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

// --- New Widget Functionality ---

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

// Create the fixed widget with only the extension button
function createWidget(inputField) {
  const widget = document.createElement('div');
  widget.id = 'promptstash-widget';
  widget.innerHTML = `
    <div class="widget-container">
      <button class="extension-button" aria-label="PromptStash" title="PromptStash">
        <img src="${chrome.runtime.getURL('icon48.png')}" alt="PromptStash" style="width:30px; height:30px; margin:10px;" aria-hidden="true" draggable="false">
      </button>
    </div>
  `;
  document.body.appendChild(widget);

  // Position widget inside the right end of the input field
  const inputRect = inputField.getBoundingClientRect();
  widget.style.position = 'absolute';
  widget.style.top = `${inputRect.top + window.scrollY}px`;
  widget.style.left = `${inputRect.right + window.scrollX - 40}px`; // 40px is widget width
  widget.style.zIndex = '10000';
  widget.style.height = `${inputRect.height}px`; // Match input field height

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
    }, 400);
  });

  extensionButton.addEventListener('mousemove', (e) => {
    if (Math.abs(e.clientX - startX) > 1 || Math.abs(e.clientY - startY) > 1) {
      isDragging = true;
    }
  });

  extensionButton.addEventListener('click', (e) => {
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

// Track widget creation to avoid duplicates
let widgetCreated = false;

// Attempt to create widget when input field is found
function tryCreateWidget() {
  const inputField = findInputField();
  if (inputField && !widgetCreated) {
    createWidget(inputField);
    widgetCreated = true;
  }
}

// Initial widget creation
tryCreateWidget();

// Observe DOM changes for dynamic content
const observer = new MutationObserver(() => {
  tryCreateWidget();
});
observer.observe(document.body, { childList: true, subtree: true });