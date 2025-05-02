// Handle messages from popup/background
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  let inputField;

  // Select input field based on website
  if (window.location.hostname.includes("chatgpt.com")) {
    inputField = document.querySelector("div[contenteditable='true']");
  } else {
    inputField = document.querySelector("textarea, input[type='text']");
  }

  if (message.action === "sendPrompt") {
    if (inputField) {
      if (inputField.tagName === "DIV" && inputField.contentEditable === "true") {
        // Preserve newlines by setting innerHTML with <br> for contenteditable
        inputField.innerHTML = message.prompt.replace(/\n/g, "<br>");
      } else {
        inputField.value = message.prompt;
      }
      inputField.dispatchEvent(new Event("input", { bubbles: true }));
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
      sendResponse({ prompt: "" });
    }
  } else if (message.action === "getSelectedText") {
    const selectedText = window.getSelection().toString();
    sendResponse({ selectedText });
  }
});

// Listen for sidebar close messages from iframe
window.addEventListener("message", (event) => {
  if (event.data.action === "closeSidebar") {
    const sidebar = document.getElementById("promptstash-sidebar");
    if (sidebar) {
      sidebar.remove();
    }
  } else if (event.data.action === "loadFullscreen") {
    const sidebar = document.getElementById("promptstash-sidebar");
    if (sidebar) {
      sidebar.querySelector("iframe").src = chrome.runtime.getURL("fullscreen.html");
    }
  } else if (event.data.action === "loadPopup") {
    const sidebar = document.getElementById("promptstash-sidebar");
    if (sidebar) {
      sidebar.querySelector("iframe").src = chrome.runtime.getURL("popup.html");
    }
  }
});

// Handle ESC key to close sidebar
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    chrome.runtime.sendMessage({ action: "closeSidebar" });
  }
});

// Detect clicks outside sidebar to minimize it
document.addEventListener("click", (event) => {
  const sidebar = document.getElementById("promptstash-sidebar");
  if (sidebar && !sidebar.contains(event.target)) {
    chrome.runtime.sendMessage({ action: "closeSidebar" });
  }
});