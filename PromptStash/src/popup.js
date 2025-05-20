// Import default templates
import defaultTemplates from './defaultTemplates.mjs';

// Extension version for schema validation
const EXTENSION_VERSION = "1.0.0";

// Lightweight debounce function
function debounce(func, wait) {
  let timeout;
  return function (...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), wait);
  };
}

// Initialize DOM elements
document.addEventListener("DOMContentLoaded", () => {
  // DOM elements
  const elements = {
    searchBox: document.getElementById("searchBox"),
    typeSelect: document.getElementById("typeSelect"),
    dropdownResults: document.getElementById("dropdownResults"),
    template: document.getElementById("template"),
    templateName: document.getElementById("templateName"),
    templateTags: document.getElementById("templateTags"),
    promptArea: document.getElementById("promptArea"),
    buttons: document.getElementById("buttons"),
    fetchBtns: document.querySelectorAll("#fetchBtn, #fetchBtn2"),
    fetchBtn2: document.getElementById("fetchBtn2"),
    saveBtn: document.getElementById("saveBtn"),
    saveAsBtn: document.getElementById("saveAsBtn"),
    deleteBtn: document.getElementById("deleteBtn"),
    clearSearch: document.getElementById("clearSearch"),
    // clearName: document.getElementById("clearName"),
    // clearTags: document.getElementById("clearTags"),
    clearPrompt: document.getElementById("clearPrompt"),
    clearAllBtn: document.getElementById("clearAllBtn"),
    sendBtn: document.getElementById("sendBtn"),
    favoriteSuggestions: document.getElementById("favoriteSuggestions"),
    fullscreenToggle: document.getElementById("fullscreenToggle"),
    closeBtn: document.getElementById("closeBtn"),
    minimizeBtn: document.getElementById("minimizeBtn"),
    newBtn: document.getElementById("newBtn"),
    overlay: document.getElementById("overlay"),
    toast: document.getElementById("toast"),
    // favoriteStar: document.getElementsByClassName("favoriteStar"),
    // menuBtn: document.getElementById("menuBtn"),
    // menuDropdown: document.getElementById("menuDropdown"),
    themeToggle: document.getElementById("themeToggle")
  };

  // Log missing elements
  const missingElements = Object.entries(elements)
    .filter(([key, value]) => !value)
    .map(([key]) => key);
  if (missingElements.length > 0) {
    console.error("Missing DOM elements:", missingElements);
    showToast("Error: Extension UI failed to load. Please reload the extension.");
  } else {
    console.log("All DOM elements found:", Object.keys(elements));
  }

  let selectedTemplateName = null;
  let currentTheme = "light";
  let lastState = null;
  let nextIndex = 0;
  let isFullscreen = false;
  let recentIndices = [];

  // Load popup state, recent indices, and initialize index with version check
  chrome.storage.local.get(["popupState", "theme", "extensionVersion"], (localResult) => {
    chrome.storage.sync.get(["recentIndices", "templates", "nextIndex"], (syncResult) => {
      // Check if stored version matches current version
      const storedVersion = localResult.extensionVersion || "0.0.0";
      if (storedVersion !== EXTENSION_VERSION) {
        // Handle schema migration if needed (currently no changes required)
        console.log(`Version updated from ${storedVersion} to ${EXTENSION_VERSION}. No schema migration needed.`);
        chrome.storage.local.set({ extensionVersion: EXTENSION_VERSION }, () => {
          if (chrome.runtime.lastError) {
            console.error("Failed to save extension version:", chrome.runtime.lastError.message);
            showToast("Error: Failed to save extension version. Some data may not persist.");
          }
        });
      }

      // Initialize state, falling back to defaults if not present
      const state = localResult.popupState || {};
      elements.templateName.value = state.name || "";
      elements.templateTags.value = state.tags || "";
      elements.promptArea.value = state.content || "";
      selectedTemplateName = state.selectedName || null;
      currentTheme = localResult.theme || "light";
      nextIndex = syncResult.nextIndex || defaultTemplates.length;
      recentIndices = syncResult.recentIndices || [];
      // Ensure templates are initialized
      const templates = syncResult.templates || defaultTemplates.map((t, i) => ({ ...t, index: i }));

      // Save templates if they were initialized from defaults
      if (!syncResult.templates) {
        chrome.storage.sync.set({ templates }, () => {
          if (chrome.runtime.lastError) {
            console.error("Failed to initialize templates:", chrome.runtime.lastError.message);
            showToast("Error: Failed to initialize templates. Some data may not be saved.");
          }
        });
      }

      document.body.className = currentTheme;
      elements.fetchBtn2.style.display = elements.promptArea.value ? "none" : "block";
      loadTemplates(elements.typeSelect.value, "", false);
      // adjustPromptAreaHeight(); // Adjust prompt area height on load
    });
  });

  // Save popup state
  function saveState() {
    const state = {
      popupState: {
        name: elements.templateName.value,
        tags: elements.templateTags.value,
        content: elements.promptArea.value,
        selectedName: selectedTemplateName
      },
      theme: currentTheme,
      isFullscreen,
      extensionVersion: EXTENSION_VERSION
    };

    chrome.storage.local.set(state, () => {
      if (chrome.runtime.lastError) {
        console.error("Failed to save state:", chrome.runtime.lastError.message);
        showToast("Error: Failed to save extension state. Some data may not persist.");
      }
    });
  }

  // Save nextIndex to sync storage
  function saveNextIndex() {
    chrome.storage.sync.set({ nextIndex }, () => {
      if (chrome.runtime.lastError) {
        console.error("Failed to save nextIndex:", chrome.runtime.lastError.message);
        showToast("Error: Failed to save nextIndex. Some data may not persist.");
      }
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
    setTimeout(() => elements.toast.classList.remove("show"), 4000);
  }

  // Validate template name
  function validateTemplateName(name, templates, isSaveAs = false) {
    const trimmedName = name.trim();
    if (!trimmedName) {
      showToast("Error: Template name is required.");
      return { isValid: false, sanitizedName: null };
    }
    if (trimmedName.length > 50) {
      showToast("Error: Template name must be 50 characters or less.");
      return { isValid: false, sanitizedName: null };
    }
    const sanitizedName = trimmedName.replace(/[^a-zA-Z0-9\s]/g, "");
    if (sanitizedName !== trimmedName) {
      showToast("Error: Template name can only contain letters, numbers, and spaces.");
      return { isValid: false, sanitizedName: null };
    }
    // Check for duplicate names, excluding the current template only for save operations
    const isDuplicate = templates.some(t => t.name === sanitizedName && (isSaveAs || t.name !== selectedTemplateName));
    if (isDuplicate) {
      showToast("Error: Template name must be unique.");
      return { isValid: false, sanitizedName: null };
    }
    return { isValid: true, sanitizedName };
  }

  // Validate and sanitize tags
  function sanitizeTags(input) {
    if (!input) return "";
    const tags = input.split(",").map(tag => tag.trim()).filter(tag => tag);
    if (tags.length > 5) {
      showToast("Error: Maximum of 5 tags allowed per template.");
      return null;
    }
    const sanitizedTags = tags.map(tag => tag.replace(/[^a-zA-Z0-9]/g, "").slice(0, 20));
    if (sanitizedTags.some(tag => tag.length === 0)) {
      showToast("Error: Each tag must contain only letters or numbers and be 20 characters or less.");
      return null;
    }
    return sanitizedTags.join(", ");
  }

  // Sanitize content to prevent XSS
  function sanitizeContent(content) {
    if (!content) return "";
    // Remove script tags and event handlers
    const div = document.createElement("div");
    div.textContent = content;
    return div.innerHTML.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "");
  }

  // Validate individual template size
  function validateTemplateSize(template) {
    const serialized = JSON.stringify(template);
    const sizeInBytes = new TextEncoder().encode(serialized).length;
    const maxSize = 8 * 1024; // 8KB
    return { isValid: sizeInBytes <= maxSize, size: sizeInBytes };
  }

  // Check total sync storage usage
  function checkTotalStorageUsage(templates, callback) {
    chrome.storage.sync.get(null, (items) => {
      const serialized = JSON.stringify(items);
      const totalSizeInBytes = new TextEncoder().encode(serialized).length;
      const maxTotalSize = 100 * 1024; // 100KB
      if (totalSizeInBytes > 0.9 * maxTotalSize) {
        showToast("Warning: Storage is nearly full (90% of 100KB limit). Please delete unused templates.");
      }
      callback(totalSizeInBytes <= maxTotalSize);
    });
  }

  // Update recent indices
  function updateRecentIndices(index) {
    recentIndices.unshift(index); // Add to start
    recentIndices = [...new Set(recentIndices)]; // Remove duplicates
    // Prune to 10 most recent entries to reduce storage usage
    if (recentIndices.length > 10) {
      recentIndices = recentIndices.slice(0, 10);
    }
    // Save recentIndices explicitly
    const serializedRecentIndices = JSON.stringify({ recentIndices });
    const sizeInBytes = new TextEncoder().encode(serializedRecentIndices).length;
    if (sizeInBytes > 8 * 1024) {
      console.warn("Recent indices size exceeds sync quota, pruning older entries.");
      recentIndices = recentIndices.slice(0, 5);
    }
    chrome.storage.sync.set({ recentIndices }, () => {
      if (chrome.runtime.lastError) {
        console.error("Failed to save recent indices:", chrome.runtime.lastError.message);
      }
    });
  }

  // Debounced resize observer for responsive font sizing
  let resizeTimeout;
  const resizeObserver = new ResizeObserver(() => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
      const width = document.body.clientWidth;
      const baseFontSize = Math.min(Math.max(width / 20, 14), 24); // Min 14px, max 24px
      document.documentElement.style.setProperty("--base-font-size", `${baseFontSize}px`);
    }, 100);
  });
  resizeObserver.observe(document.body);

  // Real-time template name validation
  elements.templateName.addEventListener("input", debounce(() => {
    let value = elements.templateName.value;
    if (value.length > 50) {
      value = value.slice(0, 50);
      elements.templateName.value = value;
    }
    const sanitizedValue = value.replace(/[^a-zA-Z0-9\s]/g, "");
    if (sanitizedValue !== value) {
      elements.templateName.value = sanitizedValue;
      showToast("Error: Template name can only contain letters, numbers, and spaces.");
    }
    saveState();
  }, 10));

  // Real-time tags validation
  elements.templateTags.addEventListener("input", debounce(() => {
    storeLastState();
    let value = elements.templateTags.value;
    if (value) {
      value = value.replace(/^[,\s]+/g, "");
      value = value.replace(/,[,\s]*/g, ", ");
      value = value.replace(/\s+/g, " ");
      const tags = value.split(", ").map(tag => tag.replace(/[^a-zA-Z0-9]/g, "").slice(0, 20));
      if (tags.length > 5) {
        showToast("Error: Maximum of 5 tags allowed per template.");
        tags.length = 5;
      }
      value = tags.join(", ");
      elements.templateTags.value = value;
    }
    // Snap cursor if between "," and " "
    const cursorPos = elements.templateTags.selectionStart;
    if (value[cursorPos] === " " && value[cursorPos - 1] === ",") {
      elements.templateTags.selectionStart = elements.templateTags.selectionEnd = cursorPos - 1;
    }
    saveState();
  }, 10));

  // Theme toggle
  elements.themeToggle.addEventListener("click", () => {
    currentTheme = currentTheme === "light" ? "dark" : "light";
    document.body.className = currentTheme;
    saveState();
  });

  // Toggle fullscreen
  elements.fullscreenToggle.addEventListener("click", () => {
    const svg = elements.fullscreenToggle.querySelector("svg use");
    svg.setAttribute("href", isFullscreen ? "sprite.svg#compress" : "sprite.svg#fullscreen");
    isFullscreen = !isFullscreen;
    saveState();
    chrome.runtime.sendMessage({ action: "toggleFullscreen" });
  });

  // Minimize popup
  elements.minimizeBtn.addEventListener("click", () => {
    chrome.runtime.sendMessage({ action: "closePopup" });
  });

  // Close popup and clear fields
  elements.closeBtn.addEventListener("click", () => {
    elements.templateName.value = "";
    elements.templateTags.value = "";
    elements.promptArea.value = "";
    selectedTemplateName = null;
    elements.fetchBtn2.style.display = "block";
    elements.searchBox.value = "";
    loadTemplates(elements.typeSelect.value, "", false);
    saveState();
    chrome.runtime.sendMessage({ action: "closePopup" });
  });

  // New template button: Clear template area and reset selection
  elements.newBtn.addEventListener("click", () => {
    storeLastState();
    elements.templateName.value = "";
    elements.templateTags.value = "";
    elements.promptArea.value = "";
    selectedTemplateName = null;
    elements.fetchBtn2.style.display = "block";
    elements.searchBox.value = "";
    loadTemplates(elements.typeSelect.value, "", false);
    saveState();
    showToast("New template created.");
  });

  // Clear search input
  elements.clearSearch.addEventListener("click", () => {
    elements.searchBox.value = "";
    loadTemplates(elements.typeSelect.value, "", false);
    elements.searchBox.focus();
  });

  // Clear prompt area
  elements.clearPrompt.addEventListener("click", () => {
    storeLastState();
    elements.promptArea.value = "";
    elements.fetchBtn2.style.display = "block";
    elements.promptArea.focus();
    saveState();
  });

  // Clear all
  elements.clearAllBtn.addEventListener("click", () => {
    storeLastState();
    elements.templateName.value = "";
    elements.templateTags.value = "";
    elements.promptArea.value = "";
    selectedTemplateName = null;
    elements.fetchBtn2.style.display = "block";
    elements.searchBox.value = "";
    loadTemplates(elements.typeSelect.value, "", false);
    saveState();
    showToast("All fields cleared.");
  });

  // Handle ESC key to close popup
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      chrome.runtime.sendMessage({ action: "closePopup" });
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

  // Control fetchBtn2 visibility on input
  elements.promptArea.addEventListener("input", () => {
    storeLastState();
    elements.promptArea.value = sanitizeContent(elements.promptArea.value);
    elements.fetchBtn2.style.display = elements.promptArea.value ? "none" : "block";
    saveState();
  });

  // Handle key events for templateTags to treat ", " as a single unit
  elements.templateTags.addEventListener("keydown", (event) => {
    const cursorPos = elements.templateTags.selectionStart;
    const value = elements.templateTags.value;

    // Handle Backspace at the end of ", "
    if (event.key === "Backspace" && cursorPos > 0 && value[cursorPos - 1] === " " && value[cursorPos - 2] === ",") {
      event.preventDefault();
      elements.templateTags.value = value.slice(0, cursorPos - 2) + value.slice(cursorPos);
      elements.templateTags.selectionStart = elements.templateTags.selectionEnd = cursorPos - 2;
      storeLastState();
      saveState();
      return;
    }

    // Handle Delete at the start of ", "
    if (event.key === "Delete" && cursorPos < value.length && value[cursorPos] === "," && value[cursorPos + 1] === " ") {
      event.preventDefault();
      elements.templateTags.value = value.slice(0, cursorPos) + value.slice(cursorPos + 2);
      elements.templateTags.selectionStart = elements.templateTags.selectionEnd = cursorPos;
      storeLastState();
      saveState();
      return;
    }

    // Handle arrow keys to skip over ", "
    if (event.key === "ArrowLeft" && cursorPos > 1 && value[cursorPos - 1] === " " && value[cursorPos - 2] === ",") {
      event.preventDefault();
      elements.templateTags.selectionStart = elements.templateTags.selectionEnd = cursorPos - 2;
      return;
    }
    if (event.key === "ArrowRight" && cursorPos < value.length - 1 && value[cursorPos] === "," && value[cursorPos + 1] === " ") {
      event.preventDefault();
      elements.templateTags.selectionStart = elements.templateTags.selectionEnd = cursorPos + 2;
      return;
    }
  });

  // Snap cursor to start of ", " if placed between "," and " "
  elements.templateTags.addEventListener("click", () => {
    const cursorPos = elements.templateTags.selectionStart;
    const value = elements.templateTags.value;
    if (cursorPos > 0 && value[cursorPos] === " " && value[cursorPos - 1] === ",") {
      elements.templateTags.selectionStart = elements.templateTags.selectionEnd = cursorPos - 1;
    }
  });

  // Get target tab ID
  function getTargetTabId(callback) {
    const timeout = setTimeout(() => {
      showToast("Error: No response from tab. Please activate a supported webpage.");
      callback(null);
    }, 5000);
    chrome.runtime.sendMessage({ action: "getTargetTabId" }, (response) => {
      clearTimeout(timeout);
      if (response && response.tabId) {
        callback(response.tabId);
      } else {
        showToast("Error: No valid tab selected. Please activate a supported webpage.");
        callback(null);
      }
    });
  }

  // Load templates and suggestions
  function loadTemplates(filter, query = "", showDropdown = false) {
    chrome.storage.sync.get(["templates"], (result) => {
      console.log(result);
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
      } else {
        // Sort by recency when searchBox is empty
        filteredTemplates.sort((a, b) => {
          const aIndex = recentIndices.indexOf(a.index);
          const bIndex = recentIndices.indexOf(b.index);
          // Templates not in recentIndices go to the end
          if (aIndex === -1 && bIndex === -1) return a.name.localeCompare(b.name);
          if (aIndex === -1) return 1;
          if (bIndex === -1) return -1;
          return aIndex - bIndex; // Earlier index (more recent) comes first
        });
      }

      // Populate dropdown only if showDropdown is true
      if (showDropdown) {
        filteredTemplates.forEach((tmpl, idx) => {
          const div = document.createElement("div");
          div.textContent = tmpl.favorite ? `${tmpl.name} (${tmpl.tags})` : `${tmpl.name} (${tmpl.tags})`;
          div.setAttribute("role", "option");
          div.setAttribute("aria-selected", selectedTemplateName === tmpl.name);
          elements.overlay.style.display = 'block';
          elements.dropdownResults.style.display = 'block';
          div.addEventListener("click", (event) => {
            if (!event.target.classList.contains("favorite-toggle")) {
              selectedTemplateName = tmpl.name;
              elements.templateName.value = tmpl.name;
              elements.templateTags.value = tmpl.tags;
              elements.promptArea.value = tmpl.content;
              elements.searchBox.value = "";
              elements.dropdownResults.innerHTML = "";
              elements.fetchBtn2.style.display = tmpl.content ? "none" : "block";
              elements.overlay.style.display = 'none';
              elements.dropdownResults.style.display = 'none';
              saveState();
              elements.promptArea.focus();
            }
          });
          div.innerHTML += `<button class="favorite-toggle ${tmpl.favorite ? 'favorited' : 'unfavorited'}" data-name="${tmpl.name}" aria-label="${tmpl.favorite ? 'Unfavorite' : 'Favorite'} template">${tmpl.favorite ? '★' : '☆'}</button>`;
          elements.dropdownResults.appendChild(div);
        });
      }

      const favorites = templates.filter(tmpl => tmpl.favorite);
      if (favorites.length > 0) {
        // Sort favorites by recency
        favorites.sort((a, b) => {
          const aIndex = recentIndices.indexOf(a.index);
          const bIndex = recentIndices.indexOf(b.index);
          if (aIndex === -1 && bIndex === -1) return a.name.localeCompare(b.name);
          if (aIndex === -1) return 1;
          if (bIndex === -1) return -1;
          return aIndex - bIndex;
        });
        // elements.favoriteStar.classList.remove("d-none");
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
            elements.fetchBtn2.style.display = tmpl.content ? "none" : "block";
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
        // elements.favoriteStar.classList.add("d-none");
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
    if (!elements.searchBox.contains(event.target) && !elements.dropdownResults.contains(event.target) && !elements.themeToggle.contains(event.target) && !elements.typeSelect.contains(event.target)) {
      elements.dropdownResults.innerHTML = "";
      elements.overlay.style.display = 'none';
      elements.dropdownResults.style.display = 'none';
    }
  });

  // Save templates
  function saveTemplates(templates, callback, isNewTemplate = false) {
    // Validate individual template size
    const newOrUpdatedTemplate = isNewTemplate ? templates[templates.length - 1] : templates.find(t => t.name === elements.templateName.value);
    const validation = validateTemplateSize(newOrUpdatedTemplate);
    if (!validation.isValid) {
      showToast(`Error: Template size (${(validation.size / 1024).toFixed(2)} KB) exceeds 8 KB limit. Please reduce the size.`);
      return;
    }

    // Check total storage usage
    checkTotalStorageUsage(templates, (isStorageAvailable) => {
      if (!isStorageAvailable) {
        showToast("Error: Total storage limit (100KB) exceeded. Please delete unused templates.");
        return;
      }

      chrome.storage.sync.set({ templates }, () => {
        if (chrome.runtime.lastError) {
          showToast("Error: Failed to save template: " + chrome.runtime.lastError.message);
          console.error("Sync storage error:", chrome.runtime.lastError);
        } else {
          showToast(isNewTemplate ? "Success: Template saved. Press Ctrl+Z to undo." : "Success: Template updated. Press Ctrl+Z to undo.");
          callback();
        }
      });
    });
  }

  // Save changes to existing template or create new template
  elements.saveBtn.addEventListener("click", () => {
    chrome.storage.sync.get(["templates"], (result) => {
      let templates = result.templates || defaultTemplates.map((t, i) => ({ ...t, index: i }));
      const nameValidation = validateTemplateName(elements.templateName.value, templates);
      if (!nameValidation.isValid) {
        elements.templateName.focus();
        return;
      }
      const name = nameValidation.sanitizedName;
      const tagsInput = elements.templateTags.value;
      const tags = sanitizeTags(tagsInput);
      if (tags === null) {
        showToast("Warning: No tags provided. You can add tags in the tags field now or later.");
        elements.templateTags.focus();
        return;
      }
      const content = sanitizeContent(elements.promptArea.value);

      // Prevent saving with empty content
      if (!content.trim()) {
        showToast("Error: Prompt content is required to save a template.");
        elements.promptArea.focus();
        return;
      }

      // Notify if tags are empty
      if (!tagsInput.trim()) {
        showToast("Warning: No tags provided. You can add tags in the tags field now or later.");
        elements.templateTags.focus();
      }

      if (!elements.templateTags.value.trim()) {
        showToast("Warning: No tags provided. You can add tags in the tags field now or later.");
        elements.templateTags.focus();
      }

      // If no template is selected, treat as a new template
      if (!selectedTemplateName) {
        // Save new template
        storeLastState();
        lastState.templates = [...templates];
        const newTemplate = {
          name,
          tags,
          content,
          type: "custom",
          favorite: false,
          index: nextIndex
        };
        templates.push(newTemplate);
        updateRecentIndices(nextIndex);
        nextIndex++;
        saveTemplates(templates, () => {
          selectedTemplateName = name;
          loadTemplates(elements.typeSelect.value, "", false);
          saveState();
          saveNextIndex();
        }, true);
      } else {
        // Update existing template
        const template = templates.find(t => t.name === selectedTemplateName);
        if (!template) {
          showToast("Error: Selected template not found.");
          return;
        }
        const isEdited = elements.templateName.value !== template.name || sanitizeTags(elements.templateTags.value) !== template.tags || elements.promptArea.value !== template.content;
        if (!isEdited) {
          showToast("Info: No changes to save.");
          return;
        }
        storeLastState();
        lastState.templates = [...templates];

        const templateIndex = templates.findIndex(t => t.name === selectedTemplateName);
        templates[templateIndex] = {
          name,
          tags,
          content,
          type: "custom",
          favorite: template.favorite || false,
          index: template.index
        };

        saveTemplates(templates, () => {
          selectedTemplateName = name; // Update selectedTemplateName to new name
          loadTemplates(elements.typeSelect.value, "", false);
          saveState();
        });
      }
    });
  });

  // Save as new template
  elements.saveAsBtn.addEventListener("click", () => {
    chrome.storage.sync.get(["templates"], (result) => {
      const templates = result.templates || defaultTemplates.map((t, i) => ({ ...t, index: i }));
      const nameValidation = validateTemplateName(elements.templateName.value, templates, true);
      if (!nameValidation.isValid) {
        elements.templateName.focus();
        return;
      }
      const name = nameValidation.sanitizedName;
      const tagsInput = elements.templateTags.value;
      const tags = sanitizeTags(tagsInput);
      if (tags === null) {
        elements.templateTags.focus();
        return;
      }
      const content = sanitizeContent(elements.promptArea.value);

      // Prevent saving with empty content
      if (!content.trim()) {
        showToast("Error: Prompt content is required to save a template.");
        elements.promptArea.focus();
        return;
      }

      // Notify if tags are empty
      if (!tagsInput.trim()) {
        showToast("Warning: No tags provided. You can add tags in the tags field now or later.");
        elements.templateTags.focus();
      }

      saveNewTemplate(name, tags);
    });
  });

  // Helper function to save new template
  function saveNewTemplate(name, tags) {
    chrome.storage.sync.get(["templates"], (result) => {
      let templates = result.templates || defaultTemplates.map((t, i) => ({ ...t, index: i }));
      storeLastState();
      lastState.templates = [...templates];

      const newTemplate = {
        name,
        tags,
        content: sanitizeContent(elements.promptArea.value),
        type: "custom",
        favorite: false,
        index: nextIndex
      };

      templates.push(newTemplate);
      updateRecentIndices(nextIndex);
      nextIndex++;
      saveTemplates(templates, () => {
        selectedTemplateName = name;
        elements.templateName.value = name;
        loadTemplates(elements.typeSelect.value, "", false);
        saveState();
        saveNextIndex();
      }, true);
    });
  }

  // Fetch prompt from website
  elements.fetchBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      getTargetTabId((tabId) => {
        if (!tabId) {
          showToast("Error: No valid tab selected. Please activate a supported webpage.");
          return;
        }
        chrome.tabs.sendMessage(tabId, { action: "getPrompt" }, (response) => {
          if (chrome.runtime.lastError) {
            console.error("Fetch error:", chrome.runtime.lastError.message);
            showToast("Error: Failed to fetch prompt. Please refresh the page.");
            return;
          }
          if (response && response.prompt) {
            storeLastState();
            elements.promptArea.value = sanitizeContent(response.prompt);
            elements.fetchBtn2.style.display = "none";
            saveState();
          } else {
            showToast("Error: No input found on the page.");
          }
        });
      });
    });
  });

  // Send prompt to website and close popup
  elements.sendBtn.addEventListener("click", () => {
    getTargetTabId((tabId) => {
      if (!tabId) {
        showToast("Error: No valid tab selected. Please activate a supported webpage.");
        return;
      }
      chrome.tabs.sendMessage(tabId, {
        action: "sendPrompt",
        prompt: sanitizeContent(elements.promptArea.value)
      }, (response) => {
        if (chrome.runtime.lastError) {
          console.error("fleet error:", chrome.runtime.lastError.message);
          showToast("Error: Failed to send prompt. Please refresh the page.");
          return;
        }
        if (response && response.success) {
          // Update recent indices if a template is selected
          if (selectedTemplateName) {
            chrome.storage.sync.get(["templates"], (result) => {
              const templates = result.templates || defaultTemplates.map((t, i) => ({ ...t, index: i }));
              const template = templates.find(t => t.name === selectedTemplateName);
              if (template) {
                updateRecentIndices(template.index);
              }
              chrome.runtime.sendMessage({ action: "closePopup" });
            });
          } else {
            chrome.runtime.sendMessage({ action: "closePopup" });
          }
        } else {
          showToast("Error: Failed to send prompt. Please refresh the page.");
        }
      });
    });
  });

  // Delete selected template
  elements.deleteBtn.addEventListener("click", () => {
    if (!selectedTemplateName) {
      showToast("Error: Please select a template to delete.");
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
      const deletedIndex = templates[templateIndex].index;
      templates.splice(templateIndex, 1);
      // Remove deleted index from recentIndices
      recentIndices = recentIndices.filter(idx => idx !== deletedIndex);
      chrome.storage.sync.set({ templates }, () => {
        showToast("Template deleted successfully. Press Ctrl+Z to undo.");
        selectedTemplateName = null;
        elements.templateName.value = "";
        elements.templateTags.value = "";
        elements.promptArea.value = "";
        elements.searchBox.value = "";
        elements.fetchBtn2.style.display = "block";
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
      elements.fetchBtn2.style.display = elements.promptArea.value ? "none" : "block";
      showToast("Action undone successfully.");
      lastState = null;
      saveState();
    }
  });

  // Toggle favorite status
  document.addEventListener("click", (event) => {
    if (event.target.classList.contains("favorite-toggle")) {
      const name = event.target.dataset.name;
      chrome.storage.sync.get(["templates"], (result) => {
        const templates = result.templates || defaultTemplates.map((t, i) => ({ ...t, index: i }));
        const template = templates.find(t => t.name === name);
        if (template) {
          if (!template.favorite && templates.filter(t => t.favorite).length >= 10) {
            showToast("Error: Maximum of 10 favorite templates allowed.");
            return;
          }
          template.favorite = !template.favorite;
          chrome.storage.sync.set({ templates }, () => {
            loadTemplates(elements.typeSelect.value, elements.searchBox.value.toLowerCase(), true);
          });
        }
      });
    }
  });

/*   // Initialize tooltips
  const tooltipTriggerList = document.querySelectorAll('[data-bs-toggle="tooltip"]');
  tooltipTriggerList.forEach(tooltipTriggerEl => new bootstrap.Tooltip(tooltipTriggerEl, {
    delay: { show: 500, hide: 50 }
  })); */

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

  // Show the clear button only when the field contains text
  let timeout;
  document.addEventListener("mousemove", () => {
    clearTimeout(timeout);
    timeout = setTimeout(() => {
      elements.clearSearch.style.display = elements.searchBox.value ? "block" : "none";
      elements.clearPrompt.style.display = elements.promptArea.value ? "block" : "none";
    }, 50);
  });

});