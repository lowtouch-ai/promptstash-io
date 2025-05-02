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
    themeToggle: document.getElementById("themeToggle"),
    favoriteSuggestions: document.getElementById("favoriteSuggestions"),
    fullscreenToggle: document.getElementById("fullscreenToggle"),
    closeBtn: document.getElementById("closeBtn"),
    toast: document.getElementById("toast")
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
    adjustPromptAreaHeight(); // Adjust prompt area height on load
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
    const footerHeight = buttons.offsetHeight;
    const availableHeight = window.innerHeight - header.offsetHeight - searchSelect.offsetHeight - template.offsetHeight - footerHeight - 40; // Padding
    elements.promptArea.style.height = `${Math.max(100, availableHeight)}px`;
  }

  // Toggle theme
  elements.themeToggle.addEventListener("click", () => {
    currentTheme = currentTheme === "light" ? "dark" : "light";
    document.body.className = currentTheme;
    saveState();
  });

  // Toggle fullscreen
  elements.fullscreenToggle.addEventListener("click", () => {
    const isFullscreen = document.body.classList.toggle("fullscreen");
    elements.fullscreenToggle.setAttribute("aria-label", isFullscreen ? "Exit fullscreen" : "Enter fullscreen");
    elements.fullscreenToggle.setAttribute("title", isFullscreen ? "Exit fullscreen" : "Enter fullscreen");
    adjustPromptAreaHeight();
    saveState();
  });

  // Close sidebar
  elements.closeBtn.addEventListener("click", () => {
    window.parent.postMessage({ action: "closeSidebar" }, "*");
  });

  // Handle ESC key to close sidebar
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      window.parent.postMessage({ action: "closeSidebar" }, "*");
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

  // Undo typing
  elements.promptArea.addEventListener("input", () => {
    storeLastState();
    saveState();
  });

  // Normalize tags input
  elements.templateTags.addEventListener("input", () => {
    storeLastState();
    let value = elements.templateTags.value.trim();
    if (value) {
      value = value.replace(/[^a-zA-Z0-9-_, ]/g, "").replace(/[, ]+/g, ", ").replace(/^[,\s]/g, "");
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

  // Load templates and suggestions
  function loadTemplates(filter, query = "") {
    chrome.storage.sync.get(["templates"], (result) => {
      let templates = result.templates || defaultTemplates.map((t, i) => ({ ...t, index: i })); // Assign indices to pre-built
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

      // Populate dropdown
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
            elements.searchBox.value = tmpl.name;
            elements.dropdownResults.innerHTML = "";
            saveState();
          }
        });
        div.innerHTML += `<button class="favorite-toggle ${tmpl.favorite ? 'favorited' : 'unfavorited'}" data-name="${tmpl.name}" aria-label="${tmpl.favorite ? 'Unfavorite' : 'Favorite'} template">${tmpl.favorite ? '★' : '☆'}</button>`;
        elements.dropdownResults.appendChild(div);
      });

      // Populate favorite suggestions
      const favorites = templates.filter(tmpl => tmpl.favorite);
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
          elements.searchBox.value = tmpl.name;
          saveState();
        });
        span.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " ") {
            span.click();
          }
        });
        elements.favoriteSuggestions.appendChild(span);
      });
    });
  }

  // Show dropdown on search box click
  elements.searchBox.addEventListener("click", (event) => {
    event.stopPropagation();
    loadTemplates(elements.typeSelect.value, elements.searchBox.value.toLowerCase());
  });

  // Search as user types
  elements.searchBox.addEventListener("input", () => {
    loadTemplates(elements.typeSelect.value, elements.searchBox.value.toLowerCase());
  });

  // Handle type select
  elements.typeSelect.addEventListener("change", () => {
    loadTemplates(elements.typeSelect.value, elements.searchBox.value.toLowerCase());
  });

  // Close dropdowns when clicking outside
  document.addEventListener("click", (event) => {
    if (!elements.searchBox.contains(event.target) && !elements.dropdownResults.contains(event.target) && !elements.themeToggle.contains(event.target)) {
      elements.dropdownResults.innerHTML = "";
    }
    if (!elements.typeSelect.contains(event.target)) {
      elements.typeSelect.blur();
    }
  });

  // Save changes to existing template
  elements.saveBtn.addEventListener("click", () => {
    if (!selectedTemplateName) {
      alert("Please select a template to save changes.");
      return;
    }
    chrome.storage.sync.get(["templates"], (result) => {
      const templates = result.templates || defaultTemplates.map((t, i) => ({ ...t, index: i }));
      const template = templates.find(t => t.name === selectedTemplateName);
      if (!template) {
        alert("Selected template not found.");
        return;
      }
      storeLastState();
      lastState.templates = [...templates]; // Backup for undo
      const isRenamed = elements.templateName.value !== selectedTemplateName;
      const isEdited = elements.templateTags.value !== template.tags || elements.promptArea.value !== template.content;
      const isPreBuilt = template.type === "pre-built";
      let message = "Are you sure you want to ";
      if (isRenamed && isEdited) {
        message += `rename "${selectedTemplateName}" to "${elements.templateName.value}" and edit its content/tags?`;
      } else if (isRenamed) {
        message += `rename "${selectedTemplateName}" to "${elements.templateName.value}"?`;
      } else if (isEdited) {
        message += `edit the content/tags of "${selectedTemplateName}"?`;
      }
      if (isPreBuilt) {
        message += "\nThis is a pre-built template.";
      }
      const confirmSave = confirm(message);
      if (!confirmSave) return;

      const templateIndex = templates.findIndex(t => t.name === selectedTemplateName);
      templates[templateIndex] = {
        name: elements.templateName.value,
        tags: elements.templateTags.value.trim().replace(/,\s*$/, ""),
        content: elements.promptArea.value,
        type: template.type,
        favorite: template.favorite || false,
        index: template.index // Preserve index
      };
      chrome.storage.sync.set({ templates }, () => {
        showToast("Template saved. Press Ctrl+Z to undo.");
        selectedTemplateName = elements.templateName.value;
        loadTemplates(elements.typeSelect.value);
        saveState();
      });
    });
  });

  // Save as new template
  elements.saveAsBtn.addEventListener("click", () => {
    let name = elements.templateName.value.trim();
    let tags = elements.templateTags.value.trim();

    if (!name || !tags) {
      chrome.storage.sync.get(["templates"], (result) => {
        const templates = result.templates || defaultTemplates.map((t, i) => ({ ...t, index: i }));
        let defaultName = name;
        let i = 0;
        while (templates.some(t => t.name === defaultName)) {
          defaultName = `${name} (${++i})`;
        }
        const details = prompt(`Enter template details:\nName (required):`, `${defaultName}\n${tags}`);
        if (!details) return;
        const [newName, newTags] = details.split("\n").map(s => s.trim());
        if (!newName) return;
        name = newName;
        tags = newTags || "";
        elements.templateName.value = name;
        elements.templateTags.value = tags;
        saveNewTemplate(name, tags);
      });
    } else {
      saveNewTemplate(name, tags);
    }
  });

  // Helper function to save new template
  function saveNewTemplate(name, tags) {
    chrome.storage.sync.get(["templates"], (result) => {
      let templates = result.templates || defaultTemplates.map((t, i) => ({ ...t, index: i }));
      if (templates.some(tmpl => tmpl.name === name)) {
        name = prompt("Template name already exists. Please provide a new name:");
        if (!name) return;
        elements.templateName.value = name;
      }
      storeLastState();
      lastState.templates = [...templates]; // Backup for undo
      const confirmSave = confirm(`Save as new template "${name}"?`);
      if (!confirmSave) return;

      templates.push({
        name,
        tags: tags.trim().replace(/,\s*$/, ""),
        content: elements.promptArea.value,
        type: "custom",
        favorite: false,
        index: nextIndex++ // Assign new index
      });
      chrome.storage.sync.set({ templates }, () => {
        showToast("Template saved. Press Ctrl+Z to undo.");
        loadTemplates(elements.typeSelect.value);
        saveState();
      });
    });
  }

  // Fetch prompt from website
  elements.fetchBtn.addEventListener("click", () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      chrome.tabs.sendMessage(tabs[0].id, { action: "getPrompt" }, (response) => {
        if (response && response.prompt) {
          storeLastState();
          elements.promptArea.value = response.prompt;
          saveState();
        }
      });
    });
  });

  // Send prompt to website and close sidebar
  elements.sendBtn.addEventListener("click", () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      chrome.tabs.sendMessage(tabs[0].id, {
        action: "sendPrompt",
        prompt: elements.promptArea.value
      }, () => {
        window.parent.postMessage({ action: "closeSidebar" }, "*");
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
      lastState.templates = [...templates]; // Backup for undo
      const templateIndex = templates.findIndex(t => t.name === selectedTemplateName);
      templates.splice(templateIndex, 1);
      chrome.storage.sync.set({ templates }, () => {
        showToast("Template deleted. Press Ctrl+Z to undo.");
        selectedTemplateName = null;
        elements.templateName.value = "";
        elements.templateTags.value = "";
        elements.promptArea.value = "";
        elements.searchBox.value = "";
        loadTemplates(elements.typeSelect.value);
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
          loadTemplates(elements.typeSelect.value);
        });
      }
      showToast("Action undone.");
      lastState = null; // Clear after undo
      saveState();
    }
  });

  // Clear prompt area
  elements.clearPrompt.addEventListener("click", () => {
    storeLastState();
    elements.promptArea.value = "";
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
            loadTemplates(elements.typeSelect.value, elements.searchBox.value.toLowerCase());
          });
        }
      });
    }
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
});