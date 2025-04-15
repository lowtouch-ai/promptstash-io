// Listen for extension icon click to toggle sidebar
chrome.action.onClicked.addListener((tab) => {
  // Prevent injection into restricted chrome:// URLs
  if (tab.url.startsWith("chrome://")) {
    console.error("Cannot inject into chrome:// URLs");
    return;
  }
  // Inject the toggleSidebar function into the active tab
  chrome.scripting.executeScript({
    target: { tabId: tab.id },
    function: toggleSidebar
  });
});

// Function injected into the page to toggle the sidebar
function toggleSidebar() {
  const sidebarId = "promptstash-sidebar";
  let sidebar = document.getElementById(sidebarId);

  if (sidebar) {
    // Remove sidebar if it exists (toggle off)
    sidebar.remove();
  } else {
    // Create and inject the sidebar
    sidebar = document.createElement("div");
    sidebar.id = sidebarId;
    // Use iframe to load popup.html as sidebar content
    sidebar.innerHTML = `
      <iframe src="${chrome.runtime.getURL("popup.html")}" style="width: 100%; height: 100%; border: none;"></iframe>
    `;
    document.body.appendChild(sidebar);

    // Set initial sidebar styles
    sidebar.style.width = "50%"; // Default to half window width
    sidebar.style.height = "100%";
    sidebar.style.position = "fixed";
    sidebar.style.top = "0";
    sidebar.style.right = "0";
    sidebar.style.zIndex = "10000";
    sidebar.style.backgroundColor = "#171717";
    sidebar.style.borderLeft = "1px solid #888888";
    sidebar.style.resize = "horizontal"; // Allow width adjustment
    sidebar.style.overflow = "auto";
  }
}

// Create context menu for saving selected text
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "saveToPromptStash",
    title: "Save to PromptStash",
    contexts: ["selection"]
  });
});

// Handle context menu click to save selected text as a new template
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "saveToPromptStash") {
    chrome.tabs.sendMessage(tab.id, { action: "getSelectedText" }, (response) => {
      if (response && response.selectedText) {
        chrome.storage.sync.get(["templates"], (result) => {
          const templates = result.templates || [];
          templates.push({
            name: `New Template ${templates.length + 1}`, // Unique name
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