import jsyaml from "js-yaml"; // Importing js-yaml
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
// --- PromptStash: Default Template Name (0008732) START ---
function getDefaultTemplateName() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const hours = String(now.getHours()).padStart(2, "0");
  const minutes = String(now.getMinutes()).padStart(2, "0");
  // Use dash instead of colon
  return `Stash @ ${year}-${month}-${day} ${hours}-${minutes}`;
}
// --- PromptStash: Default Template Name (0008732) END ---
// --- PromptStash: Indentation with TAB/Shift+TAB (0008899) START ---
function handleIndent(textarea, start, end, value, indentSpaces) {
  if (start === end) {
    // No selection: insert spaces at cursor
    textarea.value = value.slice(0, start) + indentSpaces + value.slice(end);
    textarea.setSelectionRange(start + indentSpaces.length, start + indentSpaces.length);
  } else {
    // Selection: indent each line
    const { before, selection, after } = getTextParts(value, start, end);
    const indented = selection.replace(/^/gm, indentSpaces);
    const addedLength = indented.length - selection.length;
    
    textarea.value = before + indented + after;
    textarea.setSelectionRange(start, end + addedLength);
  }
}

function handleUnindent(textarea, start, end, value, indentSize) {
  const { before, selection, after } = getTextParts(value, start, end);
  const unindentRegex = new RegExp(`^ {1,${indentSize}}`, 'gm');
  const unindented = selection.replace(unindentRegex, "");
  const removedLength = selection.length - unindented.length;
  
  textarea.value = before + unindented + after;
  textarea.setSelectionRange(start, end - removedLength);
}

function getTextParts(value, start, end) {
  return {
    before: value.slice(0, start),
    selection: value.slice(start, end),
    after: value.slice(end)
  };
}
// --- PromptStash: Indentation with TAB/Shift+TAB (0008899) END ---
// --- PromptStash: Support Export & Imports of Promts (0008903) START ---

// Utility: Convert prompts array to YAML string using js-yaml
function promptToYAML(prompts) {
  // jsyaml.dump() converts a JS object/array to YAML format
  return jsyaml.dump(prompts);
}

// Utility: Download a YAML file in the browser
function downloadYAML(yaml, filename) {
  // Create a Blob from the YAML string
  const blob = new Blob([yaml], { type: "text/yaml" });
  // Create a temporary URL for the Blob
  const url = URL.createObjectURL(blob);
  // Create a temporary <a> element to trigger the download
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click(); // Trigger the download
  setTimeout(() => {
    document.body.removeChild(a); // Clean up
    URL.revokeObjectURL(url); // Release the Blob URL
  }, 100);
}
  // --- Disable/Enable Export Single Button ---
function updateExportSingleBtnState() {
  chrome.storage.local.get(["templates"], (result) => {
    const templates = result.templates || [];
    const name = document.getElementById("templateName").value.trim();
    const exists = templates.some((t) => t.name === name);
    const btn = document.getElementById("exportSingleBtn");
    if(!exists){
      btn.style.display = "none"; // Hide the button
      // Optionally, you can also disable and update ARIA for accessibility
      btn.disabled = true;
      btn.setAttribute("aria-disabled", "true");
      return
    }
    
    btn.style.display = ""; // Show the button
    btn.disabled = !exists;
    btn.setAttribute("aria-disabled", !exists);

    // Set only the Bootstrap tooltip text
    const tooltipText = "Export this template"
    btn.setAttribute("data-bs-original-title", tooltipText);

    // Update Bootstrap tooltip instance if it exists
    if (window.bootstrap) {
      const tooltip = bootstrap.Tooltip.getInstance(btn);
      if (tooltip) {
        tooltip.setContent({ ".tooltip-inner": tooltipText });
      }
    }
  });
}
// --- PromptStash: Support Export & Imports of Promts (0008903) END ---


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
    tagsDisplay: document.getElementById("tagsDisplay"),
    editTagsBtn: document.getElementById("editTagsBtn"),
    cancelTagsEditBtn: document.getElementById("cancelTagsEditBtn"),
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
  // --- Enable Tag Based Prompt (0008901) START ---
  function switchToTagsViewMode() {
    const tagsArray = elements.templateTags.value
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);

    // If there are no tags, stay in edit mode so the user can type.
    if (tagsArray.length === 0) {
      originalTagsBeforeEdit = null
      switchToTagsEditMode(false); // Stay in edit mode, but don't focus
      return;
    }

    elements.tagsDisplay.innerHTML = ""; // Clear old tags
    tagsArray.forEach((tag) => {
      const tagLink = document.createElement("span");
      tagLink.className = "tag-link";
      tagLink.textContent = tag;
      tagLink.addEventListener("click", () => {
        elements.searchBox.value = tag;
        loadTemplates(tag.toLowerCase(), true);
        elements.searchBox.focus();
        elements.clearSearch.style.display = "block";
      });
      elements.tagsDisplay.appendChild(tagLink);
    });

    // Show the display div and hide the real input
    elements.tagsDisplay.classList.remove("hidden");
    elements.editTagsBtn.classList.remove("hidden");
    elements.templateTags.classList.add("hidden");
    elements.cancelTagsEditBtn.classList.add("hidden"); // Hide cancel button
    
    originalTagsBeforeEdit = null; // Clear the temporary state
    saveState();
  }

  function switchToTagsEditMode(setFocus = false) {
    elements.tagsDisplay.classList.add("hidden");
    elements.editTagsBtn.classList.add("hidden");
    elements.templateTags.classList.remove("hidden");

    // Only show the cancel button if we have a state to revert to
    if (originalTagsBeforeEdit !== null) {
      elements.cancelTagsEditBtn.classList.remove("hidden");
    } else {
      elements.cancelTagsEditBtn.classList.add("hidden");
    }
    
    if (setFocus) {
      elements.templateTags.focus();
    }
    saveState();
  }
  // NEW: Listener for the cancel button
  elements.cancelTagsEditBtn.addEventListener("click", () => {
    if (originalTagsBeforeEdit !== null) {
      // Revert the input value to the stored original state
      elements.templateTags.value = originalTagsBeforeEdit;
      // Switch back to view mode, which re-renders links and saves the reverted state
      switchToTagsViewMode();
    }
  });
// UPDATED: editTagsBtn listener
  elements.editTagsBtn.addEventListener("click", () => {
    // Store the current tags right before switching to edit mode
    originalTagsBeforeEdit = elements.templateTags.value;
    switchToTagsEditMode(true);
  });


// --- PromptStash: Support Export & Imports of Promts (0008903) START ---

  // When the Import button is clicked, trigger the hidden file input
  document.getElementById("importBtn").addEventListener("click", () => {
    document.getElementById("importFileInput").click();
  });

  // When a file is selected, read and import the YAML
  document
    .getElementById("importFileInput")
    .addEventListener("change", function (event) {
      const file = event.target.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = function (e) {
        try {
          // Parse YAML
          const imported = jsyaml.load(e.target.result);

          // Validate: must be an array of objects
          if (!Array.isArray(imported)) {
            showToast("Invalid YAML: Expected a list of prompts.", 3000, "red");
            return;
          }

          chrome.storage.local.get(["templates"], (result) => {
            let templates = result.templates || [];
            let added = 0,
              overwritten = 0,
              assigned = 0;

            imported.forEach((imp, idx) => {
              // Ensure required fields
              if (
                !imp.name ||
                typeof imp.name !== "string" ||
                !imp.name.trim()
              ) {
                imp.name = `Imported Prompt ${idx + 1}`;
                assigned++;
              }
              // Overwrite if exists, else add
              const existingIdx = templates.findIndex(
                (t) => t.name === imp.name
              );
              if (existingIdx !== -1) {
                templates[existingIdx] = { ...templates[existingIdx], ...imp };
                overwritten++;
              } else {
                // Assign a new index if missing
                if (typeof imp.index !== "number") {
                  imp.index = templates.length
                    ? Math.max(...templates.map((t) => t.index || 0)) + 1
                    : 0;
                }
                templates.push(imp);
                added++;
              }
            });

            chrome.storage.local.set({ templates }, () => {
              loadTemplates();
              showToast(
                `Imported: ${added} new, ${overwritten} overwritten${
                  assigned ? `, ${assigned} assigned default name` : ""
                }.`,
                4000,
                "green"
              );
            });
          });
        } catch (err) {
          showToast("Failed to import: " + err.message, 4000, "red");
        }
      };
      reader.readAsText(file);
      // Reset input so user can import the same file again if needed
      event.target.value = "";
    });

  // new tooltip for export single button
  const exportSingleBtn = document.getElementById("exportSingleBtn");
  if (exportSingleBtn) {
    new bootstrap.Tooltip(exportSingleBtn, { trigger: "hover" });
  }

  // Export All: Download all prompts as a YAML file
  document.getElementById("exportAllBtn").addEventListener("click", () => {
    chrome.storage.local.get(["templates"], (result) => {
      const templates = result.templates || [];
      const yaml = promptToYAML(templates); // Convert to YAML
      downloadYAML(yaml, "promptstash_export_all.yaml"); // Download as .yaml
      showToast("All prompts exported!", 2000, "green");
    });
  });

  // Export Single: Download the currently loaded template as a YAML file
  document.getElementById("exportSingleBtn").addEventListener("click", () => {
    chrome.storage.local.get(["templates"], (result) => {
      const templates = result.templates || [];
      const name = elements.templateName.value.trim();
      const prompt = templates.find((t) => t.name === name);
      if (prompt) {
        const yaml = promptToYAML([prompt]); // Convert single prompt to YAML
        downloadYAML(
          yaml,
          `promptstash_export_${prompt.name || "prompt"}.yaml`
        );
        showToast("Prompt exported!", 2000, "green");
      } else {
        showToast("No template selected to export.", 2000, "red");
      }
    });
  });


  elements.templateName.addEventListener("input", updateExportSingleBtnState);

    // --- PromptStash: Support Export & Imports of Promts (0008903) END ---

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

  // Function to update save button state based on template type
  function updateSaveButtonState() {
    const saveButtonWrapper = elements.saveBtn.parentElement;
    
    if (!selectedTemplateName) {
      // New template - enable save button
      elements.saveBtn.disabled = false;
      elements.saveBtn.classList.remove('disabled');
      elements.saveBtn.setAttribute('title', 'Save template');
      saveButtonWrapper.setAttribute('title', 'Save template');
      saveButtonWrapper.classList.remove('disabled-wrapper');
      return;
    }

    chrome.storage.local.get(["templates"], (result) => {
      const templates = result.templates || defaultTemplates.map((t, i) => ({ ...t, index: i }));
      const currentTemplate = templates.find(t => t.name === selectedTemplateName);
      
      if (currentTemplate && currentTemplate.type === "pre-built") {
        // Default template - disable save button
        elements.saveBtn.disabled = true;
        elements.saveBtn.classList.add('disabled');
        elements.saveBtn.removeAttribute('title'); // Remove from button
        const tooltipText = 'Cannot save default templates. Use "Save As" to create a copy.';
        saveButtonWrapper.setAttribute('title', tooltipText);
        saveButtonWrapper.setAttribute('data-bs-toggle', 'tooltip');
        saveButtonWrapper.setAttribute('data-bs-placement', 'top');
        saveButtonWrapper.classList.add('disabled-wrapper');
      } else {
        // Custom template - enable save button
        elements.saveBtn.disabled = false;
        elements.saveBtn.classList.remove('disabled');
        elements.saveBtn.setAttribute('title', 'Save changes to template');
        saveButtonWrapper.setAttribute('title', 'Save changes to template');
        saveButtonWrapper.classList.remove('disabled-wrapper');
      }
    });
  }
  let isFullscreen = false;
  let recentIndices = [];
  let originalTagsBeforeEdit = null;

  // State object for dynamic tabs
  let tabsState = {
    placeholders: [],
    placeholderValues: {},
    currentTemplate: ""
  };

  let placeholderTracker = {};

function parsePlaceholders(templateContent) {
    const placeholderRegex = /\{\{([^}]+)\}\}/g;
    const placeholders = [];
    let match;
    
    // First, find regular {{placeholder}} patterns
    while ((match = placeholderRegex.exec(templateContent)) !== null) {
      const placeholder = match[1].trim();
      if (!placeholders.includes(placeholder)) {
        placeholders.push(placeholder);
      }
    }
    
    // Also find existing placeholder spans in the DOM
    if (elements.promptArea) {
      const existingSpans = elements.promptArea.querySelectorAll('.placeholder-marker[data-type]');
      existingSpans.forEach(span => {
        const type = span.getAttribute('data-type');
        if (type && !placeholders.includes(type)) {
          placeholders.push(type);
        }
      });
    }
    
    return placeholders;
}
// Convert {{placeholder}} syntax to span elements
function convertPlaceholdersToSpans(templateContent) {
  // If content already has spans, don't convert again
  if (templateContent.includes('<span class="placeholder-marker"')) {
    return templateContent;
  }
  
  const placeholderRegex = /\{\{([^}]+)\}\}/g;
  let convertedContent = templateContent;
  let placeholderCounter = {};
  
  convertedContent = convertedContent.replace(placeholderRegex, (match, placeholder) => {
    const trimmedPlaceholder = placeholder.trim();
    
    // Create unique ID for this placeholder instance
    if (!placeholderCounter[trimmedPlaceholder]) {
      placeholderCounter[trimmedPlaceholder] = 0;
    }
    placeholderCounter[trimmedPlaceholder]++;
    
    const uniqueId = `${trimmedPlaceholder}-${placeholderCounter[trimmedPlaceholder]}`;
    
    // Initialize tracker for this placeholder
    if (!placeholderTracker[uniqueId]) {
      placeholderTracker[uniqueId] = {
        type: trimmedPlaceholder,
        original: match,
        current: match,
        isModified: false
      };
    }
    
    return `<span class="placeholder-marker" data-type="${trimmedPlaceholder}" data-id="${uniqueId}" contenteditable="true">${match}</span>`;
  });
  
  return convertedContent;
}

// Extract final content with span values preserved
function extractContentWithSpanValues() {
  const promptArea = elements.promptArea;
  const spans = promptArea.querySelectorAll('.placeholder-marker[data-id]');
  
  // Update tracker with current span values
  spans.forEach(span => {
    const id = span.getAttribute('data-id');
    const currentText = span.textContent;
    
    if (placeholderTracker[id]) {
      placeholderTracker[id].current = currentText;
      placeholderTracker[id].isModified = (currentText !== placeholderTracker[id].original);
      
      // Update visual styling
      if (placeholderTracker[id].isModified) {
        span.style.backgroundColor = '#d1ecf1';
        span.style.borderColor = '#bee5eb';
      } else {
        span.style.backgroundColor = '#fff3cd';
        span.style.borderColor = '#ffeaa7';
      }
    }
  });
  
  // Return the HTML content with spans preserved
  return promptArea.innerHTML;
}
// Update placeholder value in all instances of that type
function updatePlaceholderValue(placeholderType, newValue) {
  if (!newValue.trim()) return;
  
  const spans = elements.promptArea.querySelectorAll(`[data-type="${placeholderType}"]`);
  
  spans.forEach(span => {
    const id = span.getAttribute('data-id');
    
    // Update the visual content
    span.textContent = newValue;
    
    // Update tracker
    if (placeholderTracker[id]) {
      placeholderTracker[id].current = newValue;
      placeholderTracker[id].isModified = (newValue !== placeholderTracker[id].original);
      
      // Update styling
      span.style.backgroundColor = '#d1ecf1';
      span.style.borderColor = '#bee5eb';
    }
  });
}
// Reset specific placeholder type to original values
function resetPlaceholderType(placeholderType) {
  const spans = elements.promptArea.querySelectorAll(`[data-type="${placeholderType}"]`);
  
  spans.forEach(span => {
    const id = span.getAttribute('data-id');
    
    if (placeholderTracker[id]) {
      span.textContent = placeholderTracker[id].original;
      placeholderTracker[id].current = placeholderTracker[id].original;
      placeholderTracker[id].isModified = false;
      
      // Reset styling
      span.style.backgroundColor = '#fff3cd';
      span.style.borderColor = '#ffeaa7';
    }
  });
}
  // Replace placeholders in template with actual values
  function replacePlaceholders(templateContent, placeholderValues) {
    let result = templateContent;
    Object.keys(placeholderValues).forEach(placeholder => {
      const value = placeholderValues[placeholder] || `{{${placeholder}}}`;
      const regex = new RegExp(`\\{\\{\\s*${placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\}\\}`, 'g');
      result = result.replace(regex, value);
    });
    return result;
  }

  // Update template preview with current placeholder values
  function updateTemplatePreview() {
    if (tabsState.currentTemplate && Object.keys(tabsState.placeholderValues).length > 0) {
      const previewContent = replacePlaceholders(tabsState.currentTemplate, tabsState.placeholderValues);
      
      // Temporarily disable the input event listener to prevent tab rebuilding
      const inputHandler = elements.promptArea.oninput;
      elements.promptArea.oninput = null;
      
      elements.promptArea.textContent = previewContent;
      saveState();
      
      // Re-enable the input event listener
      elements.promptArea.oninput = inputHandler;
    }
  }

  // Update tab title to show filled status
  function updateTabTitle(placeholder, hasValue) {
    const tabId = `placeholder-${placeholder.replace(/\s+/g, '-').toLowerCase()}`;
    const tabButton = document.getElementById(tabId);
    if (tabButton) {
      if (hasValue) {
        tabButton.classList.add('filled');
        tabButton.textContent = `${placeholder} ✓`;
      } else {
        tabButton.classList.remove('filled');
        tabButton.textContent = placeholder;
      }
    }
  }

// Enhanced buildTabsFromTemplate function
function buildTabsFromTemplate(templateContent) {
  // Convert {{placeholders}} to spans if they exist
  const contentWithSpans = convertPlaceholdersToSpans(templateContent);
  
  // Update promptArea with span-enhanced content
  if (contentWithSpans !== templateContent) {
    elements.promptArea.innerHTML = contentWithSpans;
  }
  
  const placeholders = parsePlaceholders(templateContent);
  
  // Check if placeholders have actually changed to avoid unnecessary rebuilding
  const placeholdersChanged = JSON.stringify(placeholders) !== JSON.stringify(tabsState.placeholders);
  
  if (!placeholdersChanged && tabsState.currentTemplate) {
    tabsState.currentTemplate = templateContent;
    return;
  }
  
  tabsState.placeholders = placeholders;
  tabsState.currentTemplate = templateContent;
  
  const tabsList = document.getElementById("editorTabs");
  const tabPanels = document.getElementById("tabPanels");
  
  // Clear existing placeholder tabs (keep Template tab)
  const existingTabs = tabsList.querySelectorAll('li:not(:first-child)');
  existingTabs.forEach(tab => tab.remove());
  
  const existingPanels = tabPanels.querySelectorAll('.tab-pane:not(#template-panel)');
  existingPanels.forEach(panel => panel.remove());
  
  if (placeholders.length === 0) {
    tabsList.style.display = 'none';
    elements.promptArea.style.height = 'calc(100vh - 320px)';
    return;
  } else {
    tabsList.style.display = 'flex';
    elements.promptArea.style.height = 'calc(100vh - 360px)';
  }
  
  // Create tabs for each placeholder type
  placeholders.forEach((placeholder, index) => {
    const tabId = `placeholder-${placeholder.replace(/\s+/g, '-').toLowerCase()}`;
    const panelId = `${tabId}-panel`;
    
    // Create tab
    const tabItem = document.createElement('li');
    tabItem.className = 'nav-item';
    tabItem.setAttribute('role', 'presentation');
    
    const tabButton = document.createElement('button');
    tabButton.className = 'nav-link';
    tabButton.id = tabId;
    tabButton.setAttribute('data-bs-toggle', 'tab');
    tabButton.setAttribute('data-bs-target', `#${panelId}`);
    tabButton.setAttribute('type', 'button');
    tabButton.setAttribute('role', 'tab');
    tabButton.setAttribute('aria-controls', panelId);
    tabButton.setAttribute('aria-selected', 'false');
    tabButton.textContent = placeholder;
    
    tabItem.appendChild(tabButton);
    tabsList.appendChild(tabItem);
    
    // Create tab panel
    const tabPanel = document.createElement('div');
    tabPanel.className = 'tab-pane fade';
    tabPanel.id = panelId;
    tabPanel.setAttribute('role', 'tabpanel');
    tabPanel.setAttribute('aria-labelledby', tabId);
    
    const panelContent = document.createElement('div');
    panelContent.className = 'position-relative';
    
    const textarea = document.createElement('textarea');
    textarea.className = 'form-control rounded-0 rounded-bottom px-3 py-2';
    textarea.style.resize = 'none';
    textarea.style.height = 'calc(100vh - 360px)';
    textarea.style.minHeight = '100px';
    textarea.placeholder = `Enter value for ${placeholder}...`;
    textarea.setAttribute('aria-label', `Value for ${placeholder}`);
    textarea.id = `${tabId}-textarea`;
    
    const updateButton = document.createElement('button');
    updateButton.className = 'btn btn-sm btn-primary position-absolute top-0 end-0 m-2 me-5';
    updateButton.textContent = 'Update';
    updateButton.setAttribute('aria-label', `Update ${placeholder}`);
    updateButton.style.zIndex = '10';
    
    const resetButton = document.createElement('button');
    resetButton.className = 'btn btn-sm btn-outline-secondary position-absolute top-0 end-0 m-2';
    resetButton.textContent = 'Reset';
    resetButton.setAttribute('aria-label', `Reset ${placeholder}`);
    resetButton.style.zIndex = '10';
    
    // Add event listeners
    updateButton.addEventListener('click', () => {
      const value = textarea.value.trim();
      if (value) {
        updatePlaceholderValue(placeholder, value);
        updateTabTitle(placeholder, true);
        saveState();
      }
    });
    
    resetButton.addEventListener('click', () => {
      resetPlaceholderType(placeholder);
      textarea.value = '';
      updateTabTitle(placeholder, false);
      textarea.focus();
      saveState();
    });
    
    // Update on Enter key
    textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        updateButton.click();
      }
    });
    
    // Update tab title on input
    textarea.addEventListener('input', () => {
      updateTabTitle(placeholder, textarea.value.trim() !== '');
    });
    
    panelContent.appendChild(textarea);
    panelContent.appendChild(updateButton);
    panelContent.appendChild(resetButton);
    tabPanel.appendChild(panelContent);
    tabPanels.appendChild(tabPanel);
    
    // Load saved values if they exist
    const savedValue = tabsState.placeholderValues[placeholder] || '';
    textarea.value = savedValue;
    updateTabTitle(placeholder, savedValue.trim() !== '');
  });
}
// Enhanced prompt input handler
// Enhanced prompt input handler
const enhancedPromptInputHandler = () => {
  storeLastState();
  elements.fetchBtn2.style.display = elements.promptArea.textContent ? "none" : "block";
  elements.clearPrompt.style.display = elements.promptArea.textContent ? "block" : "none";
  
  // Track span changes but don't rebuild if we're just editing existing spans
  const spans = elements.promptArea.querySelectorAll('.placeholder-marker[data-id]');
  let hasSpanChanges = false;
  
  spans.forEach(span => {
    const id = span.getAttribute('data-id');
    const currentText = span.textContent;
    
    if (placeholderTracker[id] && placeholderTracker[id].current !== currentText) {
      placeholderTracker[id].current = currentText;
      placeholderTracker[id].isModified = (currentText !== placeholderTracker[id].original);
      hasSpanChanges = true;
      
      // Update styling
      if (placeholderTracker[id].isModified) {
        span.style.backgroundColor = '#d1ecf1';
        span.style.borderColor = '#bee5eb';
      } else {
        span.style.backgroundColor = '#fff3cd';
        span.style.borderColor = '#ffeaa7';
      }
    }
  });
  
  // Only rebuild tabs if content structure changed, not just span content
  if (elements.promptArea.textContent.trim()) {
    // Get the current content for placeholder analysis
    const currentContent = elements.promptArea.innerHTML;
    
    // Parse placeholders from the current structure
    const currentPlaceholders = parsePlaceholders(currentContent);
    const existingPlaceholders = tabsState.placeholders || [];
    
    // Only rebuild if placeholder types changed (not just their values)
    const placeholdersStructureChanged = JSON.stringify(currentPlaceholders.sort()) !== JSON.stringify(existingPlaceholders.sort());
    
    if (placeholdersStructureChanged) {
      tabsState.currentTemplate = currentContent;
      buildTabsFromTemplate(currentContent);
    }
  } else {
    const tabsList = document.getElementById("editorTabs");
    tabsList.style.display = 'none';
    elements.promptArea.style.height = 'calc(100vh - 320px)';
  }
  
  saveState();
};
// Enhanced save state function
function enhancedSaveState() {
  const state = {
    popupState: {
      name: elements.templateName.value,
      tags: elements.templateTags.value,
      content: extractContentWithSpanValues(), // Use enhanced content extraction
      selectedName: selectedTemplateName,
      isTagsInEditMode: !elements.templateTags.classList.contains('hidden'),
      originalTags: originalTagsBeforeEdit,
    },
    theme: currentTheme,
    isFullscreen,
    extensionVersion: EXTENSION_VERSION,
    placeholderValues: tabsState.placeholderValues,
    placeholderTracker: placeholderTracker // Save tracker state
  };
  chrome.storage.local.set(state);
}

// Add CSS for placeholder styling
function addPlaceholderStyles() {
  if (!document.getElementById('placeholder-styles')) {
    const style = document.createElement('style');
    style.id = 'placeholder-styles';
    style.textContent = `
      .placeholder-marker {
        background-color: #fff3cd;
        border: 1px solid #ffeaa7;
        border-radius: 3px;
        padding: 1px 4px;
        margin: 0 1px;
        display: inline-block;
        position: relative;
        cursor: pointer;
        transition: all 0.2s ease;
      }
      
      .placeholder-marker:hover {
        background-color: #fff3a0;
      }
      
      .placeholder-marker::after {
        content: attr(data-type);
        position: absolute;
        top: -25px;
        left: 50%;
        transform: translateX(-50%);
        background: #333;
        color: white;
        padding: 2px 6px;
        border-radius: 3px;
        font-size: 10px;
        white-space: nowrap;
        opacity: 0;
        pointer-events: none;
        transition: opacity 0.2s;
        z-index: 1000;
      }
      
      .placeholder-marker:hover::after {
        opacity: 1;
      }
      
      .placeholder-marker[contenteditable]:focus {
        outline: 2px solid #007bff;
        outline-offset: 1px;
      }
    `;
    document.head.appendChild(style);
  }
}

// Initialize enhanced placeholder system
function initializeEnhancedPlaceholderSystem() {
  addPlaceholderStyles();
  
  // Replace the existing prompt input handler
  elements.promptArea.removeEventListener("input", promptInputHandler);
  elements.promptArea.addEventListener("input", enhancedPromptInputHandler);
  
  // Replace saveState function
  saveState = enhancedSaveState;
  
  // Add prevention for accidental deletion of placeholder spans
  elements.promptArea.addEventListener('keydown', function(e) {
    const selection = window.getSelection();
    if (selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      const container = range.commonAncestorContainer;
      
      // Check if we're trying to delete a placeholder marker
      if (container.nodeType === Node.ELEMENT_NODE && container.classList.contains('placeholder-marker')) {
        if (e.key === 'Delete' || e.key === 'Backspace') {
          e.preventDefault();
          showToast('Cannot delete placeholder markers. Use the tabs below to modify them.', 3000, 'red', [], 'placeholder');
        }
      }
      
      // Also check if parent is a placeholder marker
      if (container.parentNode && container.parentNode.classList && container.parentNode.classList.contains('placeholder-marker')) {
        if (e.key === 'Delete' || e.key === 'Backspace') {
          if (selection.toString() === container.parentNode.textContent) {
            e.preventDefault();
            showToast('Cannot delete entire placeholder. Use the tabs below to modify them.', 3000, 'red', [], 'placeholder');
          }
        }
      }
    }
  });
  
  // Load placeholder tracker from storage
  chrome.storage.local.get(['placeholderTracker'], (result) => {
    if (result.placeholderTracker) {
      placeholderTracker = result.placeholderTracker;
    }
  });
}
// Handle direct editing of placeholder spans
elements.promptArea.addEventListener('input', function(e) {
  // If the change happened inside a placeholder span, update tracker immediately
  if (e.target && e.target.classList && e.target.classList.contains('placeholder-marker')) {
    const id = e.target.getAttribute('data-id');
    const currentText = e.target.textContent;
    
    if (placeholderTracker[id]) {
      placeholderTracker[id].current = currentText;
      placeholderTracker[id].isModified = (currentText !== placeholderTracker[id].original);
      
      // Update styling immediately
      if (placeholderTracker[id].isModified) {
        e.target.style.backgroundColor = '#d1ecf1';
        e.target.style.borderColor = '#bee5eb';
      } else {
        e.target.style.backgroundColor = '#fff3cd';
        e.target.style.borderColor = '#ffeaa7';
      }
    }
  }
});
  // Load popup state, recent indices, and initialize index with version check
  chrome.storage.local.get(["popupState", "theme", "extensionVersion", "recentIndices", "templates", "nextIndex", "isFullscreen", "placeholderValues","placeholderTracker"], (result) => {
    // Check if stored version matches current version
    const storedVersion = result.extensionVersion || "0.0.0";
    if (storedVersion !== EXTENSION_VERSION) {
      // console.log(`Version updated from ${storedVersion} to ${EXTENSION_VERSION}. No schema migration needed.`);
      chrome.storage.local.set({ extensionVersion: EXTENSION_VERSION });
    }
  // LOAD THEME FIRST - before anything that might call saveState()
  currentTheme = result.theme || "light";
  document.body.className = currentTheme;
  
  // Load other global state
  nextIndex = result.nextIndex || defaultTemplates.length;
  recentIndices = result.recentIndices || [];
  isFullscreen = result.isFullscreen || false;
  let svg = elements.fullscreenToggle.querySelector("svg use");
  svg.setAttribute("href", isFullscreen ? "sprite.svg#compress" : "sprite.svg#fullscreen");

    // Initialize state, falling back to defaults if not present
    const state = result.popupState || {};
    // Load the pre-edit tags state from storage
    originalTagsBeforeEdit = state.originalTags || null; 
    // Get the saved edit mode, default to true for a new session (so it's an empty text box)
    const isTagsInEditMode = state.isTagsInEditMode === undefined ? true : state.isTagsInEditMode;

    const defaultText = `# Your Role*\n\n# Background Information\n*\n\n# Your Task\n*`;
    elements.templateName.value = state.name || getDefaultTemplateName(); // (0008732)
    elements.templateTags.value = state.tags || "";
    elements.promptArea.textContent = state.content || defaultText;
    
    selectedTemplateName = state.selectedName || null;
    
    // Load saved placeholder values
    tabsState.placeholderValues = result.placeholderValues || {};
    
    // NEW LOGIC: Use the saved flag to set the initial mode
    if (isTagsInEditMode || !selectedTemplateName) {
        switchToTagsEditMode();
    } else {
        switchToTagsViewMode();
    }


// Ensure templates are initialized and tags are in the correct format
let templates = result.templates;
if (!templates) {
  // This block runs only the very first time the extension is installed
  templates = defaultTemplates.map((t, i) => {
    // Check if tags are a string and convert them to an array
    const tagsArray = typeof t.tags === 'string' 
      ? t.tags.split(',').map(tag => tag.trim()).filter(Boolean) 
      : (t.tags || []); // Use existing array or default to empty

    return { ...t, tags: tagsArray, index: i };
  });
  
  // Save the properly formatted templates
  chrome.storage.local.set({ templates });
}

    document.body.className = currentTheme;
    elements.fetchBtn2.style.display = elements.promptArea.textContent ? "none" : "block";
    elements.clearPrompt.style.display = elements.promptArea.textContent ? "block" : "none";
    
    // Build tabs if there's content with placeholders
    if (elements.promptArea.textContent) {
      buildTabsFromTemplate(elements.promptArea.textContent);
    }
    
    loadTemplates();
    updateSaveButtonState(); // Update save button state on initial load
    if (result.placeholderTracker) {
      placeholderTracker = result.placeholderTracker;
    }
  });

  // Save popup state
  function saveState() {
    const state = {
      popupState: {
        name: elements.templateName.value,
        tags: elements.templateTags.value,
        content: extractContentWithSpanValues(), // Changed this line
        selectedName: selectedTemplateName,
        isTagsInEditMode: !elements.templateTags.classList.contains('hidden'),
        originalTags: originalTagsBeforeEdit,
      },
      theme: currentTheme,
      isFullscreen,
      extensionVersion: EXTENSION_VERSION,
      placeholderValues: tabsState.placeholderValues,
      placeholderTracker: placeholderTracker // Add this line
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
      content: elements.promptArea.textContent,
      selectedName: selectedTemplateName,
      isTagsInEditMode: !elements.templateTags.classList.contains('hidden'),
      originalTags: originalTagsBeforeEdit,
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
    return sanitizedTags;
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

// Real-time tags validation and state saving
elements.templateTags.addEventListener("input", debounce(() => {
    // This function will perform validation AND save the state.
    let value = elements.templateTags.value;
    if (value) {
        // Normalize input
        value = value.replace(/^[,\s]+/g, "").replace(/[\s]*,[,\s]*/g, ", ");
        value = value.replace(/\s+/g, " ");
        const tags = value.split(", ");
        
        // Validate tag count
        if (tags.length > 5) {
            showToast("Maximum of 5 tags allowed per template.", 3000, "red", [], "tagsLength");
            value = tags.slice(0, 5).join(", ");
        }
        
        // Validate tag length
        if (tags.some(tag => tag.length > 20)) {
            showToast("Each tag must be 20 characters or less.", 3000, "red", [], "tagLength");
        }
        const trimmedTags = tags.map(tag => tag.slice(0, 20));

        // Sanitize characters
        const sanitizedTags = trimmedTags.map(tag => tag.replace(/[^a-zA-Z0-9-_.@\s]/g, ""));
        if (sanitizedTags.some((tag, i) => tag !== trimmedTags[i])) {
            showToast("Each tag must contain only letters, numbers, underscores(_), hyphens(-), periods(.), at(@), or spaces.", 3000, "red", [], "tagChar");
        }
        
        // Update input value with sanitized tags
        elements.templateTags.value = sanitizedTags.join(", ");
    }
    
    // Save the current state (including tags) to local storage.
    saveState();

}, 100));

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
    elements.promptArea.textContent = `# Your Role
* 

# Background Information
* 

# Your Task
* `;
    selectedTemplateName = null;
    originalTagsBeforeEdit = null; 
    elements.fetchBtn2.style.display = "block";
    elements.clearPrompt.style.display = "none";
    elements.searchBox.value = "";
    updateSaveButtonState(); // Update save button state on close
    loadTemplates();
    saveState();
    chrome.runtime.sendMessage({ action: "closePopup" });
  });

 // UPDATED: newBtn listener
  elements.newBtn.addEventListener("click", () => {
    storeLastState(); // Store the previous state for undo

    // 1. Reset all variables and UI elements
    selectedTemplateName = null;
    originalTagsBeforeEdit = null; // Ensure no revert state on a new template
    elements.templateName.value = getDefaultTemplateName(); // (0008732)
    elements.templateTags.value = "";
    elements.promptArea.textContent = `# Your Role\n*\n\n# Background Information\n*\n\n# Your Task\n*`;
    
    // 2. Go to edit mode for tags
    switchToTagsEditMode();
    
    // 3. Update save button state for new template
    updateSaveButtonState();

    // 3. Update button visibility
    elements.fetchBtn2.style.display = "none";
    elements.clearPrompt.style.display = "block";
    elements.searchBox.value = "";
    
    // 4. IMPORTANT: Explicitly save a CLEARED state to storage
    const clearedState = {
      popupState: {
        name: "",
        tags: "",
        content: elements.promptArea.textContent,
        selectedName: null,
        isTagsInEditMode: true,
        originalTags: null
      }
    };
    chrome.storage.local.set(clearedState, () => {
        // 5. Now, refresh the templates list and show the toast
        loadTemplates();
        showToast("New template created.", 2000, "green", [], "new");
    });
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
    elements.promptArea.textContent = "";
    elements.fetchBtn2.style.display = "block";
    elements.clearPrompt.style.display = "none";
    // Hide tabs when prompt is cleared
    const tabsList = document.getElementById("editorTabs");
    tabsList.style.display = 'none';
    const promptArea = document.getElementById('promptArea');
    promptArea.style.height = 'calc(100vh - 320px)';
    saveState();
    showToast("Prompt cleared.", 2000, "green", [], "clearPrompt");
  });

  // Clear all
  elements.clearAllBtn.addEventListener("click", () => {
    storeLastState();
    elements.templateName.value = "";
    elements.templateTags.value = "";
    elements.promptArea.textContent = "";
    selectedTemplateName = null;
    originalTagsBeforeEdit = null; 
    switchToTagsEditMode(); 
    elements.fetchBtn2.style.display = "block";
    elements.clearPrompt.style.display = "none";
    elements.searchBox.value = "";
    // Hide tabs when clearing all
    const tabsList = document.getElementById("editorTabs");
    tabsList.style.display = 'none';
    const promptArea = document.getElementById('promptArea');
    promptArea.style.height = 'calc(100vh - 320px)';
    updateSaveButtonState(); // Update save button state on clear all
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

// --- PromptStash: Indentation with TAB/Shift+TAB (0008899) START ---
elements.promptArea.addEventListener("keydown", function (event) {
  if (event.key !== "Tab") return;
  
  event.preventDefault();
  
  const textarea = elements.promptArea;
  const { selectionStart: start, selectionEnd: end, value } = textarea;
  const INDENT_SIZE = 4;
  const INDENT_SPACES = " ".repeat(INDENT_SIZE);
  
  if (event.shiftKey) {
    // Shift+TAB: Unindent selected lines
    handleUnindent(textarea, start, end, value, INDENT_SIZE);
  } else {
    // TAB: Indent or insert spaces
    handleIndent(textarea, start, end, value, INDENT_SPACES);
  }
  
  saveState?.();
});
// --- PromptStash: Indentation with TAB/Shift+TAB (0008899) END ---

  // Control fetchBtn2 visibility on input and rebuild tabs
  const promptInputHandler = () => {
    storeLastState();
    elements.fetchBtn2.style.display = elements.promptArea.textContent ? "none" : "block";
    elements.clearPrompt.style.display = elements.promptArea.textContent ? "block" : "none";
    
    // Only rebuild tabs if placeholders have actually changed
    if (elements.promptArea.textContent.trim()) {
      // Check if we're currently in preview mode (template has replaced placeholders)
      const hasPlaceholderValues = Object.keys(tabsState.placeholderValues || {}).some(key => 
        tabsState.placeholderValues[key] && tabsState.placeholderValues[key].trim() !== ''
      );
      
      // If we have placeholder values, we need to restore original template before parsing
      let contentToCheck = elements.promptArea.textContent;
      if (hasPlaceholderValues && tabsState.currentTemplate) {
        // Use the original template for placeholder detection
        contentToCheck = tabsState.currentTemplate;
      }
      
      const currentPlaceholders = parsePlaceholders(contentToCheck);
      const existingPlaceholders = tabsState.placeholders || [];
      
      // Only rebuild if placeholders are different
      if (JSON.stringify(currentPlaceholders) !== JSON.stringify(existingPlaceholders)) {
        // Update the original template and rebuild tabs
        tabsState.currentTemplate = contentToCheck;
        buildTabsFromTemplate(contentToCheck);
      } else {
        // Just update the stored template content without rebuilding
        if (!hasPlaceholderValues) {
          tabsState.currentTemplate = elements.promptArea.textContent;
        }
      }
    } else {
      // Hide tabs when no content but preserve placeholder values
      const tabsList = document.getElementById("editorTabs");
      tabsList.style.display = 'none';
      const promptArea = document.getElementById('promptArea');
      promptArea.style.height = 'calc(100vh - 320px)';
      // Don't clear placeholder values - they should persist
    }
    
    saveState();
  };
  
// Replace the existing prompt input handler after initialization
elements.promptArea.removeEventListener("input", promptInputHandler);
elements.promptArea.addEventListener("input", enhancedPromptInputHandler);

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
      
      // Check if current template has placeholders and update tabs
      const currentContent = elements.promptArea.textContent;
      if (currentContent) {
        buildTabsFromTemplate(currentContent);
      } else {
        // No content, hide tabs
        const tabsList = document.getElementById("editorTabs");
        tabsList.style.display = 'none';
        const promptArea = document.getElementById('promptArea');
        promptArea.style.height = 'calc(100vh - 320px)';
      }
      elements.dropdownResults.innerHTML = "";
      elements.favoriteSuggestions.innerHTML = "";

      if (query) {
        // We now check if the `tags` property is an array and search inside it.
        // This is much more reliable than searching a comma-separated string.
        templates = templates.filter((t) => {
          const nameMatch = t.name.toLowerCase().includes(query);
          // Check if t.tags is an array and if any tag in it includes the query
          const tagMatch = Array.isArray(t.tags) && t.tags.some((tag) => tag.toLowerCase().includes(query));
          return nameMatch || tagMatch;
        });
        templates.sort((a, b) => {
          const aMatch = a.name.toLowerCase().indexOf(query) + (Array.isArray(a.tags)? a.tags.join(" ").toLowerCase().indexOf(query): -1);
          const bMatch = b.name.toLowerCase().indexOf(query) +(Array.isArray(b.tags)? b.tags.join(" ").toLowerCase().indexOf(query): -1);
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
        if (templates.length === 0) {
          elements.searchOverlay.style.display = "block";
          elements.dropdownResults.style.display = "block";
          elements.dropdownResults.classList.add("show");
          const noResultsDiv = document.createElement("div");
          noResultsDiv.className = "no-results-found text-center py-2 text-muted";
          // (Removed JS inline centering styles; now handled by CSS)
          noResultsDiv.setAttribute("role", "alert");
          noResultsDiv.setAttribute("aria-live", "polite");
          noResultsDiv.textContent = "No results found";
          elements.dropdownResults.appendChild(noResultsDiv);
        }else{
          templates.forEach((tmpl, idx) => {
            const div = document.createElement("div");
            // We join the array to create a readable string for the dropdown list.
          const tagsString = Array.isArray(tmpl.tags) ? tmpl.tags.join(", "): "";
          div.textContent = tagsString ? `${tmpl.name} (${tagsString})`: `${tmpl.name}`;
            div.setAttribute("role", "option");
            div.setAttribute("aria-selected", selectedTemplateName === tmpl.name);
            elements.searchOverlay.style.display = 'block';
            elements.dropdownResults.style.display = 'block';
            elements.dropdownResults.classList.add("show");
  
          div.addEventListener("click", (event) => {
              if (!event.target.classList.contains("favorite-toggle")) {
                selectedTemplateName = tmpl.name;
                elements.templateName.value = tmpl.name;
  
              // Get the tags as an array (or an empty one if they don't exist)
              const tagsArray = Array.isArray(tmpl.tags) ? tmpl.tags : [];
              // Set the input field's value for editing
              elements.templateTags.value = tagsArray.join(", ");
              // RENDER THE CLICKABLE TAGS! This is the new function call.
              switchToTagsViewMode();

                elements.promptArea.textContent = tmpl.content;
                // Build tabs from template placeholders
                buildTabsFromTemplate(tmpl.content);
                
                elements.searchBox.value = "";
                elements.dropdownResults.innerHTML = "";
                elements.fetchBtn2.style.display = tmpl.content ? "none" : "block";
                elements.clearPrompt.style.display = tmpl.content ? "block" : "none";
                elements.searchOverlay.style.display = 'none';
                elements.dropdownResults.style.display = 'none';
                elements.dropdownResults.classList.remove("show");
                updateSaveButtonState(); // Update save button state
                saveState();
                elements.promptArea.focus();
                updateExportSingleBtnState();
            }
            });
            div.innerHTML += `<button class="favorite-toggle ${tmpl.favorite ? 'favorited' : 'unfavorited'}" data-name="${tmpl.name}" aria-label="${tmpl.favorite ? 'Unfavorite' : 'Favorite'} template">${tmpl.favorite ? '★' : '☆'}</button>`;
            elements.dropdownResults.appendChild(div);
          });
        }

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
            // Get the tags as an array
            const tagsArray = Array.isArray(tmpl.tags) ? tmpl.tags : [];
            // Set the input field's value
            elements.templateTags.value = tagsArray.join(", ");
            // Render the clickable tags
            switchToTagsViewMode();
            elements.promptArea.textContent = tmpl.content;
            
            // Build tabs from template placeholders
            buildTabsFromTemplate(tmpl.content);
            
            elements.searchBox.value = "";
            elements.fetchBtn2.style.display = tmpl.content ? "none" : "block";
            elements.clearPrompt.style.display = tmpl.content ? "block" : "none";
            updateSaveButtonState(); // Update save button state
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
      // Always update the export single button state after loading templates
      updateExportSingleBtnState();
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
      const content = elements.promptArea.textContent;

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
        
        // --- THIS IS THE FIX ---
        // We must convert the tag arrays to strings to compare them correctly.
        const currentTagsString = (sanitizeTags(elements.templateTags.value) || []).join(',');
        const savedTagsString = (template.tags || []).join(',');
      
        const isEdited = elements.templateName.value !== template.name ||
                        currentTagsString !== savedTagsString || // <-- THE CORRECTED COMPARISON
                        elements.promptArea.textContent !== template.content;
      
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
            switchToTagsViewMode();
            updateExportSingleBtnState(); // Export single template
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
            switchToTagsViewMode();
            updateExportSingleBtnState(); // Export single template
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
      const hasContentChanges = isEditing && elements.promptArea.textContent !== templates.find(t => t.name === selectedTemplateName)?.content;
      const hasTagChanges = isEditing && sanitizeTags(elements.templateTags.value) !== templates.find(t => t.name === selectedTemplateName)?.tags;

      const getTemplateMessageWithIcons = () => {
        const action = isEditing ? "Overwrite" : "Save";
        
        if (noTags) {
          return `⚠️ No tags added ${action} template?`;
        }
        
        if (isRenamed || hasContentChanges || hasTagChanges) {
          return `✏️ Template modified ${action} changes?`;
        }
        
        return `💾 ${action} template?`;
      };

      const message = getTemplateMessageWithIcons()

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
      const content = elements.promptArea.textContent;

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
        content: elements.promptArea.textContent,
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
        switchToTagsViewMode();
        updateExportSingleBtnState(); // Export single template
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
              elements.promptArea.textContent = response.prompt;
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
          prompt: elements.promptArea.textContent
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
                  originalTagsBeforeEdit = null; 
                  elements.templateName.value = getDefaultTemplateName(); // (0008732)
                  elements.templateTags.value = "";
                  switchToTagsEditMode();
                  elements.promptArea.textContent = `# Your Role
* 

# Background Information
* 

# Your Task
* `;
                  elements.searchBox.value = "";
                  elements.fetchBtn2.style.display = "block";
                  elements.clearPrompt.style.display = "none";
                  updateSaveButtonState(); // Update save button state after delete
                  loadTemplates();
                  updateExportSingleBtnState(); // Export single template
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
      elements.promptArea.textContent = lastState.content || "";
      selectedTemplateName = lastState.selectedName || null;
      
      // Restore the tag UI state from the last state
      originalTagsBeforeEdit = lastState.originalTags || null;
      
      // Update save button state after undo
      updateSaveButtonState();

      // Restore the full template list if it was part of the action
      if (lastState.templates) {
        chrome.storage.local.set({ templates: lastState.templates }, () => {
          loadTemplates();
        });
        showToast("Action undone successfully.", 2000, "green", [], "undo");
      }
      elements.fetchBtn2.style.display = elements.promptArea.textContent ? "none" : "block";
      elements.clearPrompt.style.display = elements.promptArea.textContent ? "block" : "none";

      // Set the correct tag UI mode based on the restored state
      if (lastState.isTagsInEditMode) {
        switchToTagsEditMode();
      } else {
        switchToTagsViewMode();
      }
      
      // Clear the last state so it can't be used again
      lastState = null;
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
  initializeEnhancedPlaceholderSystem();

});