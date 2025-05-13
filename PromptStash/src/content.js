// Handle messages from popup/background
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Attempt to find the input field with a more specific selector
  let inputField = document.querySelector(
    "[contenteditable='true'][role='textbox'], " +
    "textarea:not([disabled]), " +
    "input[type='text']:not([disabled]), " +
    "[contenteditable='true'][aria-label*='prompt' i], " +
    "textarea[aria-label*='prompt' i], " +
    "input[aria-label*='prompt' i]"
  );

  // Retry finding the input field after a short delay if not found
  if (!inputField && (message.action === "sendPrompt" || message.action === "getPrompt")) {
    setTimeout(() => {
      inputField = document.querySelector(
        "[contenteditable='true'][role='textbox'], " +
        "textarea:not([disabled]), " +
        "input[type='text']:not([disabled]), " +
        "[contenteditable='true'][aria-label*='prompt' i], " +
        "textarea[aria-label*='prompt' i], " +
        "input[aria-label*='prompt' i]"
      );
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
      if (inputField.tagName === "DIV" && inputField.contentEditable === "true") {
        // Preserve newlines by setting innerHTML with <br> for contenteditable
        inputField.innerHTML = message.prompt.replace(/\n/g, "<br>");
      } else {
        inputField.value = message.prompt;
      }
      // Dispatch input and change events to ensure compatibility
      inputField.dispatchEvent(new Event("input", { bubbles: true }));
      inputField.dispatchEvent(new Event("change", { bubbles: true }));
      inputField.focus();
    } else {
      console.log("No input field found for sendPrompt");
    }
    sendResponse({ success: !!inputField });
  } else if (message.action === "getPrompt") {
    if (inputField) {
      let prompt;
      if (inputField.tagName === "DIV" && inputField.contentEditable === "true") {
        prompt = inputField.innerHTML.replace(/<br\s*\/?>/gi, "\n").replace(/<\/?[^>]+(>|$)/g, "");
      } else {
        prompt = inputField.value || "";
      }
      sendResponse({ prompt });
    } else {
      console.log("No input field found for getPrompt");
      sendResponse({ prompt: "" });
    }
  } else if (message.action === "getSelectedText") {
    const selectedText = window.getSelection().toString();
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