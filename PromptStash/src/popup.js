// Import default templates
import defaultTemplates from './defaultTemplates.mjs';

// Initialize DOM elements
document.addEventListener("DOMContentLoaded", () => {
  // DOM elements
  const elements = {
    searchBox: document.getElementById("searchBox"),
    typeSelect: document.getElementById("typeSelect"),
    dropdownResults: document.getElementById("dropdownResults"),
    templateName: document.getElementById("templateName"),
    templateTags: document.getElementById("templateTags"),
    promptArea: document.getElementById("promptArea"),
    fetchBtn: document.getElementById("fetchBtn"),
    saveBtn: document.getElementById("saveBtn"),
    saveAsBtn: document.getElementById("saveAsBtn"),
    deleteBtn: document.getElementById("deleteBtn"),
    clearPrompt: document.getElementById("clearPrompt"),
    clearTags: document.getElementById("clearTags"),
    sendBtn: document.getElementById("sendBtn"),
    clearSearch: document.getElementById("clearSearch"),
    favoriteSuggestions: document.getElementById("favoriteSuggestions"),
    fullscreenToggle: document.getElementById("fullscreenToggle"),
    closeBtn: document.getElementById("closeBtn"),
    toast: document.getElementById("toast"),
    renameBtn: document.getElementById("renameBtn"),
    confirmRename: document.getElementById("confirmRename"),
    cancelRename: document.getElementById("cancelRename"),
    favoriteStar: document.getElementById("favoriteStar"),
    dragHandle: document.querySelector('.drag-handle'),
    resizeHandle: document.querySelector('.resize-handle'),
    menuBtn: document.getElementById('menuBtn'),
    menuDropdown: document.getElementById('menuDropdown'),
    themeToggleMenu: document.getElementById('themeToggleMenu')
  };

  // Check if all elements exist
  if (Object.values(elements).some(el => !el)) {
    console.error("One or more DOM elements not found");
    return;
  }

  let selectedTemplateName = null;
  let currentTheme = "light";
  let lastState = null; // Store last state for undo
  let nextIndex = 0; // Track next available index
  let isFullscreen = false; // Track fullscreen state
  let windowId = null; // Store the ID of the popup window

  // Get the current window ID
  chrome.runtime.sendMessage({ action: "getWindowId" }, (response) => {
    if (response && response.windowId) {
      windowId = response.windowId;
    }
  });

  // Load sidebar state and initialize index
  chrome.storage.local.get(["sidebarState", "theme", "nextIndex"], (result) => {
    const state = result.sidebarState || {};
    elements.templateName.value = state.name || "";
    elements.templateTags.value = state.tags || "";
    elements.promptArea.value = state.content || "";
    selectedTemplateName = state.selectedName || null;
    currentTheme = result.theme || "light";
    nextIndex = result.nextIndex || defaultTemplates.length; // Start after pre-built
    document.body.className = currentTheme;
    elements.fetchBtn.style.display = elements.promptArea.value ? 'none' : 'block'; // Initial fetchBtn visibility
    loadTemplates(elements.typeSelect.value, "", false); // Load only favoriteSuggestions initially
    adjustPromptAreaHeight(); // Adjust prompt area height on load
    elements.themeToggleMenu.textContent = currentTheme === 'light' ? 'Darkmode' : 'Lightmode'; // Set initial theme toggle text
  });

  // Save sidebar state
  function saveState() {
    chrome.storage.local.set({
      sidebarState: {
        name: elements.templateName.value,
        tags: elements.templateTags.value,
        content: elements.promptArea.value,
        selectedName: selectedTemplateName
      },
      theme: currentTheme,
      nextIndex
    });
  }

  // Store last state for undo
  function storeLastState() {
    lastState = {
      name: elements.templateName.value,
      tags: elements.templateTags.value,
      content: elements.promptArea.value,
      selectedName: selectedTemplateName,
      templates: null // Will be populated for save/delete
    };
  }

  // Show toast notification
  function showToast(message) {
    elements.toast.textContent = message;
    elements.toast.classList.add("show");
    setTimeout(() => elements.toast.classList.remove("show"), 3000);
  }

  // Adjust prompt area height dynamically
  function adjustPromptAreaHeight() {
    const header = document.querySelector("header");
    const searchSelect = document.querySelector(".search-select");
    const template = document.querySelector(".template");
    const buttons = document.querySelector("#buttons");
    const templateRect = template.getBoundingClientRect();
    const buttonsRect = buttons.getBoundingClientRect();
    const availableHeight = window.innerHeight - header.offsetHeight - searchSelect.offsetHeight - templateRect.height - buttonsRect.height;
    elements.promptArea.style.height = `${Math.max(100, availableHeight)}px`;
    elements.promptArea.style.marginBottom = `${buttonsRect.height + 10}px`; // Ensure no overlap with buttons
  }

  // Drag functionality for moving the window
  elements.dragHandle.addEventListener('mousedown', (event) => {
    event.preventDefault();
    if (!windowId) return;
    let initialX = event.screenX;
    let initialY = event.screenY;
    let currentWindow = null;

    chrome.windows.get(windowId, (win) => {
      currentWindow = win;
    });

    function onMouseMove(e) {
      if (!currentWindow) return;
      const deltaX = e.screenX - initialX;
      const deltaY = e.screenY - initialY;
      const newLeft = currentWindow.left + deltaX;
      const newTop = currentWindow.top + deltaY;
      chrome.windows.update(windowId, { left: newLeft, top: newTop });
      initialX = e.screenX;
      initialY = e.screenY;
    }

    function onMouseUp() {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    }

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  });

  // Resize functionality for the window
  elements.resizeHandle.addEventListener('mousedown', (event) => {
    event.preventDefault();
    if (!windowId) return;
    let initialX = event.screenX;
    let initialY = event.screenY;
    let currentWindow = null;

    chrome.windows.get(windowId, (win) => {
      currentWindow = win;
    });

    function onMouseMove(e) {
      if (!currentWindow) return;
      const deltaX = e.screenX - initialX;
      const deltaY = e.screenY - initialY;
      const newWidth = Math.max(300, Math.min(currentWindow.width + deltaX, window.screen.width * 0.9)); // Min 300px, max 90% of screen
      const newHeight = Math.max(400, Math.min(currentWindow.height + deltaY, window.screen.height * 0.9)); // Min 400px, max 90% of screen
      chrome.windows.update(windowId, { width: Math.round(newWidth), height: Math.round(newHeight) });
      initialX = e.screenX;
      initialY = e.screenY;
    }

    function onMouseUp() {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    }

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  });

  // Responsive resizing for header and buttons
  const resizeObserver = new ResizeObserver(entries => {
    for (let entry of entries) {
      const width = entry.contentRect.width;
      const baseFontSize = Math.min(Math.max(width / 20, 14), 24); // Min 14px, max 24px
      document.documentElement.style.setProperty('--base-font-size', `${baseFontSize}px`);
    }
  });
  resizeObserver.observe(document.body);

  // Hamburger menu toggle
  elements.menuBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    elements.menuDropdown.style.display = elements.menuDropdown.style.display === 'none' ? 'block' : 'none';
  });

  // Close menu when clicking outside
  document.addEventListener('click', (event) => {
    if (!elements.menuBtn.contains(event.target) && !elements.menuDropdown.contains(event.target)) {
      elements.menuDropdown.style.display = 'none';
    }
  });

  // Theme toggle via menu
  elements.themeToggleMenu.addEventListener('click', () => {
    currentTheme = currentTheme === 'light' ? 'dark' : 'light';
    document.body.className = currentTheme;
    elements.themeToggleMenu.textContent = currentTheme === 'light' ? 'Darkmode' : 'Lightmode';
    saveState();
  });

  // Placeholder menu options
  elements.menuDropdown.querySelector('#saveLocally').addEventListener('click', () => {
    alert('Save locally functionality to be implemented.');
  });
  elements.menuDropdown.querySelector('#toggleMarkdown').addEventListener('click', () => {
    alert('Toggle markdown functionality to be implemented.');
  });
  elements.menuDropdown.querySelector('#exportData').addEventListener('click', () => {
    alert('Export data functionality to be implemented.');
  });
  elements.menuDropdown.querySelector('#importData').addEventListener('click', () => {
    alert('Import data functionality to be implemented.');
  });

  // Toggle fullscreen
  elements.fullscreenToggle.addEventListener("click", () => {
    isFullscreen = !isFullscreen;
    const svg = elements.fullscreenToggle.querySelector("svg use");
    svg.setAttribute("href", isFullscreen ? "sprite.svg#compress" : "sprite.svg#fullscreen");
    saveState();
    chrome.runtime.sendMessage({ action: "toggleFullscreen", windowId });
  });

  // Close window
  elements.closeBtn.addEventListener("click", () => {
    chrome.runtime.sendMessage({ action: "closeSidebar", windowId });
  });

  // Clear search input
  elements.clearSearch.addEventListener("click", () => {
    elements.searchBox.value = "";
    loadTemplates(elements.typeSelect.value, "", false);
    elements.searchBox.focus();
  });

  // Handle ESC key to close window
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      chrome.runtime.sendMessage({ action: "closeSidebar", windowId });
    }
  });

  // Handle TAB key for indenting
  elements.promptArea.addEventListener("keydown", (event) => {
    if (event.key === "Tab") {
      event.preventDefault();
      const start = elements.promptArea.selectionStart;
      const end = elements.promptArea.selectionEnd;
      const value = elements.promptArea.value;
      elements.promptArea.value = value.substring(0, start) + "  " + value.substring(end);
      elements.promptArea.selectionStart = elements.promptArea.selectionEnd = start + 2;
      saveState();
    }
  });

  // Control fetchBtn visibility on input
  elements.promptArea.addEventListener("input", () => {
    storeLastState();
    elements.fetchBtn.style.display = elements.promptArea.value ? 'none' : 'block';
    saveState();
  });

  // Normalize tags input in real-time: strictly comma-separated with no internal whitespace
  elements.templateTags.addEventListener("input", () => {
    storeLastState();
    let value = elements.templateTags.value;
    if (value) {
      value = value.replace(/^[,\s]/g, "");
      value = value.replace(/[,\s.;/]+/g, ", ");
      value = value.replace(/[^a-zA-Z0-9_, ]/g, "");
      elements.templateTags.value = value;
    }
    saveState();
  });

  // Clear tags
  elements.clearTags.addEventListener("click", () => {
    storeLastState();
    elements.templateTags.value = "";
    saveState();
  });

  // Sanitize tags to ensure strictly comma-separated format with no internal whitespace
  function sanitizeTags(input) {
    if (!input) return "";
    const tags = input.split(",").map(tag => tag.trim().replace(/\s+/g, ""));
    return tags.filter(tag => tag).join(", ");
  }

  // Load templates and suggestions with dropdown control
  function loadTemplates(filter, query = "", showDropdown = false) {
    chrome.storage.sync.get(["templates"], (result) => {
      let templates = result.templates || defaultTemplates.map((t, i) => ({ ...t, index: i }));
      elements.dropdownResults.innerHTML = "";
      elements.favoriteSuggestions.innerHTML = "";

      // Filter templates
      let filteredTemplates = templates.filter(tmpl => filter === "all" || tmpl.type === filter);
      if (query) {
        filteredTemplates = filteredTemplates.filter(t =>
          t.name.toLowerCase().includes(query) || t.tags.toLowerCase().includes(query)
        );
        filteredTemplates.sort((a, b) => {
          const aMatch = a.name.toLowerCase().indexOf(query) + a.tags.toLowerCase().indexOf(query);
          const bMatch = b.name.toLowerCase().indexOf(query) + b.tags.toLowerCase().indexOf(query);
          if (aMatch !== bMatch) return aMatch - bMatch;
          return a.name.localeCompare(b.name);
        });
      }

      // Sort favorites to top
      filteredTemplates.sort((a, b) => (b.favorite || 0) - (a.favorite || 0));

      // Populate dropdown only if showDropdown is true
      if (showDropdown) {
        filteredTemplates.forEach((tmpl) => {
          const div = document.createElement("div");
          div.textContent = tmpl.favorite ? `${tmpl.name} (${tmpl.tags})` : `${tmpl.name} (${tmpl.tags})`;
          div.setAttribute("role", "option");
          div.setAttribute("aria-selected", selectedTemplateName === tmpl.name);
          div.addEventListener("click", (event) => {
            if (!event.target.classList.contains("favorite-toggle")) {
              selectedTemplateName = tmpl.name;
              elements.templateName.value = tmpl.name;
              elements.templateTags.value = tmpl.tags;
              elements.promptArea.value = tmpl.content;
              elements.searchBox.value = "";
              elements.dropdownResults.innerHTML = "";
              resetRenameState();
              saveState();
              elements.promptArea.focus();
            }
          });
          div.innerHTML += `<button class="favorite-toggle ${tmpl.favorite ? 'favorited' : 'unfavorited'}" data-name="${tmpl.name}" aria-label="${tmpl.favorite ? 'Unfavorite' : 'Favorite'} template">${tmpl.favorite ? '★' : '☆'}</button>`;
          elements.dropdownResults.appendChild(div);
        });
      }

      // Always populate favorite suggestions
      const favorites = templates.filter(tmpl => tmpl.favorite);
      if (favorites.length > 0) {
        elements.favoriteStar.classList.remove("d-none");
        elements.favoriteSuggestions.classList.remove("d-none");
        favorites.forEach((tmpl) => {
          const span = document.createElement("span");
          span.textContent = tmpl.name;
          span.className = "favorite-suggestion";
          span.setAttribute("role", "button");
          span.setAttribute("tabindex", "0");
          span.addEventListener("click", () => {
            selectedTemplateName = tmpl.name;
            elements.templateName.value = tmpl.name;
            elements.templateTags.value = tmpl.tags;
            elements.promptArea.value = tmpl.content;
            elements.searchBox.value = "";
            saveState();
            elements.promptArea.focus();
          });
          span.addEventListener("keydown", (e) => {
            if (e.key === "Enter" || e.key === " ") {
              span.click();
            }
          });
          elements.favoriteSuggestions.appendChild(span);
        });
      } else {
        elements.favoriteStar.classList.add("d-none");
        elements.favoriteSuggestions.classList.add("d-none");
      }
    });
  }

  // Show dropdown on search box focus
  elements.searchBox.addEventListener("focus", () => {
    loadTemplates(elements.typeSelect.value, elements.searchBox.value.toLowerCase(), true);
  });

  // Search as user types
  elements.searchBox.addEventListener("input", () => {
    loadTemplates(elements.typeSelect.value, elements.searchBox.value.toLowerCase(), true);
  });

  // Handle type select
  elements.typeSelect.addEventListener("change", () => {
    loadTemplates(elements.typeSelect.value, elements.searchBox.value.toLowerCase(), true);
  });

  // Close dropdowns when clicking outside
  document.addEventListener("click", (event) => {
    if (!elements.searchBox.contains(event.target) && !elements.dropdownResults.contains(event.target)) {
      elements.dropdownResults.innerHTML = "";
    }
    if (!elements.typeSelect.contains(event.target)) {
      elements.typeSelect.blur();
    }
  });

  // Validate template size
  function validateTemplateSize(template) {
    const serialized = JSON.stringify(template);
    const sizeInBytes = new TextEncoder().encode(serialized).length;
    const maxSize = 8 * 1024; // 8KB
    return { isValid: sizeInBytes <= maxSize, size: sizeInBytes };
  }

  // Save templates with error handling
  function saveTemplates(templates, callback, isNewTemplate = false) {
    const validation = validateTemplateSize({ templates });
    if (!validation.isValid) {
      showToast(`Template size (${(validation.size / 1024).toFixed(2)} KB) exceeds sync storage limit (8 KB). Please reduce the size.`);
      return;
    }

    chrome.storage.sync.set({ templates }, () => {
      if (chrome.runtime.lastError) {
        showToast("Failed to save template: " + chrome.runtime.lastError.message);
        console.error("Sync storage error:", chrome.runtime.lastError);
      } else {
        showToast(isNewTemplate ? "Template saved. Press Ctrl+Z to undo." : "Template updated. Press Ctrl+Z to undo.");
        callback();
      }
    });
  }

  // Save changes to existing template
  elements.saveBtn.addEventListener("click", () => {
    if (!selectedTemplateName) {
      alert("Please select a template to save changes.");
      return;
    }
    chrome.storage.sync.get(["templates"], (result) => {
      let templates = result.templates || defaultTemplates.map((t, i) => ({ ...t, index: i }));
      const template = templates.find(t => t.name === selectedTemplateName);
      if (!template) {
        alert("Selected template not found.");
        return;
      }
      const isEdited = sanitizeTags(elements.templateTags.value) !== template.tags || elements.promptArea.value !== template.content;
      if (!isEdited) {
        showToast("No changes to save.");
        return;
      }
      storeLastState();
      lastState.templates = [...templates];
      const isPreBuilt = template.type === "pre-built";
      const message = `Are you sure you want to edit the content/tags of "${selectedTemplateName}"?${isPreBuilt ? "\nThis is a pre-built template." : ""}`;
      const confirmSave = confirm(message);
      if (!confirmSave) return;

      const templateIndex = templates.findIndex(t => t.name === selectedTemplateName);
      templates[templateIndex] = {
        name: selectedTemplateName,
        tags: sanitizeTags(elements.templateTags.value),
        content: elements.promptArea.value,
        type: template.type,
        favorite: template.favorite || false,
        index: template.index
      };

      saveTemplates(templates, () => {
        loadTemplates(elements.typeSelect.value, "", false);
        saveState();
      });
    });
  });

  // Save as new template
  elements.saveAsBtn.addEventListener("click", () => {
    chrome.storage.sync.get(["templates"], (result) => {
      const templates = result.templates || defaultTemplates.map((t, i) => ({ ...t, index: i }));
      let defaultName = "New Template";
      let i = 1;
      while (templates.some(t => t.name === defaultName)) {
        defaultName = `New Template ${i++}`;
      }
      let name = prompt("Enter template name (required):", defaultName);
      if (name === null) return;
      name = name.trim();
      if (!name) {
        showToast("Name is mandatory.");
        return;
      }
      if (templates.some(t => t.name === name)) {
        showToast("Name already exists.");
        return;
      }
      let tagsInput = prompt("Enter tags (optional, comma-separated):", elements.templateTags.value);
      if (tagsInput === null) tagsInput = "";
      const tags = sanitizeTags(tagsInput);
      saveNewTemplate(name, tags);
    });
  });

  // Helper function to save new template
  function saveNewTemplate(name, tags) {
    chrome.storage.sync.get(["templates"], (result) => {
      let templates = result.templates || defaultTemplates.map((t, i) => ({ ...t, index: i }));
      storeLastState();
      lastState.templates = [...templates];
      const confirmSave = confirm(`Save as new template "${name}"?`);
      if (!confirmSave) return;

      const newTemplate = {
        name,
        tags,
        content: elements.promptArea.value,
        type: "custom",
        favorite: false,
        index: nextIndex++
      };

      templates.push(newTemplate);

      saveTemplates(templates, () => {
        selectedTemplateName = name;
        elements.templateName.value = name;
        loadTemplates(elements.typeSelect.value, "", false);
        saveState();
      }, true);
    });
  }

  // Fetch prompt from website
  elements.fetchBtn.addEventListener("click", () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      chrome.tabs.sendMessage(tabs[0].id, { action: "getPrompt" }, (response) => {
        if (response && response.prompt) {
          storeLastState();
          elements.promptArea.value = response.prompt;
          elements.fetchBtn.style.display = 'none';
          saveState();
        }
      });
    });
  });

  // Send prompt to website and close window
  elements.sendBtn.addEventListener("click", () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      chrome.tabs.sendMessage(tabs[0].id, {
        action: "sendPrompt",
        prompt: elements.promptArea.value
      }, () => {
        chrome.runtime.sendMessage({ action: "closeSidebar", windowId });
      });
    });
  });

  // Delete selected template
  elements.deleteBtn.addEventListener("click", () => {
    if (!selectedTemplateName) {
      alert("Please select a template to delete.");
      return;
    }
    chrome.storage.sync.get(["templates"], (result) => {
      const templates = result.templates || defaultTemplates.map((t, i) => ({ ...t, index: i }));
      const template = templates.find(t => t.name === selectedTemplateName);
      const isPreBuilt = template.type === "pre-built";
      const message = `Are you sure you want to delete "${selectedTemplateName}"?${isPreBuilt ? "\nThis is a pre-built template." : ""}`;
      const confirmDelete = confirm(message);
      if (!confirmDelete) return;

      storeLastState();
      lastState.templates = [...templates];
      const templateIndex = templates.findIndex(t => t.name === selectedTemplateName);
      templates.splice(templateIndex, 1);
      chrome.storage.sync.set({ templates }, () => {
        showToast("Template deleted. Press Ctrl+Z to undo.");
        selectedTemplateName = null;
        elements.templateName.value = "";
        elements.templateTags.value = "";
        elements.promptArea.value = "";
        elements.searchBox.value = "";
        loadTemplates(elements.typeSelect.value, "", false);
        saveState();
      });
    });
  });

  // Undo last action
  document.addEventListener("keydown", (event) => {
    if (event.ctrlKey && event.key === "z" && lastState) {
      elements.templateName.value = lastState.name || "";
      elements.templateTags.value = lastState.tags || "";
      elements.promptArea.value = lastState.content || "";
      selectedTemplateName = lastState.selectedName || null;
      if (lastState.templates) {
        chrome.storage.sync.set({ templates: lastState.templates }, () => {
          loadTemplates(elements.typeSelect.value, "", false);
        });
      }
      showToast("Action undone.");
      lastState = null;
      saveState();
    }
  });

  // Clear prompt area
  elements.clearPrompt.addEventListener("click", () => {
    storeLastState();
    elements.promptArea.value = "";
    elements.fetchBtn.style.display = 'block';
    elements.promptArea.focus();
    saveState();
  });

  // Toggle favorite status
  document.addEventListener("click", (event) => {
    if (event.target.classList.contains("favorite-toggle")) {
      const name = event.target.dataset.name;
      chrome.storage.sync.get(["templates"], (result) => {
        const templates = result.templates || defaultTemplates.map((t, i) => ({ ...t, index: i }));
        const template = templates.find(t => t.name === name);
        if (template) {
          template.favorite = !template.favorite;
          chrome.storage.sync.set({ templates }, () => {
            loadTemplates(elements.typeSelect.value, elements.searchBox.value.toLowerCase(), true);
          });
        }
      });
    }
  });

  // Reset rename state to default
  function resetRenameState() {
    elements.templateName.setAttribute("readonly", "true");
    elements.templateName.classList.remove("highlight");
    elements.renameBtn.classList.remove("d-none");
    elements.confirmRename.classList.add("d-none");
    elements.cancelRename.classList.add("d-none");
  }

  // Initiate rename process
  elements.renameBtn.addEventListener("click", () => {
    if (!selectedTemplateName) {
      showToast("Please select a template to rename.");
      return;
    }
    elements.templateName.removeAttribute("readonly");
    elements.templateName.classList.add("highlight");
    elements.templateName.focus();
    elements.renameBtn.classList.add("d-none");
    elements.confirmRename.classList.remove("d-none");
    elements.cancelRename.classList.remove("d-none");
    elements.templateName.dataset.originalName = selectedTemplateName;
  });

  // Cancel rename and revert
  elements.cancelRename.addEventListener("click", () => {
    const originalName = elements.templateName.dataset.originalName;
    elements.templateName.value = originalName;
    elements.templateName.setAttribute("readonly", "true");
    elements.templateName.classList.remove("highlight");
    elements.renameBtn.classList.remove("d-none");
    elements.confirmRename.classList.add("d-none");
    elements.cancelRename.classList.add("d-none");
  });

  // Confirm rename with validation
  elements.confirmRename.addEventListener("click", () => {
    const newName = elements.templateName.value.trim();
    const originalName = elements.templateName.dataset.originalName;
    if (newName === originalName) {
      elements.templateName.setAttribute("readonly", "true");
      elements.templateName.classList.remove("highlight");
      elements.renameBtn.classList.remove("d-none");
      elements.confirmRename.classList.add("d-none");
      elements.cancelRename.classList.add("d-none");
      return;
    }
    if (!newName) {
      showToast("Name is mandatory.");
      return;
    }
    chrome.storage.sync.get(["templates"], (result) => {
      const templates = result.templates || defaultTemplates.map((t, i) => ({ ...t, index: i }));
      if (templates.some(t => t.name === newName)) {
        showToast("Name already exists.");
        return;
      }
      const templateIndex = templates.findIndex(t => t.name === originalName);
      if (templateIndex === -1) {
        showToast("Template not found.");
        return;
      }
      templates[templateIndex].name = newName;
      chrome.storage.sync.set({ templates }, () => {
        showToast("Template renamed.");
        selectedTemplateName = newName;
        elements.templateName.value = newName;
        elements.templateName.setAttribute("readonly", "true");
        elements.templateName.classList.remove("highlight");
        elements.renameBtn.classList.remove("d-none");
        elements.confirmRename.classList.add("d-none");
        elements.cancelRename.classList.add("d-none");
        loadTemplates(elements.typeSelect.value, "", false);
      });
    });
  });

  // Initialize tooltips
  const tooltipTriggerList = document.querySelectorAll('[data-bs-toggle="tooltip"]');
  tooltipTriggerList.forEach(tooltipTriggerEl => new bootstrap.Tooltip(tooltipTriggerEl, {
    delay: { show: 100, hide: 100 }
  }));

  // Keyboard navigation for dropdown
  elements.dropdownResults.addEventListener("keydown", (event) => {
    const items = elements.dropdownResults.querySelectorAll("div[role='option']");
    const focused = document.activeElement;
    let index = Array.from(items).indexOf(focused);
    if (event.key === "ArrowDown") {
      event.preventDefault();
      index = (index + 1) % items.length;
      items[index].focus();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      index = (index - 1 + items.length) % items.length;
      items[index].focus();
    } else if (event.key === "Enter") {
      event.preventDefault();
      focused.click();
    }
  });

  // Handle window resize for prompt area
  window.addEventListener("resize", adjustPromptAreaHeight);

  // Show the clear button only when the search box contains text
  elements.searchBox.addEventListener("input", () => {
    elements.clearSearch.style.display = elements.searchBox.value ? "block" : "none";
    loadTemplates(elements.typeSelect.value, elements.searchBox.value.toLowerCase(), true);
  });
});