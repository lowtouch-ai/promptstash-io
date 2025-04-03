// chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
//   if (message.action === "sendPrompt") {
//     const inputField = document.querySelector("textarea, input[type='text'], div[contenteditable='true']");
//     if (inputField) {
//       if (inputField.tagName === "DIV" && inputField.contentEditable === "true") {
//         inputField.textContent = message.prompt;
//       } else {
//         inputField.value = message.prompt;
//       }
//       inputField.dispatchEvent(new Event("input", { bubbles: true }));
//     }
//   } else if (message.action === "getSelectedText") {
//     const selectedText = window.getSelection().toString();
//     sendResponse({ selectedText });
//   }
// });


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
        inputField.textContent = message.prompt;
      } else {
        inputField.value = message.prompt;
      }
      inputField.dispatchEvent(new Event("input", { bubbles: true }));
    } else {
      console.log("No input field found for sendPrompt");
    }
  } else if (message.action === "getPrompt") {
    if (inputField) {
      const prompt = inputField.tagName === "DIV" ? inputField.textContent : inputField.value;
      sendResponse({ prompt });
    } else {
      sendResponse({ prompt: "" });
    }
  } else if (message.action === "getSelectedText") {
    const selectedText = window.getSelection().toString();
    sendResponse({ selectedText });
  }
});