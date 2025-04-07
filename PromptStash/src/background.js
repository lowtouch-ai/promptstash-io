// Context menu for saving selected text to PromptStash
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "saveToPromptStash",
    title: "Save to PromptStash",
    contexts: ["selection"]
  });
});

// Handle context menu click to save selected text
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "saveToPromptStash") {
    chrome.tabs.sendMessage(tab.id, { action: "getSelectedText" }, (response) => {
      if (response && response.selectedText) {
        chrome.storage.sync.get(["templates"], (result) => {
          const templates = result.templates || [];
          templates.push({
            name: "New Template",
            tags: "",
            content: response.selectedText,
            type: "custom"
          });
          chrome.storage.sync.set({ templates });
        });
      }
    });
  }
});