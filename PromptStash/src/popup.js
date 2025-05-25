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

// Debounce specifically for toast-generating actions
const debounceToast = (func, wait) => {
  let lastCall = 0;
  return function (...args) {
    const now = Date.now();
    if (now - lastCall >= wait) {
      lastCall = now;
      func.apply(this, args);
    }
  };
};

// Toast message queue
let toastQueue = [];
let isToastShowing = false;
let autoHideTimeout = null; // Track the auto-hide timeout
let outsideClickListener = null; // Track the outside click listener
let currentOperationId = null; // Track the current operation
let nextToastTimeout = null; // Track the scheduled displayNextToast timeout

// Utility to toggle button disabled state
function toggleButtonState(button, disabled) {
  button.disabled = disabled;
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
    clearPrompt: document.getElementById("clearPrompt"),
    clearAllBtn: document.getElementById("clearAllBtn"),
    sendBtn: document.getElementById("sendBtn"),
    favoriteSuggestions: document.getElementById("favoriteSuggestions"),
    fullscreenToggle: document.getElementById("fullscreenToggle"),
    closeBtn: document.getElementById("closeBtn"),
    minimizeBtn: document.getElementById("minimizeBtn"),
    newBtn: document.getElementById("newBtn"),
    overlay: document.getElementById("overlay"),
    confirmationOverlay: document.getElementById("confirmationOverlay"),
    toast: document.getElementById("toast"),
    themeToggle: document.getElementById("themeToggle")
  };

  // Log missing elements
  const missingElements = Object.entries(elements)
    .filter(([key, value]) => !value)
    .map(([key]) => key);
  if (missingElements.length > 0) {
    console.error("Missing DOM elements:", missingElements);
    showToast("Error: Extension UI failed to load. Please reload the extension.", 3000, "red", [], "init");
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
  chrome.storage.local.get(["popupState", "theme", "extensionVersion", "recentIndices", "templates", "nextIndex"], (result) => {
    // Check if stored version matches current version
    const storedVersion = result.extensionVersion || "0.0.0";
    if (storedVersion !== EXTENSION_VERSION) {
      console.log(`Version updated from ${storedVersion} to ${EXTENSION_VERSION}. No schema migration needed.`);
      chrome.storage.local.set({ extensionVersion: EXTENSION_VERSION });
    }

    // Initialize state, falling back to defaults if not present
    const state = result.popupState || {};
    elements.templateName.value = state.name || "";
    elements.templateTags.value = state.tags || "";
    elements.promptArea.value = state.content || "";
    selectedTemplateName = state.selectedName || null;
    currentTheme = result.theme || "light";
    nextIndex = result.nextIndex || defaultTemplates.length;
    recentIndices = result.recentIndices || [];
    // Ensure templates are initialized
    const templates = result.templates || defaultTemplates.map((t, i) => ({ ...t, index: i }));

    // Save templates if they were initialized from defaults
    if (!result.templates) {
      chrome.storage.local.set({ templates });
    }

    document.body.className = currentTheme;
    elements.fetchBtn2.style.display = elements.promptArea.value ? "none" : "block";
    loadTemplates(elements.typeSelect.value, "", false);
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
    chrome.storage.local.set(state);
  }

  // Save nextIndex to local storage
  function saveNextIndex() {
    chrome.storage.local.set({ nextIndex });
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

  // Show toast notification with operation-based queueing
  function showToast(message, duration = 4000, type = "red", buttons = [], operationId) {
    console.log("Queueing toast:", { message, duration, type, hasButtons: buttons.length > 0, operationId });
    // Check for duplicate confirmation toasts
    if (buttons.length > 0) {
      const duplicateIndex = toastQueue.findIndex(toast => toast.message === message && toast.buttons.length > 0);
      if (duplicateIndex !== -1) {
        console.log("Duplicate confirmation toast found, skipping");
        return;
      }
    }
    // If new operation, close current toast, clear queue, and update operationId
    if (operationId !== currentOperationId) {
      if (isToastShowing) {
        console.log(`New operation ${operationId}, closing current toast and clearing queue`);
        // If the current toast is a confirmation toast, execute the "No" callback to re-enable buttons
        const currentToast = elements.toast.className.includes("confirmation") ? toastQueue[0] || { buttons: [] } : { buttons: [] };
        const noButtonCallback = currentToast.buttons.find(b => b.text === "No")?.callback;
        closeToast(noButtonCallback);
      }
      toastQueue = [];
      currentOperationId = operationId;
    }
    // Only queue toasts from the current operation
    if (operationId === currentOperationId) {
      toastQueue.push({ message, duration, type, buttons, operationId });
      if (!isToastShowing) {
        displayNextToast();
      }
    } else {
      console.log(`Toast for operation ${operationId} ignored, current operation is ${currentOperationId}`);
    }
  }

  // Close toast function
  function closeToast(onClose) {
    console.log("Closing toast, clearing autoHideTimeout");
    clearTimeout(autoHideTimeout);
    autoHideTimeout = null;
    // Clear any scheduled displayNextToast to prevent race conditions
    clearTimeout(nextToastTimeout);
    if (outsideClickListener) {
      document.removeEventListener("click", outsideClickListener);
      outsideClickListener = null;
      console.log("Outside click listener removed in closeToast");
    }
    elements.toast.classList.remove("show");
    elements.toast.classList.add("hide");
    elements.confirmationOverlay.style.display = "none";
    setTimeout(() => {
      elements.toast.classList.remove("hide");
      elements.toast.innerHTML = "";
      isToastShowing = false;
      console.log("Toast closed, executing callback:", !!onClose);
      if (onClose) onClose();
      // Schedule displayNextToast after animation completes
      nextToastTimeout = setTimeout(displayNextToast, 350);
    }, 300);
  }

  // Display the next toast in the queue
  function displayNextToast() {
    if (toastQueue.length === 0) {
      isToastShowing = false;
      console.log("No toasts in queue, stopping display");
      return;
    }
    // Clear any existing autoHideTimeout
    clearTimeout(autoHideTimeout);
    autoHideTimeout = null;
    isToastShowing = true;
    const { message, duration, type, buttons, operationId } = toastQueue.shift(); // Remove the toast from the queue
    console.log("Displaying toast:", { message, duration, type, hasButtons: buttons.length > 0, operationId });
    elements.toast.innerHTML = message;

    // Add close button
    const closeBtn = document.createElement("button");
    closeBtn.textContent = "×";
    closeBtn.className = "toast-close-btn";
    closeBtn.setAttribute("aria-label", "Close toast");
    closeBtn.addEventListener("click", (event) => {
      event.stopPropagation(); // Prevent the click from propagating to the overlay
      console.log("Close button clicked");
      if (outsideClickListener) {
        document.removeEventListener("click", outsideClickListener);
        outsideClickListener = null;
        console.log("Outside click listener removed on close button click");
      }
      const noButton = buttons.find(b => b.text === "No");
      closeToast(noButton?.callback);
    });
    elements.toast.appendChild(closeBtn);

    // Add confirmation buttons if provided
    if (buttons.length > 0) {
      const buttonContainer = document.createElement("div");
      buttonContainer.className = "toast-button-container";
      buttons.forEach(({ text, callback }) => {
        const btn = document.createElement("button");
        btn.textContent = text;
        btn.className = "toast-action-btn";
        btn.setAttribute("aria-label", text === "Yes" ? "Confirm action" : "Cancel action");
        btn.addEventListener("click", (event) => {
          event.stopPropagation(); // Prevent the click from propagating to the overlay
          console.log(`Confirmation button clicked: ${text}`);
          if (outsideClickListener) {
            document.removeEventListener("click", outsideClickListener);
            outsideClickListener = null;
            console.log("Outside click listener removed on confirmation button click");
          }
          closeToast(callback);
        });
        buttonContainer.appendChild(btn);
      });
      elements.toast.appendChild(buttonContainer);

      elements.confirmationOverlay.style.display = "block";

      // Handle outside click to cancel confirmation toasts
      outsideClickListener = (event) => {
        if (!elements.toast.contains(event.target)) {
          console.log("Outside click detected");
          const noButton = buttons.find(b => b.text === "No");
          closeToast(() => {
            if (noButton && noButton.callback) {
              noButton.callback();
            }
          });
        }
      };
      setTimeout(() => {
        console.log("Attaching outside click listener");
        document.addEventListener("click", outsideClickListener);
      }, 50);

    } else {
      // Auto-hide only for non-confirmation toasts
      console.log(`Setting auto-hide timeout for ${duration}ms`);
      autoHideTimeout = setTimeout(() => {
        console.log("Auto-hide timeout triggered");
        closeToast();
      }, duration);
    }

    elements.toast.className = `toast ${type} ${buttons.length > 0 ? 'confirmation' : ''}`;
    elements.toast.classList.add("show");
  }

  // Validate template name
  function validateTemplateName(name, templates, isSaveAs = false) {
    const trimmedName = name.trim();
    if (!trimmedName) {
      showToast("Template name is required.", 3000, "red", [], "save");
      return { isValid: false, sanitizedName: null };
    }
    if (trimmedName.length > 50) {
      showToast("Template name must be 50 characters or less.", 3000, "red", [], "save");
      return { isValid: false, sanitizedName: null };
    }
    const sanitizedName = trimmedName.replace(/[^a-zA-Z0-9\s]/g, "");
    if (sanitizedName !== trimmedName) {
      showToast("Template name can only contain letters, numbers, and spaces.", 3000, "red", [], "save");
      return { isValid: false, sanitizedName: null };
    }
    const isDuplicate = templates.some(t => t.name === sanitizedName && (isSaveAs || t.name !== selectedTemplateName));
    if (isDuplicate) {
      showToast("Template name must be unique.", 3000, "red", [], "save");
      return { isValid: false, sanitizedName: null };
    }
    return { isValid: true, sanitizedName };
  }

  // Validate and sanitize tags
  function sanitizeTags(input) {
    if (!input) return "";
    const tags = input.split(",").map(tag => tag.trim()).filter(tag => tag);
    if (tags.length > 5) {
      showToast("Maximum of 5 tags allowed per template.", 3000, "red", [], "save");
      return null;
    }
    const sanitizedTags = tags.map(tag => tag.replace(/[^a-zA-Z0-9]/g, "").slice(0, 20));
    if (sanitizedTags.some(tag => tag.length === 0)) {
      showToast("Each tag must contain only letters or numbers and be 20 characters or less.", 3000, "red", [], "save");
      return null;
    }
    return sanitizedTags.join(", ");
  }

  // Sanitize content to prevent XSS
  function sanitizeContent(content) {
    if (!content) return "";
    const div = document.createElement("div");
    div.textContent = content;
    return div.innerHTML.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "");
  }

  // Check total storage usage
  function checkTotalStorageUsage(callback) {
    chrome.storage.local.get(null, (items) => {
      const serialized = JSON.stringify(items);
      const totalSizeInBytes = new TextEncoder().encode(serialized).length;
      const maxTotalSize = 5 * 1024 * 1024; // 5MB for local storage
      if (totalSizeInBytes > 0.9 * maxTotalSize) {
        showToast("Warning: Storage is nearly full (90% of 5MB limit). Please delete unused templates.", 5000, "red", [], "save");
      }
      callback();
    });
  }

  // Update recent indices
  function updateRecentIndices(index) {
    recentIndices.unshift(index);
    recentIndices = [...new Set(recentIndices)];
    if (recentIndices.length > 10) {
      recentIndices = recentIndices.slice(0, 10);
    }
    chrome.storage.local.set({ recentIndices }, () => {
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
      const baseFontSize = Math.min(Math.max(width / 20, 14), 24);
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
      showToast("Template name can only contain letters, numbers, and spaces.", 3000, "red", [], "input");
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
        showToast("Maximum of 5 tags allowed per template.", 3000, "red", [], "input");
        tags.length = 5;
      }
      value = tags.join(", ");
      elements.templateTags.value = value;
    }
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

  // New template button
  const debouncedShowToastNew = debounceToast((message, duration, type) => {
    showToast(message, duration, type, [], "new");
  }, 2000);

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
    debouncedShowToastNew("New template created.", 3000, "green");
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
  const debouncedShowToastClearAll = debounceToast((message, duration, type) => {
    showToast(message, duration, type, [], "clearAll");
  }, 2000);

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
    debouncedShowToastClearAll("All fields cleared.", 3000, "green");
  });

  // Handle ESC key for popup and confirmation toasts
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      if (isToastShowing && elements.toast.className.includes("confirmation") && cancelToast()) {
        // Close confirmation toast with "No" callback
        const noButton = toastQueue[0].buttons.find(b => b.text === "No");
        closeToast(noButton?.callback);
      } else {
        // Close popup
        chrome.runtime.sendMessage({ action: "closePopup" });
      }
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

  // Handle key events for templateTags
  elements.templateTags.addEventListener("keydown", (event) => {
    const cursorPos = elements.templateTags.selectionStart;
    const value = elements.templateTags.value;

    if (event.key === "Backspace" && cursorPos > 0 && value[cursorPos - 1] === " " && value[cursorPos - 2] === ",") {
      event.preventDefault();
      elements.templateTags.value = value.slice(0, cursorPos - 2) + value.slice(cursorPos);
      elements.templateTags.selectionStart = elements.templateTags.selectionEnd = cursorPos - 2;
      storeLastState();
      saveState();
      return;
    }

    if (event.key === "Delete" && cursorPos < value.length && value[cursorPos] === "," && value[cursorPos + 1] === " ") {
      event.preventDefault();
      elements.templateTags.value = value.slice(0, cursorPos) + value.slice(cursorPos + 2);
      elements.templateTags.selectionStart = elements.templateTags.selectionEnd = cursorPos;
      storeLastState();
      saveState();
      return;
    }

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

  // Snap cursor to start of ", "
  elements.templateTags.addEventListener("click", () => {
    const cursorPos = elements.templateTags.selectionStart;
    const value = elements.templateTags.value;
    if (cursorPos > 0 && value[cursorPos] === " " && value[cursorPos - 1] === ",") {
      elements.templateTags.selectionStart = elements.templateTags.selectionEnd = cursorPos - 1;
    }
  });

  // Get target tab ID with timeout
  function getTargetTabId(callback) {
    const timeout = setTimeout(() => {
      showToast("Error: No response from tab. Please activate a supported webpage.", 3000, "red", [], "fetch");
      callback(null);
    }, 5000);
    chrome.runtime.sendMessage({ action: "getTargetTabId" }, (response) => {
      clearTimeout(timeout);
      if (response && response.tabId) {
        callback(response.tabId);
      } else {
        showToast("Error: No valid tab selected. Please activate a supported webpage.", 3000, "red", [], "fetch");
        callback(null);
      }
    });
  }

  // Load templates and suggestions
  function loadTemplates(filter, query = "", showDropdown = false) {
    chrome.storage.local.get(["templates"], (result) => {
      console.log(result);
      let templates = result.templates || defaultTemplates.map((t, i) => ({ ...t, index: i }));
      elements.dropdownResults.innerHTML = "";
      elements.favoriteSuggestions.innerHTML = "";

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
        filteredTemplates.sort((a, b) => {
          const aIndex = recentIndices.indexOf(a.index);
          const bIndex = recentIndices.indexOf(b.index);
          if (aIndex === -1 && bIndex === -1) return a.name.localeCompare(b.name);
          if (aIndex === -1) return 1;
          if (bIndex === -1) return -1;
          return aIndex - bIndex;
        });
      }

      if (showDropdown) {
        filteredTemplates.forEach((tmpl, idx) => {
          const div = document.createElement("div");
          div.textContent = tmpl.favorite ? `${tmpl.name} (${tmpl.tags})` : `${tmpl.name} (${tmpl.tags})`;
          div.setAttribute("role", "option");
          div.setAttribute("aria-selected", selectedTemplateName === tmpl.name);
          elements.overlay.style.display = 'block';
          elements.dropdownResults.style.display = 'block';
          elements.dropdownResults.classList.add("show");
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
              elements.dropdownResults.classList.remove("show");
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
        favorites.sort((a, b) => {
          const aIndex = recentIndices.indexOf(a.index);
          const bIndex = recentIndices.indexOf(b.index);
          if (aIndex === -1 && bIndex === -1) return a.name.localeCompare(b.name);
          if (aIndex === -1) return 1;
          if (bIndex === -1) return -1;
          return aIndex - bIndex;
        });
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
      elements.dropdownResults.classList.remove("show");
    }
  });

  // Save templates with 5-second timeout
  function saveTemplates(templates, callback, isNewTemplate = false, button) {
    checkTotalStorageUsage(() => {
      const timeout = setTimeout(() => {
        toggleButtonState(button, false);
        showToast("Operation timed out. Please try again.", 3000, "red", [], "save");
      }, 5000);
      chrome.storage.local.set({ templates }, () => {
        clearTimeout(timeout);
        if (chrome.runtime.lastError) {
          const errorMessage = chrome.runtime.lastError.message;
          if (errorMessage.includes("QUOTA_BYTES_PER_ITEM")) {
            showToast("Template size exceeds 8KB limit. Please reduce the size.", 3000, "red", [], "save");
          } else if (errorMessage.includes("QUOTA_BYTES")) {
            showToast("Total storage limit (5MB) exceeded. Please delete unused templates.", 3000, "red", [], "save");
          } else {
            showToast("Failed to save template: " + errorMessage, 3000, "red", [], "save");
          }
          console.error("Local storage error:", errorMessage);
        } else {
          showToast(isNewTemplate ? "Template saved. Press Ctrl+Z to undo." : "Template updated. Press Ctrl+Z to undo.", 3000, "green", [], "save");
          callback();
        }
        toggleButtonState(button, false);
      });
    });
  }

  // Save changes to existing template or create new template
  elements.saveBtn.addEventListener("click", () => {
    toggleButtonState(elements.saveBtn, true);
    chrome.storage.local.get(["templates"], (result) => {
      let templates = result.templates || defaultTemplates.map((t, i) => ({ ...t, index: i }));
      const nameValidation = validateTemplateName(elements.templateName.value, templates);
      if (!nameValidation.isValid) {
        elements.templateName.focus();
        toggleButtonState(elements.saveBtn, false);
        return;
      }
      const name = nameValidation.sanitizedName;
      const tagsInput = elements.templateTags.value;
      const tags = sanitizeTags(tagsInput);
      if (tags === null) {
        elements.templateTags.focus();
        toggleButtonState(elements.saveBtn, false);
        return;
      }
      const content = sanitizeContent(elements.promptArea.value);

      if (!content.trim()) {
        showToast("Prompt content is required to save a template.", 3000, "red", [], "save");
        elements.promptArea.focus();
        toggleButtonState(elements.saveBtn, false);
        return;
      }

      if (!tagsInput.trim()) {
        elements.toast.focus();
        showToast(
          "No tags provided. Save without tags?",
          0,
          "red",
          [
            {
              text: "Yes",
              callback: () => {
                if (!selectedTemplateName) {
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
                  }, true, elements.saveBtn);
                } else {
                  const template = templates.find(t => t.name === selectedTemplateName);
                  if (!template) {
                    showToast("Selected template not found.", 3000, "red", [], "save");
                    toggleButtonState(elements.saveBtn, false);
                    return;
                  }
                  const isEdited = elements.templateName.value !== template.name || sanitizeTags(elements.templateTags.value) !== template.tags || elements.promptArea.value !== template.content;
                  if (!isEdited) {
                    showToast("No changes to save.", 3000, "red", [], "save");
                    toggleButtonState(elements.saveBtn, false);
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
                    selectedTemplateName = name;
                    loadTemplates(elements.typeSelect.value, "", false);
                    saveState();
                  }, false, elements.saveBtn);
                }
              }
            },
            {
              text: "No",
              callback: () => {
                elements.templateTags.focus();
                toggleButtonState(elements.saveBtn, false);
              }
            }
          ],
          "save"
        );
        return;
      }

      if (!selectedTemplateName) {
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
        }, true, elements.saveBtn);
      } else {
        const template = templates.find(t => t.name === selectedTemplateName);
        if (!template) {
          showToast("Selected template not found.", 3000, "red", [], "save");
          toggleButtonState(elements.saveBtn, false);
          return;
        }
        const isEdited = elements.templateName.value !== template.name || sanitizeTags(elements.templateTags.value) !== template.tags || elements.promptArea.value !== template.content;
        if (!isEdited) {
          showToast("No changes to save.", 3000, "red", [], "save");
          toggleButtonState(elements.saveBtn, false);
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
          selectedTemplateName = name;
          loadTemplates(elements.typeSelect.value, "", false);
          saveState();
        }, false, elements.saveBtn);
      }
    });
  });

  // Save as new template
  elements.saveAsBtn.addEventListener("click", () => {
    toggleButtonState(elements.saveAsBtn, true);
    chrome.storage.local.get(["templates"], (result) => {
      const templates = result.templates || defaultTemplates.map((t, i) => ({ ...t, index: i }));
      const nameValidation = validateTemplateName(elements.templateName.value, templates, true);
      if (!nameValidation.isValid) {
        elements.templateName.focus();
        toggleButtonState(elements.saveAsBtn, false);
        return;
      }
      const name = nameValidation.sanitizedName;
      const tagsInput = elements.templateTags.value;
      const tags = sanitizeTags(tagsInput);
      if (tags === null) {
        elements.templateTags.focus();
        toggleButtonState(elements.saveAsBtn, false);
        return;
      }
      const content = sanitizeContent(elements.promptArea.value);

      if (!content.trim()) {
        showToast("Prompt content is required to save a template.", 3000, "red", [], "saveAs");
        elements.promptArea.focus();
        toggleButtonState(elements.saveAsBtn, false);
        return;
      }

      if (!tagsInput.trim()) {
        elements.toast.focus();
        showToast(
          "No tags provided. Save without tags?",
          0,
          "red",
          [
            {
              text: "Yes",
              callback: () => {
                saveNewTemplate(name, tags, elements.saveAsBtn);
              }
            },
            {
              text: "No",
              callback: () => {
                elements.templateTags.focus();
                toggleButtonState(elements.saveAsBtn, false);
              }
            }
          ],
          "saveAs"
        );
        return;
      }

      saveNewTemplate(name, tags, elements.saveAsBtn);
    });
  });

  // Helper function to save new template
  function saveNewTemplate(name, tags, button) {
    chrome.storage.local.get(["templates"], (result) => {
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
      }, true, button);
    });
  }

  // Fetch prompt from website
  elements.fetchBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      toggleButtonState(btn, true);
      const timeout = setTimeout(() => {
        toggleButtonState(btn, false);
        showToast("Fetch operation timed out. Please try again.", 3000, "red", [], "fetch");
      }, 5000);
      getTargetTabId((tabId) => {
        if (!tabId) {
          clearTimeout(timeout);
          showToast("Error: No valid tab selected. Please activate a supported webpage.", 3000, "red", [], "fetch");
          toggleButtonState(btn, false);
          return;
        }
        chrome.tabs.sendMessage(tabId, { action: "getPrompt" }, (response) => {
          clearTimeout(timeout);
          if (chrome.runtime.lastError) {
            console.error("Fetch error:", chrome.runtime.lastError.message);
            showToast("Failed to fetch prompt. Please refresh the page.", 3000, "red", [], "fetch");
            toggleButtonState(btn, false);
            return;
          }
          if (response && response.prompt) {
            storeLastState();
            elements.promptArea.value = sanitizeContent(response.prompt);
            elements.fetchBtn2.style.display = "none";
            saveState();
          } else {
            showToast("No input found on the page.", 3000, "red", [], "fetch");
          }
          toggleButtonState(btn, false);
        });
      });
    });
  });

  // Send prompt to website and close popup
  elements.sendBtn.addEventListener("click", () => {
    toggleButtonState(elements.sendBtn, true);
    const timeout = setTimeout(() => {
      toggleButtonState(elements.sendBtn, false);
      showToast("Send operation timed out. Please try again.", 3000, "red", [], "send");
    }, 5000);
    getTargetTabId((tabId) => {
      if (!tabId) {
        clearTimeout(timeout);
        showToast("Error: No valid tab selected. Please activate a supported webpage.", 3000, "red", [], "send");
        toggleButtonState(elements.sendBtn, false);
        return;
      }
      chrome.tabs.sendMessage(tabId, {
        action: "sendPrompt",
        prompt: sanitizeContent(elements.promptArea.value)
      }, (response) => {
        clearTimeout(timeout);
        if (chrome.runtime.lastError) {
          console.error("Send error:", chrome.runtime.lastError.message);
          showToast("Failed to send prompt. Please refresh the page.", 3000, "red", [], "send");
          toggleButtonState(elements.sendBtn, false);
          return;
        }
        if (response && response.success) {
          if (selectedTemplateName) {
            chrome.storage.local.get(["templates"], (result) => {
              const templates = result.templates || defaultTemplates.map((t, i) => ({ ...t, index: i }));
              const template = templates.find(t => t.name === selectedTemplateName);
              if (template) {
                updateRecentIndices(template.index);
              }
              chrome.runtime.sendMessage({ action: "closePopup" });
              toggleButtonState(elements.sendBtn, false);
            });
          } else {
            chrome.runtime.sendMessage({ action: "closePopup" });
            toggleButtonState(elements.sendBtn, false);
          }
        } else {
          showToast("Failed to send prompt. Please refresh the page.", 3000, "red", [], "send");
          toggleButtonState(elements.sendBtn, false);
        }
      });
    });
  });

  // Delete selected template
  elements.deleteBtn.addEventListener("click", () => {
    toggleButtonState(elements.deleteBtn, true);
    if (!selectedTemplateName) {
      showToast("Please select a template to delete.", 3000, "red", [], "delete");
      toggleButtonState(elements.deleteBtn, false);
      return;
    }
    chrome.storage.local.get(["templates", "recentIndices"], (result) => {
      const templates = result.templates || defaultTemplates.map((t, i) => ({ ...t, index: i }));
      const template = templates.find(t => t.name === selectedTemplateName);
      const isPreBuilt = template.type === "pre-built";
      const message = `Are you sure you want to delete "${selectedTemplateName}"?${isPreBuilt ? "<br>This is a pre-built template." : ""}`;
      showToast(
        message,
        0,
        "red",
        [
          {
            text: "Yes",
            callback: () => {
              storeLastState();
              lastState.templates = [...templates];
              const templateIndex = templates.findIndex(t => t.name === selectedTemplateName);
              const deletedIndex = templates[templateIndex].index;
              templates.splice(templateIndex, 1);
              recentIndices = recentIndices.filter(idx => idx !== deletedIndex);
              const timeout = setTimeout(() => {
                toggleButtonState(elements.deleteBtn, false);
                showToast("Delete operation timed out. Please try again.", 3000, "red", [], "delete");
              }, 5000);
              chrome.storage.local.set({ templates, recentIndices }, () => {
                clearTimeout(timeout);
                if (chrome.runtime.lastError) {
                  showToast("Failed to delete template: " + chrome.runtime.lastError.message, 3000, "red", [], "delete");
                } else {
                  showToast("Template deleted successfully. Press Ctrl+Z to undo.", 3000, "green", [], "delete");
                  selectedTemplateName = null;
                  elements.templateName.value = "";
                  elements.templateTags.value = "";
                  elements.promptArea.value = "";
                  elements.searchBox.value = "";
                  elements.fetchBtn2.style.display = "block";
                  loadTemplates(elements.typeSelect.value, "", false);
                  saveState();
                }
                toggleButtonState(elements.deleteBtn, false);
              });
            }
          },
          {
            text: "No",
            callback: () => {
              toggleButtonState(elements.deleteBtn, false);
            }
          }
        ],
        "delete"
      );
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
        chrome.storage.local.set({ templates: lastState.templates }, () => {
          loadTemplates(elements.typeSelect.value, "", false);
        });
      }
      elements.fetchBtn2.style.display = elements.promptArea.value ? "none" : "block";
      showToast("Action undone successfully.", 3000, "green", [], "undo");
      lastState = null;
      saveState();
    }
  });

  // Toggle favorite status
  document.addEventListener("click", (event) => {
    if (event.target.classList.contains("favorite-toggle")) {
      const name = event.target.dataset.name;
      chrome.storage.local.get(["templates"], (result) => {
        const templates = result.templates || defaultTemplates.map((t, i) => ({ ...t, index: i }));
        const template = templates.find(t => t.name === name);
        if (template) {
          if (!template.favorite && templates.filter(t => t.favorite).length >= 10) {
            showToast("Maximum of 10 favorite templates allowed.", 3000, "red", [], "favorite");
            return;
          }
          template.favorite = !template.favorite;
          chrome.storage.local.set({ templates }, () => {
            loadTemplates(elements.typeSelect.value, elements.searchBox.value.toLowerCase(), true);
          });
        }
      });
    }
  });

  // Initialize tooltips
  const tooltipTriggerList = document.querySelectorAll('[data-bs-toggle="tooltip"]');
  tooltipTriggerList.forEach(tooltipTriggerEl => new bootstrap.Tooltip(tooltipTriggerEl, {
    delay: { show: 500, hide: 50 }
  }));

  // Keyboard navigation for dropdown
  elements.dropdownResults.addEventListener("keydown", (event) => {
    const items = elements.dropdownResults.querySelectorAll("div");
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