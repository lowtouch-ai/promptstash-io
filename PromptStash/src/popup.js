// Import default templates
import defaultTemplates from './defaultTemplates.mjs';

// Extension version for schema validation
const EXTENSION_VERSION = "1.1.0";                                  // UPDATE THIS WHEN RELEASING A NEW UPDATE

// Lightweight debounce function
function debounce(func, wait) {
  let timeout;
  return function (...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), wait);
  };
}

// Toast message queue and timestamp tracking
let toastQueue = [];
let isToastShowing = false;
let autoHideTimeout = null; // Track the auto-hide timeout
let outsideClickListener = null; // Track the outside click listener
let currentOperationId = null; // Track the current operation
let nextToastTimeout = null; // Track the scheduled displayNextToast timeout
const toastTimestamps = {}; // Track last display time for each toast (message + operationId)
let overrideAnimation = false; // Flag to skip animation delay for overriding toasts

// Initialize DOM elements
document.addEventListener("DOMContentLoaded", () => {
  // DOM elements
  const elements = {
    searchBox: document.getElementById("searchBox"),
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
    newBtn: document.getElementById("newBtn"),
    searchOverlay: document.getElementById("searchOverlay"),
    toastOverlay: document.getElementById("toastOverlay"),
    toast: document.getElementById("toast"),
    themeToggle: document.getElementById("themeToggle")
  };

  // Log missing elements
  const missingElements = Object.entries(elements)
    .filter(([key, value]) => !value)
    .map(([key]) => key);
  if (missingElements.length > 0) {
    // console.error("Missing DOM elements:", missingElements);
    showToast("Error: Extension UI failed to load. Please reload the extension.", 3000, "red", [], "init");
  // } else {
  //   console.log("All DOM elements found:", Object.keys(elements));
  }

  let selectedTemplateName = null;
  let currentTheme = "light";
  let lastState = null;
  let nextIndex = 0;
  let isFullscreen = false;
  let recentIndices = [];

  // Load popup state, recent indices, and initialize index with version check
  chrome.storage.local.get(["popupState", "theme", "extensionVersion", "recentIndices", "templates", "nextIndex", "isFullscreen"], (result) => {
    // Check if stored version matches current version
    const storedVersion = result.extensionVersion || "0.0.0";
    if (storedVersion !== EXTENSION_VERSION) {
      // console.log(`Version updated from ${storedVersion} to ${EXTENSION_VERSION}. No schema migration needed.`);
      chrome.storage.local.set({ extensionVersion: EXTENSION_VERSION });
    }

    // Initialize state, falling back to defaults if not present
    const state = result.popupState || {};
    const defaultText = `# Your Role
* 

# Background Information
* 

# Your Task
* `;
    elements.templateName.value = state.name || "";
    elements.templateTags.value = state.tags || "";
    elements.promptArea.value = state.content || defaultText;
    // console.log("state.content =", state.content)
    selectedTemplateName = state.selectedName || null;
    currentTheme = result.theme || "light";
    nextIndex = result.nextIndex || defaultTemplates.length;
    recentIndices = result.recentIndices || [];
    isFullscreen = result.isFullscreen || false;
    let svg = elements.fullscreenToggle.querySelector("svg use");
    svg.setAttribute("href", isFullscreen ? "sprite.svg#compress" : "sprite.svg#fullscreen");
    

    // Ensure templates are initialized
    const templates = result.templates || defaultTemplates.map((t, i) => ({ ...t, index: i }));

    // Save templates if they were initialized from defaults
    if (!result.templates) {
      chrome.storage.local.set({ templates });
    }

    document.body.className = currentTheme;
    elements.fetchBtn2.style.display = elements.promptArea.value ? "none" : "block";
    elements.clearPrompt.style.display = elements.promptArea.value ? "block" : "none";
    loadTemplates();
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

  // Show toast notification with operation-based queueing and duplicate debouncing
  function showToast(message, duration = 4000, type = "red", buttons = [], operationId) {
    // console.log("Queueing toast:", { message, duration, type, hasButtons: buttons.length > 0, operationId });
    
    // Create a unique key for the toast based on message and operationId
    const toastKey = `${message}|${operationId}`;
    const now = Date.now();
    
    // Debounce duplicate non-confirmation toasts (ignore within 1 seconds)
    if (buttons.length === 0 && toastTimestamps[toastKey] && now - toastTimestamps[toastKey] < 1010) {
      // console.log(`Duplicate toast debounced for key: ${toastKey}`);
      return;
    }
    
    // Update timestamp for this toast
    toastTimestamps[toastKey] = now;
    
    // Clean up old timestamps to prevent memory leak
    Object.keys(toastTimestamps).forEach(key => {
      if (now - toastTimestamps[key] > 7000) {
        delete toastTimestamps[key];
      }
    });
    
    // Check for duplicate confirmation toasts
    if (buttons.length > 0) {
      const duplicateIndex = toastQueue.findIndex(toast => toast.message === message && toast.buttons.length > 0);
      if (duplicateIndex !== -1) {
        // console.log("Duplicate confirmation toast found, skipping");
        return;
      }
    }
    
    // If new operation, close current toast, clear queue, and update operationId
    if (operationId !== currentOperationId) {
      if (isToastShowing) {
        // console.log(`New operation ${operationId}, closing current toast and clearing queue`);
        overrideAnimation = true; // Flag to skip animation delay
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
      // console.log(`Toast for operation ${operationId} ignored, current operation is ${currentOperationId}`);
    }
  }

  // Close toast function
  function closeToast(onClose) {
    // console.log("Closing toast, clearing autoHideTimeout");
    clearTimeout(autoHideTimeout);
    autoHideTimeout = null;
    // Clear any scheduled displayNextToast to prevent race conditions
    clearTimeout(nextToastTimeout);
    if (outsideClickListener) {
      document.removeEventListener("click", outsideClickListener);
      outsideClickListener = null;
      // console.log("Outside click listener removed in closeToast");
    }
    elements.toast.classList.remove("show");
    elements.toast.classList.add("hide");
    elements.toastOverlay.style.display = "none";
    setTimeout(() => {
      elements.toast.classList.remove("hide");
      elements.toast.innerHTML = "";
      isToastShowing = false;
      // console.log("Toast closed, executing callback:", !!onClose);
      if (onClose) onClose();
      // Schedule displayNextToast immediately if overriding, else after animation
      if (overrideAnimation) {
        overrideAnimation = false; // Reset flag
        displayNextToast();
      } else {
        nextToastTimeout = setTimeout(displayNextToast, 10);
      }
    }, 10);
  }

  // Display the next toast in the queue
  function displayNextToast() {
    if (toastQueue.length === 0) {
      isToastShowing = false;
      // console.log("No toasts in queue, stopping display");
      return;
    }
    // Clear any existing autoHideTimeout
    clearTimeout(autoHideTimeout);
    autoHideTimeout = null;
    isToastShowing = true;
    const { message, duration, type, buttons, operationId } = toastQueue.shift(); // Remove the toast from the queue
    // console.log("Displaying toast:", { message, duration, type, hasButtons: buttons.length > 0, operationId });
    elements.toast.innerHTML = message;

    // Add close button
    const closeBtn = document.createElement("button");
    closeBtn.textContent = "×";
    closeBtn.className = "toast-close-btn";
    closeBtn.setAttribute("aria-label", "Close toast");
    closeBtn.addEventListener("click", (event) => {
      event.stopPropagation(); // Prevent the click from propagating to the overlay
      // console.log("Close button clicked");
      if (outsideClickListener) {
        document.removeEventListener("click", outsideClickListener);
        outsideClickListener = null;
        // console.log("Outside click listener removed on close button click");
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
          // console.log(`Confirmation button clicked: ${text}`);
          if (outsideClickListener) {
            document.removeEventListener("click", outsideClickListener);
            outsideClickListener = null;
            // console.log("Outside click listener removed on confirmation button click");
          }
          closeToast(callback);
        });
        buttonContainer.appendChild(btn);
      });
      elements.toast.appendChild(buttonContainer);

      elements.toastOverlay.style.display = "block";
      
      // Focus on the "Yes" button after buttons are added
      const yesButton = elements.toast.querySelector(".toast-action-btn[aria-label='Confirm action']");
      setTimeout(() => {
        if (yesButton) {
          yesButton.focus();
        }
      }, 0)
      
      // Handle outside click to cancel confirmation toasts
      outsideClickListener = (event) => {
        if (!elements.toast.contains(event.target)) {
          // console.log("Outside click detected");
          const noButton = buttons.find(b => b.text === "No");
          closeToast(() => {
            if (noButton && noButton.callback) {
              noButton.callback();
            }
          });
        }
      };
      setTimeout(() => {
        // console.log("Attaching outside click listener");
        document.addEventListener("click", outsideClickListener);
      }, 50);

    } else {
      // Auto-hide only for non-confirmation toasts
      // console.log(`Setting auto-hide timeout for ${duration}ms`);
      autoHideTimeout = setTimeout(() => {
        // console.log("Auto-hide timeout triggered");
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
      showToast("Template name must be 50 characters or less.", 3000, "red", [], "nameLength");
      return { isValid: false, sanitizedName: null };
    }
    const sanitizedName = trimmedName.replace(/[^a-zA-Z0-9-_.@\s]/g, "");
    if (sanitizedName !== trimmedName) {
      showToast("Template name can only contain letters, numbers, underscores(_), hyphens(-), periods(.), at(@), and spaces.", 3000, "red", [], "nameChar");
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
      showToast("Maximum of 5 tags allowed per template.", 3000, "red", [], "tagsLength");
      return null;
    }
    const sanitizedTags = tags.map(tag => tag.replace(/[^a-zA-Z0-9-_.@\s]/g, "").slice(0, 20));
    if (sanitizedTags.some(tag => tag.length === 0)) {
      showToast("Each tag must contain only letters, numbers, underscores(_), hyphens(-), periods(.), at(@), or spaces, and be 20 characters or less.", 3000, "red", [], "save");
      return null;
    }
    return sanitizedTags.join(", ");
  }

  // Check total storage usage
  // function checkTotalStorageUsage(callback) {
  //   chrome.storage.local.get(null, (items) => {
  //     const serialized = JSON.stringify(items);
  //     const totalSizeInBytes = new TextEncoder().encode(serialized).length;
  //     const maxTotalSize = 10 * 1024 * 1024; // 5MB for local storage
  //     if (totalSizeInBytes > 0.9 * maxTotalSize) {
  //       showToast("Warning: Storage is nearly full (90% of 10MB limit). Please delete unused templates.", 5000, "red", [], "save");
  //     }
  //     callback();
  //   });
  // }

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
      showToast("Template name must be 50 characters or less.", 3000, "red", [], "nameLength");
      value = value.slice(0, 50);
      elements.templateName.value = value;
    }
    const sanitizedValue = value.replace(/[^a-zA-Z0-9-_.@\s]/g, "");
    if (sanitizedValue !== value) {
      elements.templateName.value = sanitizedValue;
      showToast("Template name can only contain letters, numbers, underscores(_), hyphens(-), periods(.), at(@), and spaces.", 3000, "red", [], "nameChar");
    }
    saveState();
  }, 10));

  // Real-time tags validation
  elements.templateTags.addEventListener("input", debounce(() => {
    storeLastState();
    let value = elements.templateTags.value;
    if (value) {
      // Normalize input: remove leading/trailing commas/spaces, standardize comma-space separator
      value = value.replace(/^[,\s]+/g, "").replace(/[\s]*,[,\s]*/g, ", ");
      value = value.replace(/\s+/g, " "); // Replace multiple spaces with single space
      const tags = value.split(", ");
      
      // Validate tag count
      if (tags.length > 5) {
        showToast("Maximum of 5 tags allowed per template.", 3000, "red", [], "tagsLength");
        value = tags.slice(0, 5).join(", ");
      }
      
      // Validate and sanitize tags
      if (tags.some(tag => tag.length > 20)) {
        showToast("Each tag must be 20 characters or less.", 3000, "red", [], "tagLength");
      }
      const trimmedTags = tags.map(tag => tag.slice(0, 20));
      
      const sanitizedTags = trimmedTags.map(tag => tag.replace(/[^a-zA-Z0-9-_.@\s]/g, ""));
      if (sanitizedTags.some((tag, i) => tag !== trimmedTags[i])) {
        showToast("Each tag must contain only letters, numbers, underscores(_), hyphens(-), periods(.), at(@), or spaces.", 3000, "red", [], "tagChar");
      }
      
      // Update input value with sanitized tags
      value = sanitizedTags.join(", ");
      elements.templateTags.value = value;
    }
    
    // Adjust cursor position to avoid landing on comma or space
    const cursorPos = elements.templateTags.selectionStart;
    if (value && cursorPos > 0 && value[cursorPos] === " " && value[cursorPos - 1] === ",") {
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
    isFullscreen = !isFullscreen;
    saveState();
    svg.setAttribute("href", isFullscreen ? "sprite.svg#compress" : "sprite.svg#fullscreen");
    chrome.runtime.sendMessage({ action: "toggleFullscreen" });
  });

  // Close popup and clear fields
  elements.closeBtn.addEventListener("click", () => {
    elements.templateName.value = "";
    elements.templateTags.value = "";
    elements.promptArea.value = `# Your Role
* 

# Background Information
* 

# Your Task
* `;
    selectedTemplateName = null;
    elements.fetchBtn2.style.display = "block";
    elements.searchBox.value = "";
    loadTemplates();
    saveState();
    chrome.runtime.sendMessage({ action: "closePopup" });
  });

  // New template button
  elements.newBtn.addEventListener("click", () => {
    storeLastState();
    elements.templateName.value = "";
    elements.templateTags.value = "";
    elements.promptArea.value = `# Your Role
* 

# Background Information
* 

# Your Task
* `;
    selectedTemplateName = null;
    elements.fetchBtn2.style.display = "none";
    elements.clearPrompt.style.display = "block";
    elements.searchBox.value = "";
    loadTemplates();
    saveState();
    showToast("New template created.", 2000, "green", [], "new");
  });

  // Clear search input
  elements.clearSearch.addEventListener("click", () => {
    elements.searchBox.value = "";
    loadTemplates();
    elements.clearSearch.style.display = "none";
    elements.searchBox.focus();
  });

  // Clear prompt area
  elements.clearPrompt.addEventListener("click", () => {
    storeLastState();
    elements.promptArea.value = "";
    elements.fetchBtn2.style.display = "block";
    elements.clearPrompt.style.display = "none";
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
    elements.clearPrompt.style.display = "none";
    elements.searchBox.value = "";
    loadTemplates();
    saveState();
    showToast("All fields cleared.", 2000, "green", [], "clearAll");
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
    elements.fetchBtn2.style.display = elements.promptArea.value ? "none" : "block";
    elements.clearPrompt.style.display = elements.promptArea.value ? "block" : "none";
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
      // showToast("Error: No response from tab. Please navigate to a supported AI platform (e.g., grok.com, perplexity.ai, or chatgpt.com).", 4000, "red", [], "fetch");
      callback(null);
    }, 5000);
    chrome.runtime.sendMessage({ action: "getTargetTabId" }, (response) => {
      clearTimeout(timeout);
      if (response && response.tabId) {
        callback(response.tabId);
      } else {
        // showToast("Error: This page is not supported. Please navigate to a supported AI platform (e.g., grok.com, perplexity.ai, or chatgpt.com).", 4000, "red", [], "fetch");
        callback(null);
      }
    });
  }

  // Load templates and suggestions
  function loadTemplates(query = "", showDropdown = false) {
    chrome.storage.local.get(["templates"], (result) => {
      // console.log(result);
      let templates = result.templates || defaultTemplates.map((t, i) => ({ ...t, index: i }));
      elements.dropdownResults.innerHTML = "";
      elements.favoriteSuggestions.innerHTML = "";

      if (query) {
        templates = templates.filter(t =>
          t.name.toLowerCase().includes(query) || t.tags.toLowerCase().includes(query)
        );
        templates.sort((a, b) => {
          const aMatch = a.name.toLowerCase().indexOf(query) + a.tags.toLowerCase().indexOf(query);
          const bMatch = b.name.toLowerCase().indexOf(query) + b.tags.toLowerCase().indexOf(query);
          if (aMatch !== bMatch) return aMatch - bMatch;
          return a.name.localeCompare(b.name);
        });
      } else {
        templates.sort((a, b) => {
          const aIndex = recentIndices.indexOf(a.index);
          const bIndex = recentIndices.indexOf(b.index);
          if (aIndex === -1 && bIndex === -1) return a.name.localeCompare(b.name);
          if (aIndex === -1) return 1;
          if (bIndex === -1) return -1;
          return aIndex - bIndex;
        });
      }

      if (showDropdown) {
        templates.forEach((tmpl, idx) => {
          const div = document.createElement("div");
          div.textContent = tmpl.tags ? `${tmpl.name} (${tmpl.tags})` : `${tmpl.name}`;
          div.setAttribute("role", "option");
          div.setAttribute("aria-selected", selectedTemplateName === tmpl.name);
          elements.searchOverlay.style.display = 'block';
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
              elements.clearPrompt.style.display = tmpl.content ? "block" : "none";
              elements.searchOverlay.style.display = 'none';
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
            elements.clearPrompt.style.display = tmpl.content ? "block" : "none";
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
    loadTemplates(elements.searchBox.value.toLowerCase(), true);
  });

  // Search as user types
  elements.searchBox.addEventListener("input", () => {
    loadTemplates(elements.searchBox.value.toLowerCase(), true);
    elements.clearSearch.style.display = elements.searchBox.value ? "block" : "none";
  });

  // Close dropdowns when clicking outside
  document.addEventListener("click", (event) => {
    if (!elements.searchBox.contains(event.target) && !elements.dropdownResults.contains(event.target) 
        && !elements.themeToggle.contains(event.target) && !elements.fullscreenToggle.contains(event.target) 
        && !elements.closeBtn.contains(event.target)) {
      elements.dropdownResults.innerHTML = "";
      elements.searchOverlay.style.display = 'none';
      elements.dropdownResults.style.display = 'none';
      elements.dropdownResults.classList.remove("show");
    }
  });

  // Save templates with 5-second timeout
  function saveTemplates(templates, callback, isNewTemplate = false, button) {
    // checkTotalStorageUsage(() => {
      const timeout = setTimeout(() => {
        showToast("Operation timed out. Please try again.", 3000, "red", [], "save");
      }, 5000);
      chrome.storage.local.set({ templates }, () => {
        clearTimeout(timeout);
        if (chrome.runtime.lastError) {
          const errorMessage = chrome.runtime.lastError.message;
          if (errorMessage.includes("QUOTA_BYTES_PER_ITEM")) {
            showToast("Template size exceeds size limit. Please reduce the size.", 5000, "red", [], "save");
          } else if (errorMessage.includes("QUOTA_BYTES")) {
            showToast("Total storage limit exceeded. Please delete unused templates.", 5000, "red", [], "save");
          } else {
            showToast("Failed to save template: " + errorMessage, 5000, "red", [], "save");
          }
          console.error("Local storage error:", errorMessage);
        } else {
          showToast(isNewTemplate ? "Template saved. Press Ctrl+Z to undo." : "Template updated. Press Ctrl+Z to undo.", 3000, "green", [], "save");
          callback();
          chrome.storage.local.get(null, (items) => {
            const serialized = JSON.stringify(items);
            const totalSizeInBytes = new TextEncoder().encode(serialized).length;
            const maxTotalSize = 10 * 1024 * 1024; // 10MB for local storage
            if (totalSizeInBytes > 0.9 * maxTotalSize) {
              showToast("Warning: Storage is nearly full (90% of 10MB limit). Please delete unused templates.", 5000, "red", [], "save");
            }
          });         
        }
      });
    // });
  }

  // Save changes to existing template or create new template
  elements.saveBtn.addEventListener("click", () => {
    chrome.storage.local.get(["templates"], (result) => {
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
        elements.templateTags.focus();
        return;
      }
      const content = elements.promptArea.value;

      if (!content.trim()) {
        showToast("Prompt content is required to save a template.", 3000, "red", [], "save");
        elements.promptArea.focus();
        return;
      }

      // Check for no changes when editing an existing template
      if (selectedTemplateName) {
        const template = templates.find(t => t.name === selectedTemplateName);
        if (!template) {
          showToast("Selected template not found.", 3000, "red", [], "save");
          return;
        }
        const isEdited = elements.templateName.value !== template.name ||
                        sanitizeTags(elements.templateTags.value) !== template.tags ||
                        elements.promptArea.value !== template.content;
        if (!isEdited) {
          showToast("No changes to save.", 3000, "red", [], "save");
          return;
        }
      }

      // Helper function to save template
      const saveTemplate = () => {
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
            loadTemplates();
            saveState();
            saveNextIndex();
          }, true, elements.saveBtn);
        } else {
          const template = templates.find(t => t.name === selectedTemplateName);
          if (!template) {
            showToast("Selected template not found.", 3000, "red", [], "save");
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
            loadTemplates();
            saveState();
          }, false, elements.saveBtn);
        }
      };

      // Skip confirmation for new templates with tags and no other issues
      if (!selectedTemplateName && tagsInput.trim()) {
        saveTemplate();
        return;
      }

      // Construct confirmation message
      const isEditing = !!selectedTemplateName;
      const isRenamed = isEditing && elements.templateName.value !== selectedTemplateName;
      const noTags = !tagsInput.trim();
      const hasContentChanges = isEditing && elements.promptArea.value !== templates.find(t => t.name === selectedTemplateName)?.content;
      const hasTagChanges = isEditing && sanitizeTags(elements.templateTags.value) !== templates.find(t => t.name === selectedTemplateName)?.tags;

      let messages = [];
      if (noTags) {
        messages.push("No tags added");
      }
      if (isRenamed) {
        messages.push(`Name changed from ‘${selectedTemplateName}’ to ‘${name}’`);
      }
      if (hasContentChanges || hasTagChanges) {
        messages.push("Changes made to content or tags");
      }
      messages.push(isEditing ? "Overwrite template?" : "Save template?");

      const message = messages.join("\n");

      // Show confirmation toast
      showToast(
        message,
        0,
        "gray",
        [
          {
            text: "Yes",
            callback: saveTemplate
          },
          {
            text: "No",
            callback: () => {
              if (noTags) {
                elements.templateTags.focus();
              } else {
                elements.templateName.focus();
              }
            }
          }
        ],
        "save"
      );
    });
  });

    
  // Save as new template
  elements.saveAsBtn.addEventListener("click", () => {
    chrome.storage.local.get(["templates"], (result) => {
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
      const content = elements.promptArea.value;

      if (!content.trim()) {
        showToast("Prompt content is required to save a template.", 3000, "red", [], "saveAs");
        elements.promptArea.focus();
        return;
      }

      if (!tagsInput.trim()) {
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
        content: elements.promptArea.value,
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
        loadTemplates();
        saveState();
        saveNextIndex();
      }, true, button);
    });
  }

  // Fetch prompt from website
  elements.fetchBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      const timeout = setTimeout(() => {
        showToast("Fetch operation timed out. Please try again.", 3000, "red", [], "fetch");
      }, 5000);
      getTargetTabId((tabId) => {
        if (!tabId) {
          clearTimeout(timeout);
          // showToast("Error: This page is not supported. Please navigate to a supported AI platform (e.g., grok.com, perplexity.ai, or chatgpt.com).", 3000, "red", [], "fetch");
          return;
        }
        let hasRetried = false;
        function tryFetchPrompt() {
          chrome.tabs.sendMessage(tabId, { action: "getPrompt" }, (response) => {
            clearTimeout(timeout);
            if (chrome.runtime.lastError) {
              const errorMessage = chrome.runtime.lastError.message;
              console.error("Fetch error:", errorMessage);
              if (!hasRetried && (errorMessage.includes("Cannot access contents of the page") || errorMessage.includes("Could not establish connection"))) {
                hasRetried = true;
                // console.log("Content script unresponsive, attempting to re-inject...");
                chrome.runtime.sendMessage({ action: "reInjectContentScript", tabId }, (reInjectResponse) => {
                  if (reInjectResponse && reInjectResponse.success) {
                    // console.log("Content script re-injected, retrying fetch...");
                    setTimeout(tryFetchPrompt, 100); // Short delay to ensure script is loaded
                  } else {
                    showToast("Failed to fetch prompt. Please try again or refresh the page.", 3000, "red", [], "fetch");
                  }
                });
              } else {
                showToast("Failed to fetch prompt. Please try again or refresh the page.", 3000, "red", [], "fetch");
              }
              return;
            }
            if (response && response.prompt) {
              storeLastState();
              elements.promptArea.value = response.prompt;
              elements.fetchBtn2.style.display = "none";
              elements.clearPrompt.style.display = "block";
              saveState();
            } else {
              showToast("No text found. Please select a field that contains text.", 3000, "red", [], "fetch");
            }
          });
        }
        tryFetchPrompt();
      });
    });
  });

  // Send prompt to website and close popup
  elements.sendBtn.addEventListener("click", () => {
    const timeout = setTimeout(() => {
      showToast("Send operation timed out. Please try again.", 3000, "red", [], "send");
    }, 5000);
    getTargetTabId((tabId) => {
      if (!tabId) {
        clearTimeout(timeout);
        // showToast("Error: This page is not supported. Please navigate to a supported AI platform (e.g., grok.com, perplexity.ai, or chatgpt.com).", 3000, "red", [], "send");
        return;
      }
      let hasRetried = false;
      function trySendPrompt() {
        chrome.tabs.sendMessage(tabId, {
          action: "sendPrompt",
          prompt: elements.promptArea.value
        }, (response) => {
          clearTimeout(timeout);
          if (chrome.runtime.lastError) {
            const errorMessage = chrome.runtime.lastError.message;
            console.error("Send error:", errorMessage);
            if (!hasRetried && (errorMessage.includes("Cannot access contents of the page") || errorMessage.includes("Could not establish connection"))) {
              hasRetried = true;
              // console.log("Content script unresponsive, attempting to re-inject...");
              chrome.runtime.sendMessage({ action: "reInjectContentScript", tabId }, (reInjectResponse) => {
                if (reInjectResponse && reInjectResponse.success) {
                  // console.log("Content script re-injected, retrying send...");
                  setTimeout(trySendPrompt, 100); // Short delay to ensure script is loaded
                } else {
                  showToast("Failed to send prompt. Please try again or refresh the page.", 3000, "red", [], "send");
                }
              });
              return;
            } else {
              showToast("Failed to send prompt. Please try again or refresh the page.", 3000, "red", [], "send");
              return;
            }
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
              });
            } else {
              chrome.runtime.sendMessage({ action: "closePopup" });
            }
          } else {
            showToast("Failed to send prompt. Please try again or refresh the page.", 3000, "red", [], "send");
          }
        });
      }
      trySendPrompt();
    });
  });

  // Delete selected template
  elements.deleteBtn.addEventListener("click", () => {
    if (!selectedTemplateName) {
      showToast("Please select a template to delete.", 3000, "red", [], "delete");
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
                  elements.promptArea.value = `# Your Role
* 

# Background Information
* 

# Your Task
* `;
                  elements.searchBox.value = "";
                  elements.fetchBtn2.style.display = "block";
                  elements.clearPrompt.style.display = "none";
                  loadTemplates();
                  saveState();
                }
              });
            }
          },
          {
            text: "No",
            callback: () => {
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
          loadTemplates();
        });
        showToast("Action undone successfully.", 2000, "green", [], "undo");
      }
      elements.fetchBtn2.style.display = elements.promptArea.value ? "none" : "block";
      elements.clearPrompt.style.display = elements.promptArea.value ? "block" : "none";
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
            loadTemplates(elements.searchBox.value.toLowerCase(), true);
          });
        }
      });
    }
  });

  // Initialize tooltips
  const tooltipTriggerList = document.querySelectorAll('[data-bs-toggle="tooltip"]');
  tooltipTriggerList.forEach(tooltipTriggerElm => new bootstrap.Tooltip(tooltipTriggerElm, {
    duration: 300
  }));

  // Keyboard navigation for dropdown
  elements.dropdownResults.addEventListener("keydown", (e) => {
    const items = elements.dropdownResults.querySelectorAll("div");
    const focused = document.activeElement;
    let index = Array.from(items).indexOf(focused);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      index = (index + 1) % items.length;
      items[index].focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      index = (index - 1 + items.length) % items.length;
      items[index].focus();
    } else if (e.key === "Enter") {
      e.preventDefault();
      focused.click();
    }
  });
});