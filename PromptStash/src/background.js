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

    const isSmallScreen = window.innerWidth <= 768;
    const defaultWidth = isSmallScreen ? "100vw" : "48vw";
    const defaultHeight = isSmallScreen ? "100vh" : "96vh";
    const defaultLeft = isSmallScreen ? "0" : `${window.innerWidth - (window.innerWidth * 0.48) - 20}px`;
    const defaultTop = isSmallScreen ? "0" : "20px";

    Object.assign(sidebar.style, {
      width: defaultWidth,
      height: defaultHeight,
      position: "fixed",
      top: defaultTop,
      left: defaultLeft,
      zIndex: "10000",
      backgroundColor: "#f5f5f5",
      border: "1px solid #88888844",
      borderRadius: "8px",
      boxShadow: "0 4px 12px rgba(0, 0, 0, 0.15)",
      overflow: "hidden" // Prevent sidebar scrollbars
    });

    // Add drag handle for moving
    const dragHandle = document.createElement("div");
    dragHandle.style.position = "absolute";
    dragHandle.style.top = "0";
    dragHandle.style.left = "0";
    dragHandle.style.width = "100%";
    dragHandle.style.height = "20px";
    dragHandle.style.cursor = "move";
    sidebar.appendChild(dragHandle);

    // Add single resizer
    const resizer = document.createElement("div");
    resizer.style.position = "absolute";
    resizer.style.bottom = "0";
    resizer.style.right = "0";
    resizer.style.width = "10px";
    resizer.style.height = "10px";
    resizer.style.cursor = "se-resize";
    sidebar.appendChild(resizer);

    // Drag-to-move functionality
    let isDragging = false;
    let startX, startY, initialLeft, initialTop;

    dragHandle.addEventListener("mousedown", (e) => {
      if (isSmallScreen) return;
      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;
      initialLeft = parseFloat(sidebar.style.left) || 0;
      initialTop = parseFloat(sidebar.style.top) || 0;
    });

    document.addEventListener("mousemove", (e) => {
      if (!isDragging) return;
      const deltaX = e.clientX - startX;
      const deltaY = e.clientY - startY;
      sidebar.style.left = `${Math.max(0, Math.min(initialLeft + deltaX, window.innerWidth - sidebar.offsetWidth))}px`;
      sidebar.style.top = `${Math.max(0, Math.min(initialTop + deltaY, window.innerHeight - sidebar.offsetHeight))}px`;
    });

    document.addEventListener("mouseup", () => {
      isDragging = false;
    });

    // Drag-resize functionality
    let isResizing = false;
    let initialWidth, initialHeight;

    resizer.addEventListener("mousedown", (e) => {
      if (isSmallScreen) return;
      isResizing = true;
      startX = e.clientX;
      startY = e.clientY;
      initialWidth = sidebar.offsetWidth;
      initialHeight = sidebar.offsetHeight;
      e.preventDefault(); // Prevent text selection
    });

    document.addEventListener("mousemove", (e) => {
      if (!isResizing) return;
      const deltaX = e.clientX - startX;
      const deltaY = e.clientY - startY;
      sidebar.style.width = `${Math.max(200, initialWidth + deltaX)}px`;
      sidebar.style.height = `${Math.max(200, initialHeight + deltaY)}px`;
    });

    document.addEventListener("mouseup", () => {
      isResizing = false;
    });

    // Handle window resize
    window.addEventListener("resize", () => {
      const isNowSmallScreen = window.innerWidth <= 768;
      Object.assign(sidebar.style, {
        width: isNowSmallScreen ? "100vw" : "48vw",
        height: isNowSmallScreen ? "100vh" : "96vh",
        left: isNowSmallScreen ? "0" : `${window.innerWidth - (window.innerWidth * 0.48) - 20}px`,
        top: isNowSmallScreen ? "0" : "20px"
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

// Handle messages for closing sidebar
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
    });
  }
});