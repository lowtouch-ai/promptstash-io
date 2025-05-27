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
      if (inputField.tagName === "DIV" && inputField.contentEditable === "true") {
        // Preserve newlines by setting innerHTML with <br> for contenteditable
        inputField.innerHTML = message.prompt.replace(/\n/g, "<br>");
        console.log("Set innerHTML for contenteditable div with <br> for newlines.");
      } else {
        inputField.value = message.prompt;
        console.log("Set value for input/textarea.");
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
      if (inputField.tagName === "DIV" && inputField.contentEditable === "true") {
        // Handle ChatGPT's ProseMirror div, preserving newlines from <br> and stripping other tags
        prompt = inputField.innerHTML.replace(/<br\s*\/?>/gi, "\n").replace(/<\/?[^>]+(>|$)/g, "");
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