// Listen for extension icon click to toggle sidebar
chrome.action.onClicked.addListener((tab) => {
  if (tab.url.startsWith("chrome://")) {
    console.error("Cannot inject into chrome:// URLs");
    return;
  }
  chrome.scripting.executeScript({
    target: { tabId: tab.id },
    function: toggleSidebar
  });
});

// Function to toggle sidebar visibility
function toggleSidebar() {
  const sidebarId = "promptstash-sidebar";
  let sidebar = document.getElementById(sidebarId);

  if (sidebar) {
    sidebar.remove();
  } else {
    sidebar = document.createElement("div");
    sidebar.id = sidebarId;
    sidebar.innerHTML = `
      <iframe src="${chrome.runtime.getURL("popup.html")}" style="width: 100%; height: 100%; border: none;"></iframe>
    `;
    document.body.appendChild(sidebar);

    // Check if fullscreen mode is active
    chrome.storage.local.get(["isFullscreen"], (result) => {
      const isFullscreen = result.isFullscreen || false;
      const isSmallScreen = window.innerWidth <= 768;
      const defaultWidth = isFullscreen ? "100vw" : isSmallScreen ? "100vw" : "48vw";
      const defaultHeight = isFullscreen ? "100vh" : isSmallScreen ? "100vh" : "96vh";
      const defaultLeft = isFullscreen ? "0" : isSmallScreen ? "0" : `${window.innerWidth - (window.innerWidth * 0.48) - 20}px`;
      const defaultTop = isFullscreen ? "0" : isSmallScreen ? "0" : "20px";

      Object.assign(sidebar.style, {
        width: defaultWidth,
        height: defaultHeight,
        position: "fixed",
        top: defaultTop,
        left: defaultLeft,
        zIndex: "10000",
        backgroundColor: "#f5f5f5",
        border: "1px solid #88888844",
        borderRadius: isFullscreen ? "0" : "8px",
        boxShadow: isFullscreen ? "none" : "0 4px 12px rgba(0, 0, 0, 0.15)",
        overflow: "hidden",
        transition: "width 0.3s ease, height 0.3s ease, top 0.3s ease, left 0.3s ease" // Smooth transitions
      });


    });

    // Universal close functionality
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && sidebar) {
        sidebar.remove();
      }
    });

    document.addEventListener("click", (e) => {
      if (sidebar && !sidebar.contains(e.target)) {
        sidebar.remove();
      }
    });
  }
}

// Context menu for saving selected text
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "saveToPromptStash",
    title: "Save to PromptStash",
    contexts: ["selection"]
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "saveToPromptStash") {
    chrome.tabs.sendMessage(tab.id, { action: "getSelectedText" }, (response) => {
      if (response && response.selectedText) {
        chrome.storage.local.get(["nextIndex"], (result) => {
          let nextIndex = result.nextIndex || 0;
          chrome.storage.sync.get(["templates"], (result) => {
            const templates = result.templates || [];
            let defaultName = "New Template 1";
            let i = 1;
            while (templates.some(t => t.name === defaultName)) {
              defaultName = `New Template ${++i}`;
            }
            const details = prompt(`Enter template details:\nName (required, default: ${defaultName}):\nTags (optional, comma-separated):`, `${defaultName}\n`);
            if (!details) return;
            const [name, tags] = details.split("\n").map(s => s.trim());
            if (!name) return;
            templates.push({
              name,
              tags: tags ? tags.replace(/[^a-zA-Z0-9, ]/g, "").replace(/\s*,\s*/g, ", ").replace(/^,+\s*|,+\s*$/g, "") : "",
              content: response.selectedText,
              type: "custom",
              favorite: false,
              index: nextIndex++
            });
            chrome.storage.sync.set({ templates });
            chrome.storage.local.set({ nextIndex });
          });
        });
      }
    });
  }
});

// Handle messages for closing sidebar and fullscreen
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "closeSidebar") {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      chrome.scripting.executeScript({
        target: { tabId: tabs[0].id },
        function: () => {
          const sidebar = document.getElementById("promptstash-sidebar");
          if (sidebar) sidebar.remove();
        }
      });
      // Reset fullscreen state
      chrome.storage.local.set({ isFullscreen: false });
    });
  } else if (message.action === "toggleFullscreen") {
    chrome.storage.local.get(["isFullscreen"], (result) => {
      const isFullscreen = !result.isFullscreen;
      chrome.storage.local.set({ isFullscreen }, () => {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          chrome.scripting.executeScript({
            target: { tabId: tabs[0].id },
            function: (isFullscreen) => {
              const sidebar = document.getElementById("promptstash-sidebar");
              if (sidebar) {
                const isSmallScreen = window.innerWidth <= 768;
                Object.assign(sidebar.style, {
                  width: isFullscreen ? "100vw" : isSmallScreen ? "100vw" : "48vw",
                  height: isFullscreen ? "100vh" : isSmallScreen ? "100vh" : "96vh",
                  left: isFullscreen ? "0" : isSmallScreen ? "0" : `${window.innerWidth - (window.innerWidth * 0.48) - 20}px`,
                  top: isFullscreen ? "0" : isSmallScreen ? "0" : "20px",
                  borderRadius: isFullscreen ? "0" : "8px",
                  boxShadow: isFullscreen ? "none" : "0 4px 12px rgba(0, 0, 0, 0.15)",
                  transition: "width 0.3s ease, height 0.3s ease, top 0.3s ease, left 0.3s ease",
                  transform: "none"
                });
              }
            },
            args: [isFullscreen]
          });
        });
      });
    });
  }
});