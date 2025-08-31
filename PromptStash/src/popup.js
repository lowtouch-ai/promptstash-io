import jsyaml from "js-yaml";
import defaultTemplates from './defaultTemplates.mjs';

const EXTENSION_VERSION = "1.1.0";

// --- Utility Functions ---

function debounce(func, wait) {
    let timeout;
    return function (...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
    };
}

function getDefaultTemplateName() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    const hours = String(now.getHours()).padStart(2, "0");
    const minutes = String(now.getMinutes()).padStart(2, "0");
    return `Stash @ ${year}-${month}-${day} ${hours}-${minutes}`;
}

function promptsToYAML(prompts) {
    return jsyaml.dump(prompts);
}

function downloadFile(data, filename, mimeType) {
    const blob = new Blob([data], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }, 100);
}

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

function sanitizeTags(input) {
    if (!input) return [];
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

function parsePlaceholders(templateContent) {
    const placeholderRegex = /\{\{([^}]+)\}\}/g;
    const placeholders = [];
    const placeholderPositions = new Map();
    let match;

    const allowedPlaceholders = extractAllowedPlaceholdersFromDefaults();
    while ((match = placeholderRegex.exec(templateContent)) !== null) {
        const placeholder = match[1].trim();
        if (allowedPlaceholders.includes(placeholder)) {
            if (!placeholders.includes(placeholder)) {
                placeholders.push(placeholder);
            }
            if (!placeholderPositions.has(placeholder)) {
                placeholderPositions.set(placeholder, []);
            }
            placeholderPositions.get(placeholder).push({
                start: match.index,
                end: match.index + match[0].length,
                original: match[0]
            });
        }
    }
    return { placeholders, placeholderPositions };
}

function findTextNodeAndOffset(container, charOffset) {
    const walker = document.createTreeWalker(
        container,
        NodeFilter.SHOW_TEXT,
        null,
        false
    );
    let currentPos = 0;
    let node = walker.nextNode();
    while (node) {
        const nodeLength = node.textContent.length;
        if (currentPos + nodeLength >= charOffset) {
            return { node, offset: charOffset - currentPos };
        }
        currentPos += nodeLength;
        node = walker.nextNode();
    }
    return { node: container, offset: container.textContent.length };
}

function hasUnsavedChanges() {
    if (!selectedTemplateName) {
        // For new templates, check if there's any meaningful content
        const hasName = elements.templateName.value.trim() !== getDefaultTemplateName();
        const hasTags = elements.templateTags.value.trim() !== "";
        const hasContent = elements.promptArea.textContent.trim() !== `# Your Role\n*\n\n# Background Information\n*\n\n# Your Task\n*`;
        const hasPlaceholderValues = Object.values(tabsState.placeholderValues).some(value => value.trim() !== "");
        
        return hasName || hasTags || hasContent || hasPlaceholderValues;
    }

    // For existing templates, compare with stored version
    return new Promise((resolve) => {
        chrome.storage.local.get(["templates"], (result) => {
            const templates = result.templates || [];
            const currentTemplate = templates.find(t => t.name === selectedTemplateName);
            
            if (!currentTemplate) {
                resolve(true); // Template was deleted externally
                return;
            }

            const nameChanged = elements.templateName.value.trim() !== currentTemplate.name;
            const tagsChanged = elements.templateTags.value !== (Array.isArray(currentTemplate.tags) ? currentTemplate.tags.join(", ") : "");
            const contentChanged = elements.promptArea.textContent !== currentTemplate.content;
            
            resolve(nameChanged || tagsChanged || contentChanged);
        });
    });
}

// --- Global State and DOM Elements ---

let selectedTemplateName = null;
let currentTheme = "light";
let lastState = null;
let nextIndex = 0;
let isFullscreen = false;
let recentIndices = [];
let originalTagsBeforeEdit = null;
let isUpdatingContent = false;
let toastQueue = [];
let isToastShowing = false;
let autoHideTimeout = null;
let outsideClickListener = null;
let currentOperationId = null;
let nextToastTimeout = null;
const toastTimestamps = {};

const elements = {};
const ALLOWED_PLACEHOLDERS = [];
const tabsState = {
    placeholders: [],
    placeholderValues: {},
    currentTemplate: ""
};

// --- Initialization and Core Logic ---

document.addEventListener("DOMContentLoaded", () => {
    ['searchBox', 'dropdownResults', 'template', 'templateName', 'templateTags', 'tagsDisplay', 'tagsView', 'editTagsBtn', 'cancelTagsEditBtn',
     'promptArea', 'buttons', 'fetchBtn', 'fetchBtn2', 'saveBtn', 'saveAsBtn', 'deleteBtn', 'clearSearch', 'clearPrompt',
     'clearAllBtn', 'sendBtn', 'favoriteSuggestions', 'fullscreenToggle', 'closeBtn', 'newBtn', 'searchOverlay',
     'toastOverlay', 'toast', 'themeToggle', 'importBtn', 'importFileInput', 'exportAllBtn', 'exportSingleBtn', 'scroll-left-btn', 'scroll-right-btn'].forEach(id => {
        elements[id] = document.getElementById(id);
    });

    const missingElements = Object.entries(elements).filter(([key, value]) => !value).map(([key]) => key);
    if (missingElements.length > 0) {
        showToast("Error: Extension UI failed to load. Please reload the extension.", 3000, "red", [], "init");
    } else {
        initializeState();
        setupEventListeners();
        initializeTooltips();
        loadTemplates();
        updateExportSingleBtnState();
    }
});

function initializeState() {
    // Initialize allowed placeholders from default templates
    ALLOWED_PLACEHOLDERS.push(...extractAllowedPlaceholdersFromDefaults());

    chrome.storage.local.get(["popupState", "theme", "extensionVersion", "recentIndices", "templates", "nextIndex", "isFullscreen", "placeholderValues"], (result) => {
        const storedVersion = result.extensionVersion || "0.0.0";
        if (storedVersion !== EXTENSION_VERSION) {
            chrome.storage.local.set({ extensionVersion: EXTENSION_VERSION });
        }

        currentTheme = result.theme || "light";
        document.body.className = currentTheme;

        nextIndex = result.nextIndex || defaultTemplates.length;
        recentIndices = result.recentIndices || [];
        isFullscreen = result.isFullscreen || false;
        elements.fullscreenToggle.querySelector("svg use").setAttribute("href", isFullscreen ? "sprite.svg#compress" : "sprite.svg#fullscreen");

        const state = result.popupState || {};
        originalTagsBeforeEdit = state.originalTags || null;
        const isTagsInEditMode = state.isTagsInEditMode === undefined ? true : state.isTagsInEditMode;

        const defaultText = `# Your Role\n*\n\n# Background Information\n*\n\n# Your Task\n*`;
        selectedTemplateName = state.selectedName || null;
        
        // If we have a selected template, use its name, otherwise use saved name or default
        if (selectedTemplateName) {
            elements.templateName.value = selectedTemplateName;
        } else {
            elements.templateName.value = state.name || getDefaultTemplateName();
        }
        
        elements.templateTags.value = state.tags || "";
        tabsState.currentTemplate = state.content || defaultText;
        elements.promptArea.textContent = tabsState.currentTemplate;
        tabsState.placeholderValues = result.placeholderValues || {};

        if (!isTagsInEditMode && (state.tags || selectedTemplateName)) {
            switchToTagsViewMode();
        } else {
            switchToTagsEditMode();
        }

        elements.fetchBtn2.style.display = elements.promptArea.textContent ? "none" : "block";
        elements.clearPrompt.style.display = elements.promptArea.textContent ? "block" : "none";

        if (tabsState.currentTemplate) {
            buildTabsFromTemplate(tabsState.currentTemplate);
            renderPlaceholdersInTemplate(); // Re-render placeholders with saved values
        }

        updateSaveButtonState();
        updateDeleteButtonState();
        updateExportSingleBtnState();

        let templates = result.templates;
        if (!templates) {
            templates = defaultTemplates.map((t, i) => {
                // Check if tags are a string and convert them to an array
                const tagsArray = typeof t.tags === 'string'
                    ? t.tags.split(',').map(tag => tag.trim()).filter(Boolean)
                    : (t.tags || []); // Use existing array or default to empty

                return { ...t, tags: tagsArray, index: i };
            });
            chrome.storage.local.set({ templates });
        }
    });
}
function setupEventListeners() {
    elements.templateTags.addEventListener("input", debounce(() => {
        validateTagsInput();
        saveState();
      }, 100));
    elements.searchBox.addEventListener("focus", () => loadTemplates(elements.searchBox.value.toLowerCase(), true));
    elements.searchBox.addEventListener("input", () => {
        loadTemplates(elements.searchBox.value.toLowerCase(), true);
        elements.clearSearch.style.display = elements.searchBox.value ? "block" : "none";
    });
    elements.clearSearch.addEventListener("click", () => {
        elements.searchBox.value = "";
        elements.clearSearch.style.display = "none";
        loadTemplates();
        elements.searchBox.focus();
    });
    elements.clearPrompt.addEventListener("click", () => {
        storeLastState();
        elements.promptArea.textContent = "";
        elements.fetchBtn2.style.display = "block";
        elements.clearPrompt.style.display = "none";
        destroyTabs();
        saveState();
        showToast("Prompt cleared.", 2000, "green", [], "clearPrompt");
    });
    elements.clearAllBtn.addEventListener("click", () => {
        storeLastState();
        elements.templateName.value = "";
        elements.templateTags.value = "";
        tabsState.currentTemplate = template.content;
        elements.promptArea.textContent = template.content;
        selectedTemplateName = template.name;
        originalTagsBeforeEdit = null;
        switchToTagsEditMode();
        destroyTabs();
        buildTabsFromTemplate(tabsState.currentTemplate);
        elements.fetchBtn2.style.display = "block";
        elements.clearPrompt.style.display = "none";
        elements.searchBox.value = "";
        updateExportSingleBtnState()
        updateSaveButtonState();
        updateDeleteButtonState();
        saveState();
        showToast("All fields cleared.", 2000, "green", [], "clearAll");
    });
    elements.themeToggle.addEventListener("click", () => {
        currentTheme = currentTheme === "light" ? "dark" : "light";
        document.body.className = currentTheme;
        saveState();
    });
    elements.fullscreenToggle.addEventListener("click", () => {
        isFullscreen = !isFullscreen;
        saveState();
        elements.fullscreenToggle.querySelector("svg use").setAttribute("href", isFullscreen ? "sprite.svg#compress" : "sprite.svg#fullscreen");
        chrome.runtime.sendMessage({ action: "toggleFullscreen" });
    });
    elements.closeBtn.addEventListener("click", handleCloseWithUnsavedCheck);
    elements.newBtn.addEventListener("click", () => handleNewTemplate());
    elements.editTagsBtn.addEventListener("click", () => handleEditTags());
    elements.cancelTagsEditBtn.addEventListener("click", () => handleCancelTagsEdit());

    elements.templateName.addEventListener("input", debounce(() => {
        validateTemplateNameInput();
        updateExportSingleBtnState();
        saveState();
    }, 10));
    elements.templateTags.addEventListener("input", debounce(() => {
        validateTagsInput();
        saveState();
    }, 100));
    elements.promptArea.addEventListener("input", handlePromptInput);
    elements.promptArea.addEventListener("keydown", handlePromptKeydown);
    elements.promptArea.addEventListener("paste", handlePaste);

    elements.saveBtn.addEventListener("click", () => handleSaveTemplate());
    elements.saveAsBtn.addEventListener("click", () => handleSaveAsTemplate());
    elements.deleteBtn.addEventListener("click", () => handleDeleteTemplate());
    elements.fetchBtn.addEventListener("click", () => handleFetchPrompt());
    elements.fetchBtn2.addEventListener("click", () => handleFetchPrompt());
    elements.sendBtn.addEventListener("click", () => handleSendPrompt());
    elements.importBtn.addEventListener("click", () => elements.importFileInput.click());
    elements.importFileInput.addEventListener("change", (event) => handleImportFile(event));
    elements.exportAllBtn.addEventListener("click", () => handleExportAll());
    elements.exportSingleBtn.addEventListener("click", () => handleExportSingle());
    document.addEventListener("click", (event) => handleGlobalClick(event));
    document.addEventListener("keydown", (event) => handleGlobalKeydown(event));

    setupTabSlider();
}

// --- UI State Management Functions ---

function updateExportSingleBtnState() {
    const name = elements.templateName.value.trim();
    const btn = elements.exportSingleBtn;
    const hasSelectedTemplate = selectedTemplateName !== null; // Check if we have a saved template selected

    if (name && hasSelectedTemplate) {
        btn.style.display = ""; // Show the button only for saved templates
        btn.disabled = false;
        btn.setAttribute("aria-disabled", "false");
    } else {
        btn.style.display = "none"; // Hide the button for unsaved templates
        btn.disabled = true;
        btn.setAttribute("aria-disabled", "true");
    }
}

function updateClearButtonState() {
    const hasContent = elements.promptArea.textContent.trim();
    const hasTabs = tabsState.placeholders.length > 0;
    
    if (hasTabs) {
        // Hide clear button when tabs/placeholders exist
        elements.clearPrompt.style.display = "none";
    } else {
        // Show clear button only when no tabs and content exists
        elements.clearPrompt.style.display = hasContent ? "block" : "none";
    }
}

function updateSaveButtonState() {
    const saveButtonWrapper = elements.saveBtn.parentElement;
    let tooltip = bootstrap.Tooltip.getInstance(saveButtonWrapper);

    if (!selectedTemplateName) {
        elements.saveBtn.disabled = false;
        elements.saveBtn.style.pointerEvents = 'auto';
        
        // Remove tooltip from wrapper if it exists
        if (tooltip) {
            tooltip.dispose();
        }
        
        // Add tooltip to button
        tooltip = bootstrap.Tooltip.getInstance(elements.saveBtn);
        if (!tooltip) {
            new bootstrap.Tooltip(elements.saveBtn, {
                title: 'Save changes to template'
            });
        } else {
            tooltip.setContent({ '.tooltip-inner': 'Save changes to template' });
        }
        
        saveButtonWrapper.classList.remove('disabled-wrapper');
        return;
    }

    chrome.storage.local.get(["templates"], (result) => {
        const templates = result.templates || [];
        const currentTemplate = templates.find(t => t.name === selectedTemplateName);
        const isPreBuilt = currentTemplate && currentTemplate.type === "pre-built";
        
        if (isPreBuilt) {
            elements.saveBtn.disabled = true;
            elements.saveBtn.style.pointerEvents = 'none';
            
            // Remove tooltip from button
            const buttonTooltip = bootstrap.Tooltip.getInstance(elements.saveBtn);
            if (buttonTooltip) {
                buttonTooltip.dispose();
            }
            
            // Add tooltip to wrapper
            if (!tooltip) {
                tooltip = new bootstrap.Tooltip(saveButtonWrapper, {
                    title: 'Cannot save default templates. Use "Save As" to create a copy.'
                });
            } else {
                tooltip.setContent({ '.tooltip-inner': 'Cannot save default templates. Use "Save As" to create a copy.' });
            }
            
            saveButtonWrapper.classList.add('disabled-wrapper');
        } else {
            elements.saveBtn.disabled = false;
            elements.saveBtn.style.pointerEvents = 'auto';
            
            // Remove tooltip from wrapper
            if (tooltip) {
                tooltip.dispose();
            }
            
            // Add tooltip to button
            const buttonTooltip = bootstrap.Tooltip.getInstance(elements.saveBtn);
            if (!buttonTooltip) {
                new bootstrap.Tooltip(elements.saveBtn, {
                    title: 'Save changes to template'
                });
            } else {
                buttonTooltip.setContent({ '.tooltip-inner': 'Save changes to template' });
            }
            
            saveButtonWrapper.classList.remove('disabled-wrapper');
        }
    });
}

function updateDeleteButtonState() {
    const deleteButtonWrapper = elements.deleteBtn.parentElement;
    let tooltip = bootstrap.Tooltip.getInstance(deleteButtonWrapper);

    if (!selectedTemplateName) {
        elements.deleteBtn.disabled = true;
        elements.deleteBtn.style.pointerEvents = 'none';
        
        // Remove tooltip from button if it exists
        const buttonTooltip = bootstrap.Tooltip.getInstance(elements.deleteBtn);
        if (buttonTooltip) {
            buttonTooltip.dispose();
        }
        
        // Add tooltip to wrapper
        if (!tooltip) {
            tooltip = new bootstrap.Tooltip(deleteButtonWrapper, {
                title: 'No template selected to delete.'
            });
        } else {
            tooltip.setContent({ '.tooltip-inner': 'No template selected to delete.' });
        }
        
        deleteButtonWrapper.classList.add('disabled-wrapper');
        return;
    }

    chrome.storage.local.get(["templates"], (result) => {
        const templates = result.templates || [];
        const currentTemplate = templates.find(t => t.name === selectedTemplateName);
        const isPreBuilt = currentTemplate && currentTemplate.type === "pre-built";
        
        if (isPreBuilt) {
            elements.deleteBtn.disabled = true;
            elements.deleteBtn.style.pointerEvents = 'none';
            
            // Remove tooltip from button
            const buttonTooltip = bootstrap.Tooltip.getInstance(elements.deleteBtn);
            if (buttonTooltip) {
                buttonTooltip.dispose();
            }
            
            // Add tooltip to wrapper
            if (!tooltip) {
                tooltip = new bootstrap.Tooltip(deleteButtonWrapper, {
                    title: 'Cannot delete a default template.'
                });
            } else {
                tooltip.setContent({ '.tooltip-inner': 'Cannot delete a default template.' });
            }
            
            deleteButtonWrapper.classList.add('disabled-wrapper');
        } else {
            elements.deleteBtn.disabled = false;
            elements.deleteBtn.style.pointerEvents = 'auto';
            
            // Remove tooltip from wrapper
            if (tooltip) {
                tooltip.dispose();
            }
            
            // Add tooltip to button
            const buttonTooltip = bootstrap.Tooltip.getInstance(elements.deleteBtn);
            if (!buttonTooltip) {
                new bootstrap.Tooltip(elements.deleteBtn, {
                    title: 'Delete this template.'
                });
            } else {
                buttonTooltip.setContent({ '.tooltip-inner': 'Delete this template.' });
            }
            
            deleteButtonWrapper.classList.remove('disabled-wrapper');
        }
    });
}

function switchToTagsViewMode() {
    const tagsArray = elements.templateTags.value.split(",").map(t => t.trim()).filter(Boolean);
    if (tagsArray.length === 0) {
        originalTagsBeforeEdit = null;
        switchToTagsEditMode(false);
        return;
    }
    elements.tagsDisplay.innerHTML = "";
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
    elements.tagsView.classList.remove("hidden");
    elements.editTagsBtn.classList.remove("hidden");
    elements.templateTags.classList.add("hidden");
    elements.cancelTagsEditBtn.classList.add("hidden");
    originalTagsBeforeEdit = null;
    saveState();
}

function switchToTagsEditMode(setFocus = false) {
    elements.tagsView.classList.add("hidden");
    elements.editTagsBtn.classList.add("hidden");
    elements.templateTags.classList.remove("hidden");
    elements.cancelTagsEditBtn.classList.toggle("hidden", originalTagsBeforeEdit === null);
    if (setFocus) {
        elements.templateTags.focus();
    }
    saveState();
}

function saveState() {
    const state = {
        popupState: {
            name: elements.templateName.value,
            tags: elements.templateTags.value,
            content: tabsState.currentTemplate, // Save the raw template content
            selectedName: selectedTemplateName,
            isTagsInEditMode: !elements.templateTags.classList.contains('hidden'),
            originalTags: originalTagsBeforeEdit,
        },
        theme: currentTheme,
        isFullscreen,
        extensionVersion: EXTENSION_VERSION,
        placeholderValues: tabsState.placeholderValues
    };
    chrome.storage.local.set(state);
}

function storeLastState() {
    lastState = {
        name: elements.templateName.value,
        tags: elements.templateTags.value,
        content: elements.promptArea.textContent,
        selectedName: selectedTemplateName,
        isTagsInEditMode: !elements.templateTags.classList.contains('hidden'),
        originalTags: originalTagsBeforeEdit,
        templates: null
    };
}

// --- Toast Notification System ---

function showToast(message, duration = 4000, type = "red", buttons = [], operationId) {
    const toastKey = `${message}|${operationId}`;
    const now = Date.now();
    if (buttons.length === 0 && toastTimestamps[toastKey] && now - toastTimestamps[toastKey] < 1010) {
        return;
    }
    toastTimestamps[toastKey] = now;
    if (operationId !== currentOperationId) {
        if (isToastShowing) {
            closeToast();
        }
        toastQueue = [];
        currentOperationId = operationId;
    }
    if (operationId === currentOperationId) {
        toastQueue.push({ message, duration, type, buttons, operationId });
        if (!isToastShowing) {
            displayNextToast();
        }
    }
}

function closeToast(onClose) {
    clearTimeout(autoHideTimeout);
    autoHideTimeout = null;
    clearTimeout(nextToastTimeout);
    if (outsideClickListener) {
        document.removeEventListener("click", outsideClickListener);
        outsideClickListener = null;
    }
    elements.toast.classList.remove("show");
    elements.toast.classList.add("hide");
    elements.toastOverlay.style.display = "none";
    setTimeout(() => {
        elements.toast.classList.remove("hide");
        elements.toast.innerHTML = "";
        isToastShowing = false;
        if (onClose) onClose();
        nextToastTimeout = setTimeout(displayNextToast, 10);
    }, 10);
}

function displayNextToast() {
    if (toastQueue.length === 0) {
        isToastShowing = false;
        return;
    }
    clearTimeout(autoHideTimeout);
    isToastShowing = true;
    const { message, duration, type, buttons } = toastQueue.shift();
    elements.toast.innerHTML = message;

    const closeBtn = document.createElement("button");
    closeBtn.textContent = "×";
    closeBtn.className = "toast-close-btn";
    closeBtn.setAttribute("aria-label", "Close toast");
    closeBtn.addEventListener("click", (event) => {
        event.stopPropagation();
        closeToast();
    });
    elements.toast.appendChild(closeBtn);

    if (buttons.length > 0) {
        const buttonContainer = document.createElement("div");
        buttonContainer.className = "toast-button-container";
        buttons.forEach(({ text, callback }) => {
            const btn = document.createElement("button");
            btn.textContent = text;
            btn.className = "toast-action-btn";
            btn.setAttribute("aria-label", text === "Yes" ? "Confirm action" : "Cancel action");
            btn.addEventListener("click", (event) => {
                event.stopPropagation();
                closeToast(callback);
            });
            buttonContainer.appendChild(btn);
        });
        elements.toast.appendChild(buttonContainer);
        elements.toastOverlay.style.display = "block";
        outsideClickListener = (event) => {
            if (!elements.toast.contains(event.target)) {
                closeToast(buttons.find(b => b.text === "No")?.callback);
            }
        };
        setTimeout(() => document.addEventListener("click", outsideClickListener), 50);
    } else {
        autoHideTimeout = setTimeout(() => closeToast(), duration);
    }
    elements.toast.className = `toast ${type} ${buttons.length > 0 ? 'confirmation' : ''}`;
    elements.toast.classList.add("show");
}

// --- Template and Data Management ---

function saveTemplates(templates, callback, isNewTemplate) {
    const timeout = setTimeout(() => {
        showToast("Operation timed out. Please try again.", 5000, "red", [], "save");
    }, 5000);
    chrome.storage.local.set({ templates }, () => {
        clearTimeout(timeout);
        if (chrome.runtime.lastError) {
            const msg = chrome.runtime.lastError.message.includes("QUOTA") ? "Storage limit exceeded." : "Failed to save.";
            showToast(msg, 5000, "red", [], "save");
            console.error("Local storage error:", chrome.runtime.lastError.message);
        } else {
            showToast(isNewTemplate ? "Template saved. Press Ctrl+Z to undo." : "Template updated. Press Ctrl+Z to undo.", 3000, "green", [], "save");
            callback();
            chrome.storage.local.get(null, (items) => {
                const totalSizeInBytes = new TextEncoder().encode(JSON.stringify(items)).length;
                if (totalSizeInBytes > 0.9 * (10 * 1024 * 1024)) {
                    showToast("Warning: Storage is nearly full.", 5000, "red", [], "save");
                }
            });
        }
    });
}

function loadTemplates(query = "", showDropdown = false) {
    chrome.storage.local.get(["templates"], (result) => {
        let templates = result.templates || defaultTemplates.map((t, i) => ({ ...t, index: i }));
        if (query) {
            templates = templates.filter(t => t.name.toLowerCase().includes(query) || (Array.isArray(t.tags) && t.tags.some(tag => tag.toLowerCase().includes(query))));
            templates.sort((a, b) => (a.name.toLowerCase().indexOf(query) + (Array.isArray(a.tags) ? a.tags.join(" ").toLowerCase().indexOf(query) : -1)) - (b.name.toLowerCase().indexOf(query) + (Array.isArray(b.tags) ? b.tags.join(" ").toLowerCase().indexOf(query) : -1)));
        } else {
            templates.sort((a, b) => {
                const [aIndex, bIndex] = [recentIndices.indexOf(a.index), recentIndices.indexOf(b.index)];
                if (aIndex === -1 && bIndex === -1) return a.name.localeCompare(b.name);
                if (aIndex === -1) return 1;
                if (bIndex === -1) return -1;
                return aIndex - bIndex;
            });
        }
        renderDropdown(templates, showDropdown);
        renderFavoriteSuggestions(templates.filter(t => t.favorite));
    });
}

function renderDropdown(templates, showDropdown) {
    elements.dropdownResults.innerHTML = "";
    if (!showDropdown) return;
    elements.searchOverlay.style.display = "block";
    elements.dropdownResults.style.display = "block";
    elements.dropdownResults.classList.add("show");
    if (templates.length === 0) {
        const noResultsDiv = document.createElement("div");
        noResultsDiv.className = "no-results-found text-center py-2 text-muted";
        noResultsDiv.textContent = "No results found";
        elements.dropdownResults.appendChild(noResultsDiv);
        return;
    }
    templates.forEach((tmpl) => {
        const div = document.createElement("div");
        const tagsString = Array.isArray(tmpl.tags) ? tmpl.tags.join(", ") : "";
        div.textContent = tagsString ? `${tmpl.name} (${tagsString})` : `${tmpl.name}`;
        div.setAttribute("role", "option");
        div.setAttribute("aria-selected", selectedTemplateName === tmpl.name);
        div.addEventListener("click", () => loadTemplateFromSelection(tmpl));
        div.innerHTML += `<button class="favorite-toggle ${tmpl.favorite ? 'favorited' : 'unfavorited'}" data-name="${tmpl.name}" aria-label="${tmpl.favorite ? 'Unfavorite' : 'Favorite'} template">${tmpl.favorite ? '★' : '☆'}</button>`;
        elements.dropdownResults.appendChild(div);
    });
}

function renderFavoriteSuggestions(favorites) {
    elements.favoriteSuggestions.innerHTML = "";
    if (favorites.length > 0) {
        elements.favoriteSuggestions.classList.remove("d-none");
        favorites.forEach((tmpl) => {
            const span = document.createElement("span");
            span.textContent = tmpl.name;
            span.className = "favorite-suggestion";
            span.setAttribute("role", "button");
            span.setAttribute("tabindex", "0");
            span.addEventListener("click", () => loadTemplateFromSelection(tmpl));
            span.addEventListener("keydown", (e) => {
                if (e.key === "Enter" || e.key === " ") span.click();
            });
            elements.favoriteSuggestions.appendChild(span);
        });
    } else {
        elements.favoriteSuggestions.classList.add("d-none");
    }
}

function loadTemplateFromSelection(tmpl) {
    selectedTemplateName = tmpl.name;
    elements.templateName.value = tmpl.name;
    updateExportSingleBtnState();
    const tagsArray = Array.isArray(tmpl.tags) ? tmpl.tags : [];
    elements.templateTags.value = tagsArray.join(", ");
    if (tagsArray.length > 0) {
        switchToTagsViewMode();
    } else {
        switchToTagsEditMode();
    }
    tabsState.currentTemplate = tmpl.content; // Set the raw template content
    elements.promptArea.textContent = tmpl.content;
    tabsState.placeholderValues = {}; // Clear placeholder values for the new template
    const templateTabButton = document.getElementById('template-tab');
    if (templateTabButton) {
        new bootstrap.Tab(templateTabButton).show();
    }
    buildTabsFromTemplate(tmpl.content);
    renderPlaceholdersInTemplate(); // Ensure styles are applied
    elements.searchBox.value = "";
    elements.clearSearch.style.display = "none";
    elements.searchOverlay.style.display = 'none';
    elements.dropdownResults.classList.remove("show");
    elements.fetchBtn2.style.display = "none";
    updateClearButtonState();
    updateSaveButtonState();
    updateDeleteButtonState();
    saveState();
    elements.promptArea.focus();
}

function updateRecentIndices(index) {
    recentIndices.unshift(index);
    recentIndices = [...new Set(recentIndices)].slice(0, 10);
    chrome.storage.local.set({ recentIndices });
}

function extractAllowedPlaceholdersFromDefaults() {
    const placeholders = new Set();
    const regex = /\{\{([^}]+)\}\}/g;
    defaultTemplates.forEach(template => {
        let match;
        while ((match = regex.exec(template.content)) !== null) {
            placeholders.add(match[1].trim());
        }
    });
    return Array.from(placeholders);
}

// --- Placeholder and Tab Logic ---

// --- Tab Slider Logic ---

function setupTabSlider() {
    const tabsWrapper = document.querySelector('.tabs-wrapper');
    const leftArrow = document.getElementById('scroll-left-btn');
    const rightArrow = document.getElementById('scroll-right-btn');

    if (!tabsWrapper || !leftArrow || !rightArrow) return;

    const updateArrows = () => {
        const scrollLeft = tabsWrapper.scrollLeft;
        const scrollWidth = tabsWrapper.scrollWidth;
        const clientWidth = tabsWrapper.clientWidth;
        const tolerance = 1;

        leftArrow.classList.toggle('hidden', scrollLeft <= tolerance);
        rightArrow.classList.toggle('hidden', scrollLeft >= scrollWidth - clientWidth - tolerance);
    };

    leftArrow.addEventListener('click', () => {
        tabsWrapper.scrollBy({ left: -200, behavior: 'smooth' });
    });

    rightArrow.addEventListener('click', () => {
        tabsWrapper.scrollBy({ left: 200, behavior: 'smooth' });
    });

    tabsWrapper.addEventListener('scroll', updateArrows);
    window.addEventListener('resize', debounce(updateArrows, 100));

    let isDragging = false;
    let startX;
    let scrollLeftStart;

    tabsWrapper.addEventListener('mousedown', (e) => {
        isDragging = true;
        tabsWrapper.classList.add('is-dragging');
        startX = e.pageX - tabsWrapper.offsetLeft;
        scrollLeftStart = tabsWrapper.scrollLeft;
    });

    tabsWrapper.addEventListener('mouseleave', () => {
        isDragging = false;
        tabsWrapper.classList.remove('is-dragging');
    });

    tabsWrapper.addEventListener('mouseup', () => {
        isDragging = false;
        tabsWrapper.classList.remove('is-dragging');
    });

    tabsWrapper.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        e.preventDefault();
        const x = e.pageX - tabsWrapper.offsetLeft;
        const walk = (x - startX) * 1.5; // Multiply for faster scroll
        tabsWrapper.scrollLeft = scrollLeftStart - walk;
    });

    // Use a MutationObserver to update arrows when tabs are added/removed
    const observer = new MutationObserver(() => {
        updateArrows();
    });
    observer.observe(document.getElementById('editorTabs'), { childList: true, subtree: true });

    updateArrows(); // Initial check
}

function buildTabsFromTemplate(templateContent) {
    const { placeholders } = parsePlaceholders(templateContent);
    tabsState.placeholders = placeholders;
    tabsState.currentTemplate = templateContent;

    const tabsList = document.getElementById("editorTabs");
    const tabPanels = document.getElementById("tabPanels");
    const templateTab = document.getElementById('template-tab');
    const templatePanel = document.getElementById('template-panel');

    // Always clear placeholder tabs and panels
    tabsList.querySelectorAll('li:not(:first-child)').forEach(tab => tab.remove());
    tabPanels.querySelectorAll('.tab-pane:not(#template-panel)').forEach(panel => panel.remove());

    if (placeholders.length === 0) {
        // Hide tabs and show only the main editor
        tabsList.style.display = 'none';
        if (templateTab) templateTab.classList.remove('active');
        if (templatePanel) templatePanel.classList.add('active', 'show');
        elements.promptArea.style.height = 'calc(100vh - 320px)';
    } else {
        // Show tabs and build placeholder tabs
        tabsList.style.display = 'flex';
        elements.promptArea.style.height = 'calc(100vh - 360px)';
        elements.clearPrompt.style.display = "none";

        placeholders.forEach((placeholder) => {
            const tabId = `placeholder-${placeholder.replace(/\s+/g, '-').toLowerCase()}`;
            const panelId = `${tabId}-panel`;

            const tabItem = document.createElement('li');
            tabItem.className = 'nav-item';
            tabItem.setAttribute('role', 'presentation');
            const tabButton = document.createElement('button');
            tabButton.className = 'nav-link';
            tabButton.id = tabId;
            tabButton.setAttribute('data-bs-toggle', 'tab');
            tabButton.setAttribute('data-bs-target', `#${panelId}`);
            tabButton.type = 'button';
            tabButton.setAttribute('role', 'tab');
            tabButton.textContent = placeholder;
            tabItem.appendChild(tabButton);
            tabsList.appendChild(tabItem);

            const tabPanel = document.createElement('div');
            tabPanel.className = 'tab-pane fade';
            tabPanel.id = panelId;
            tabPanel.setAttribute('role', 'tabpanel');
            
            const panelContentWrapper = document.createElement('div');
            panelContentWrapper.className = 'position-relative';

            const textarea = document.createElement('textarea');
            textarea.className = 'form-control rounded-0 rounded-bottom px-3 py-2';
            textarea.style.resize = 'none';
            textarea.style.height = 'calc(100vh - 360px)';
            textarea.placeholder = `Enter value for ${placeholder}...`;
            textarea.id = `${tabId}-textarea`;
            textarea.addEventListener('input', () => updatePlaceholder(placeholder, textarea.value));
            panelContentWrapper.appendChild(textarea);

            const clearButton = document.createElement('button');
            clearButton.className = 'clrbtn position-absolute top-0 end-0 mr-2';
            clearButton.innerHTML = `<svg width="15" height="15"><use href="sprite.svg#clear"></use></svg>`;
            clearButton.setAttribute('aria-label', `Clear ${placeholder}`);
            clearButton.setAttribute('data-bs-toggle', 'tooltip');
            clearButton.setAttribute('data-bs-placement', 'top');
            clearButton.title = `Clear ${placeholder}`;
            clearButton.style.zIndex = '10';
            clearButton.addEventListener('click', () => {
                updatePlaceholder(placeholder, '');
                textarea.value = '';
                textarea.focus();
            });
            panelContentWrapper.appendChild(clearButton);
            
            new bootstrap.Tooltip(clearButton);

            tabPanel.appendChild(panelContentWrapper);
            tabPanels.appendChild(tabPanel);

            tabsState.placeholderValues[placeholder] = tabsState.placeholderValues[placeholder] || '';
            textarea.value = tabsState.placeholderValues[placeholder];
            updateTabTitle(placeholder, textarea.value.trim() !== '');
        });

        // Show the template tab by default
        if (templateTab) new bootstrap.Tab(templateTab).show();
    }
    updateClearButtonState();
    renderPlaceholdersInTemplate();
    // The MutationObserver will handle the arrow updates automatically
}

function destroyTabs() {
    const tabsList = document.getElementById('editorTabs');
    const templateTab = document.getElementById('template-tab');
    const templatePanel = document.getElementById('template-panel');

    tabsList.style.display = 'none';
    tabsList.querySelectorAll('li:not(:first-child)').forEach(tab => tab.remove());
    document.getElementById('tabPanels').querySelectorAll('.tab-pane:not(#template-panel)').forEach(panel => panel.remove());
    
    if (templateTab) templateTab.classList.remove('active');
    if (templatePanel) templatePanel.classList.add('active', 'show');
    
    elements.promptArea.style.height = 'calc(100vh - 320px)';
    updateClearButtonState();
}

function renderPlaceholdersInTemplate() {
    if (!tabsState.currentTemplate) return;

    const selection = window.getSelection();
    let cursorOffset = 0;
    const shouldPreserveCursor = selection.rangeCount > 0 && !isUpdatingContent;
    if (shouldPreserveCursor) {
        const range = selection.getRangeAt(0);
        const preCaretRange = range.cloneRange();
        preCaretRange.selectNodeContents(elements.promptArea);
        preCaretRange.setEnd(range.endContainer, range.endOffset);
        cursorOffset = preCaretRange.toString().length;
    }

    const { placeholderPositions } = parsePlaceholders(tabsState.currentTemplate);
    let htmlContent = tabsState.currentTemplate;
    let offset = 0;
    
    placeholderPositions.forEach((positions, placeholder) => {
        positions.forEach((pos) => {
            const hasValue = tabsState.placeholderValues[placeholder]?.trim();
            const displayContent = hasValue ? tabsState.placeholderValues[placeholder] : pos.original;
            const spanHtml = `<span class="placeholder-marker ${hasValue ? 'placeholder-filled' : 'placeholder-empty'}" data-type="${placeholder}" title="Click to edit ${placeholder}">${displayContent}</span>`;
            const actualStart = pos.start + offset;
            const actualEnd = pos.end + offset;
            htmlContent = htmlContent.slice(0, actualStart) + spanHtml + htmlContent.slice(actualEnd);
            offset += spanHtml.length - (actualEnd - actualStart);
        });
    });

    isUpdatingContent = true;
    elements.promptArea.innerHTML = htmlContent;
    isUpdatingContent = false;

    if (shouldPreserveCursor) {
        try {
            const { node, offset } = findTextNodeAndOffset(elements.promptArea, cursorOffset);
            const range = document.createRange();
            const sel = window.getSelection();
            range.setStart(node, offset);
            range.setEnd(node, offset);
            sel.removeAllRanges();
            sel.addRange(range);
        } catch (e) {
            console.warn('Cursor restoration failed:', e);
        }
    }

    elements.promptArea.querySelectorAll('.placeholder-marker').forEach(element => {
        element.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const placeholderType = e.target.getAttribute('data-type');
            if (placeholderType) switchToPlaceholderTab(placeholderType);
        });
        element.setAttribute('contenteditable', 'false');
    });
}

function updatePlaceholder(type, value) {
    tabsState.placeholderValues[type] = value;
    const textarea = document.getElementById(`placeholder-${type.replace(/\s+/g, '-').toLowerCase()}-textarea`);
    if (textarea && textarea.value !== value) {
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        textarea.value = value;
        setTimeout(() => textarea.setSelectionRange(start, end), 0);
    }
    updateTabTitle(type, value.trim() !== '');
    renderPlaceholdersInTemplate();
    saveState(); // Ensure state is saved whenever a placeholder is updated
}

function switchToPlaceholderTab(placeholder) {
    const tabId = `placeholder-${placeholder.replace(/\s+/g, '-').toLowerCase()}`;
    const tabButton = document.getElementById(tabId);
    if (tabButton) {
        new bootstrap.Tab(tabButton).show();
        const textarea = document.getElementById(`${tabId}-textarea`);
        if (textarea) setTimeout(() => textarea.focus(), 100);
    }
}

function updateTabTitle(placeholder, hasValue) {
    const tabId = `placeholder-${placeholder.replace(/\s+/g, '-').toLowerCase()}`;
    const tabButton = document.getElementById(tabId);
    if (tabButton) {
        tabButton.textContent = placeholder;
        tabButton.classList.toggle('filled', hasValue);
        
        if (hasValue) {
            const checkmark = document.createElement('span');
            checkmark.innerHTML = '&nbsp;&#10003;';
            checkmark.style.color = '#3b82f6'; // A clean blue for the checkmark
            checkmark.style.fontSize = '12px';
            tabButton.appendChild(checkmark);
        }
    }
}

// --- Event Handlers ---

  function validateTagsInput() {
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
  
    // Adjust cursor position to avoid landing on a comma or space
    const cursorPos = elements.templateTags.selectionStart;
    if (value && cursorPos > 0 && value[cursorPos] === " " && value[cursorPos - 1] === ",") {
      elements.templateTags.selectionStart = elements.templateTags.selectionEnd = cursorPos - 1;
    }
  }

function handleNewTemplate() {
    storeLastState();
    selectedTemplateName = null;
    originalTagsBeforeEdit = null;
    elements.templateName.value = getDefaultTemplateName();
    elements.templateTags.value = "";
    const defaultContent = `# Your Role\n*\n\n# Background Information\n*\n\n# Your Task\n*`;
    elements.promptArea.textContent = defaultContent;
    tabsState.currentTemplate = defaultContent; // Set the current template
    switchToTagsEditMode();
    updateSaveButtonState();
    updateDeleteButtonState();
    updateExportSingleBtnState()
    elements.fetchBtn2.style.display = "none";
    elements.searchBox.value = "";
    destroyTabs();
    buildTabsFromTemplate(defaultContent); // Build tabs from the default content
    saveState();
    showToast("New template created.", 2000, "green", [], "new");
}

function handleEditTags() {
    originalTagsBeforeEdit = elements.templateTags.value;
    switchToTagsEditMode(true);
}

function handleCancelTagsEdit() {
    if (originalTagsBeforeEdit !== null) {
        elements.templateTags.value = originalTagsBeforeEdit;
        switchToTagsViewMode();
    }
}

function handleSaveTemplate() {
    chrome.storage.local.get(["templates"], (result) => {
        let templates = result.templates || [];
        const nameValidation = validateTemplateName(elements.templateName.value, templates);
        if (!nameValidation.isValid) return;
        const name = nameValidation.sanitizedName;
        const tags = sanitizeTags(elements.templateTags.value);
        if (tags === null) return;
        const content = elements.promptArea.textContent;
        if (!content.trim()) {
            showToast("Prompt content is required.", 3000, "red", [], "save");
            elements.promptArea.focus();
            return;
        }

        const isNewTemplate = !selectedTemplateName;
        if (!isNewTemplate) {
            const template = templates.find(t => t.name === selectedTemplateName);
            const isEdited = elements.templateName.value !== template.name ||
                tags.join(',') !== (template.tags || []).join(',') ||
                content !== template.content;
            if (!isEdited) {
                showToast("No changes to save.", 3000, "red", [], "save");
                return;
            }
        }

        const saveAction = () => {
            storeLastState();
            lastState.templates = [...templates];
            
            // Process content for both new and existing templates
            let content = elements.promptArea.textContent;
            for (const placeholder in tabsState.placeholderValues) {
                const value = tabsState.placeholderValues[placeholder];
                if (value && value.trim() !== '') {
                    const regex = new RegExp(`\\{\\{${placeholder.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}\\}\\}`, 'g');
                    content = content.replace(regex, value);
                }
            }
            
            if (isNewTemplate) {
                const newTemplate = { name, tags, content, type: "custom", favorite: false, index: nextIndex };
                templates.push(newTemplate);
                updateRecentIndices(nextIndex);
                nextIndex++;
                saveNextIndex();
            } else {
                const templateIndex = templates.findIndex(t => t.name === selectedTemplateName);
                templates[templateIndex] = { ...templates[templateIndex], name, tags, content };
            }
            
            saveTemplates(templates, () => {
                selectedTemplateName = name;
                
                // Update UI with processed content
                tabsState.currentTemplate = content;
                elements.promptArea.textContent = content;
                buildTabsFromTemplate(content);
                
                loadTemplates();
                saveState();
                switchToTagsViewMode();
                updateExportSingleBtnState();
                updateDeleteButtonState();
            }, isNewTemplate);
        };
        const hasNoTags = tags.length === 0;
        if (hasNoTags) {
            showToast("⚠️ No tags added. Save template?", 0, "red", [
                { text: "Yes", callback: saveAction },
                { text: "No", callback: () => elements.templateTags.focus() }
            ], "save-no-tags");
        } else {
            saveAction();
        }
    });
}

function handleSaveAsTemplate() {
    chrome.storage.local.get(["templates"], (result) => {
        const templates = result.templates || [];
        const nameValidation = validateTemplateName(elements.templateName.value, templates, true);
        if (!nameValidation.isValid) return;
        const name = nameValidation.sanitizedName;
        const tags = sanitizeTags(elements.templateTags.value);
        if (tags === null) return;

        let content = elements.promptArea.textContent;
        if (!content.trim()) {
            showToast("Prompt content is required.", 3000, "red", [], "saveAs");
            elements.promptArea.focus();
            return;
        }

        // Replace filled placeholders with their values
        for (const placeholder in tabsState.placeholderValues) {
            const value = tabsState.placeholderValues[placeholder];
            if (value && value.trim() !== '') {
                const regex = new RegExp(`\\{\\{${placeholder.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}\\}\\}`, 'g');
                content = content.replace(regex, value);
            }
        }

        const saveAction = () => {
            storeLastState();
            lastState.templates = [...templates];
            const newTemplate = { name, tags, content, type: "custom", favorite: false, index: nextIndex };
            templates.push(newTemplate);
            updateRecentIndices(nextIndex);
            nextIndex++;
            saveTemplates(templates, () => {
                selectedTemplateName = name;
                elements.templateName.value = name;
                loadTemplates();
                // After saving, reload the new template to reflect the changes
                loadTemplateFromSelection(newTemplate, true);
                saveState();
                saveNextIndex();
                switchToTagsViewMode();
                updateExportSingleBtnState();
                updateSaveButtonState();
                updateDeleteButtonState();
            }, true);
        };

        const hasNoTags = tags.length === 0;
        if (hasNoTags) {
            showToast("⚠️ No tags provided. Save without tags?", 0, "red", [
                { text: "Yes", callback: saveAction },
                { text: "No", callback: () => elements.templateTags.focus() }
            ], "saveAs-no-tags");
        } else {
            saveAction();
        }
    });
}

function handleDeleteTemplate() {
    if (!selectedTemplateName) {
        showToast("Please select a template to delete.", 3000, "red", [], "delete");
        return;
    }
    chrome.storage.local.get(["templates", "recentIndices"], (result) => {
        const templates = result.templates || [];
        const template = templates.find(t => t.name === selectedTemplateName);
        if (!template) {
            showToast("Template not found.", 3000, "red", [], "delete");
            return;
        }
        if (template.type === "pre-built") {
            showToast("Cannot delete a default template.", 3000, "red", [], "delete");
            return;
        }

        showToast(
            `Are you sure you want to delete "${selectedTemplateName}"?`,
            0, "red",
            [{ text: "Yes", callback: () => {
                storeLastState();
                lastState.templates = [...templates];
                const templateIndex = templates.findIndex(t => t.name === selectedTemplateName);
                const deletedIndex = templates[templateIndex].index;
                templates.splice(templateIndex, 1);
                recentIndices = recentIndices.filter(idx => idx !== deletedIndex);
                chrome.storage.local.set({ templates, recentIndices }, () => {
                    if (chrome.runtime.lastError) {
                        showToast("Failed to delete.", 3000, "red", [], "delete");
                    } else {
                        showToast("Template deleted. Press Ctrl+Z to undo.", 3000, "green", [], "delete");
                        handleNewTemplate();
                    }
                });
            }},
            { text: "No", callback: () => {} }
            ], "delete-confirm");
    });
}

function getTargetTabId(callback) {
    chrome.runtime.sendMessage({ action: "getTargetTabId" }, (response) => {
        if (chrome.runtime.lastError) {
            console.error("Error getting tab ID:", chrome.runtime.lastError.message);
            callback(null);
        } else {
            callback(response ? response.tabId : null);
        }
    });
}

function handleFetchPrompt() {
    getTargetTabId(tabId => {
        if (!tabId) return;
        chrome.tabs.sendMessage(tabId, { action: "getPrompt" }, (response) => {
            if (chrome.runtime.lastError) {
                reInjectAndRetry(tabId, "getPrompt", (res) => {
                    if (res && res.prompt) {
                        elements.promptArea.textContent = res.prompt;
                        elements.fetchBtn2.style.display = "none";
                        elements.clearPrompt.style.display = "block";
                        saveState();
                    } else {
                        showToast("No text found.", 3000, "red", [], "fetch");
                    }
                });
            } else if (response && response.prompt) {
                storeLastState();
                elements.promptArea.textContent = response.prompt;
                handlePromptInput();
                saveState();
            } else {
                showToast("No text found. Please select a field that contains text.", 3000, "red", [], "fetch");
            }
        });
    });
}

function handleSendPrompt() {
    getTargetTabId(tabId => {
        if (!tabId) return;
        chrome.tabs.sendMessage(tabId, { action: "sendPrompt", prompt: elements.promptArea.textContent }, (response) => {
            if (chrome.runtime.lastError) {
                reInjectAndRetry(tabId, "sendPrompt", () => {
                    if (selectedTemplateName) {
                        chrome.storage.local.get(["templates"], (result) => {
                            const template = (result.templates || []).find(t => t.name === selectedTemplateName);
                            if (template) updateRecentIndices(template.index);
                        });
                    }
                    chrome.runtime.sendMessage({ action: "closePopup" });
                });
            } else if (response && response.success) {
                if (selectedTemplateName) {
                    chrome.storage.local.get(["templates"], (result) => {
                        const template = (result.templates || []).find(t => t.name === selectedTemplateName);
                        if (template) updateRecentIndices(template.index);
                    });
                }
                chrome.runtime.sendMessage({ action: "closePopup" });
            } else {
                showToast("Failed to send prompt.", 3000, "red", [], "send");
            }
        });
    });
}

function reInjectAndRetry(tabId, action, callback) {
    chrome.runtime.sendMessage({ action: "reInjectContentScript", tabId }, (reInjectResponse) => {
        if (reInjectResponse && reInjectResponse.success) {
            setTimeout(() => {
                chrome.tabs.sendMessage(tabId, { action }, callback);
            }, 100);
        } else {
            showToast("Failed to connect to the page. Please try again or refresh the page.", 3000, "red", [], action);
        }
    });
}

function handleImportFile(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const imported = jsyaml.load(e.target.result);
            if (!Array.isArray(imported)) {
                showToast("Invalid YAML: Expected a list of prompts.", 3000, "red");
                return;
            }
            chrome.storage.local.get(["templates"], (result) => {
                let templates = result.templates || [];
                let added = 0, overwritten = 0;
                imported.forEach((imp) => {
                    if (!imp.name || typeof imp.name !== "string" || !imp.name.trim()) {
                        imp.name = `Imported Prompt ${templates.length + 1}`;
                    }
                    const existingIdx = templates.findIndex(t => t.name === imp.name);
                    if (existingIdx !== -1) {
                        templates[existingIdx] = { ...templates[existingIdx], ...imp };
                        overwritten++;
                    } else {
                        if (typeof imp.index !== "number") {
                            imp.index = templates.length ? Math.max(...templates.map(t => t.index || 0)) + 1 : 0;
                        }
                        templates.push(imp);
                        added++;
                    }
                });
                chrome.storage.local.set({ templates }, () => {
                    loadTemplates();
                    showToast(`Imported: ${added} new, ${overwritten} overwritten.`, 4000, "green");
                });
            });
        } catch (err) {
            showToast("Failed to import: " + err.message, 4000, "red");
        }
    };
    reader.readAsText(file);
    event.target.value = "";
}

function handleExportAll() {
  chrome.storage.local.get(["templates"], (result) => {
      const templates = result.templates || [];
      
      // Export templates as-is from storage, without processing placeholder values
      const yaml = promptsToYAML(templates);
      downloadFile(yaml, "promptstash_export_all.yaml", "text/yaml");
      showToast("All saved templates exported!", 2000, "green", [], "exportAll");
  });
}

function handleExportSingle() {
    if (!selectedTemplateName) {
        showToast("No saved template selected to export.", 3000, "red", [], "exportSingle");
        return;
    }

    chrome.storage.local.get(["templates"], (result) => {
        const templates = result.templates || [];
        const template = templates.find(t => t.name === selectedTemplateName);
        
        if (!template) {
            showToast("Template not found.", 3000, "red", [], "exportSingle");
            return;
        }

        // Use the saved template data, not the current UI content
        const name = template.name;
        const content = template.content;
        const tags = Array.isArray(template.tags) ? template.tags.join(", ") : "";

        const yamlString = `name: ${name}\n` +
                           `tags: ${tags}\n` +
                           `content: |\n  ${content.replace(/\n/g, '\n  ')}`;

        downloadFile(yamlString, `${name}.yaml`, "text/yaml");
        showToast(`Template '${name}' exported successfully.`, 3000, "green", [], "exportSingle");
    });
}

function handleGlobalClick(event) {
    if (!elements.searchBox.contains(event.target) && !elements.dropdownResults.contains(event.target) && !event.target.classList.contains("favorite-toggle")) {
        elements.searchOverlay.style.display = 'none';
        elements.dropdownResults.classList.remove("show");
    }
    if (event.target.classList.contains("favorite-toggle")) {
        const name = event.target.dataset.name;
        chrome.storage.local.get(["templates"], (result) => {
            const templates = result.templates || [];
            const template = templates.find(t => t.name === name);
            if (template) {
                if (!template.favorite && templates.filter(t => t.favorite).length >= 10) {
                    showToast("Maximum of 10 favorite templates allowed.", 3000, "red", [], "favorite");
                    return;
                }
                template.favorite = !template.favorite;
                chrome.storage.local.set({ templates }, () => loadTemplates(elements.searchBox.value.toLowerCase(), true));
            }
        });
    }
}

function handleGlobalKeydown(event) {
    if (event.key === "Escape") {
        if (isToastShowing && elements.toast.className.includes("confirmation")) {
            const noButton = toastQueue[0].buttons.find(b => b.text === "No");
            closeToast(noButton?.callback);
        } else {
            handleCloseWithUnsavedCheck();
        }
    } else if (event.ctrlKey && event.key === "z" && lastState) {
        undoLastAction();
    }
}

function closePopupAndClearState(clearState = false) {
    if (clearState) {
        chrome.storage.local.remove(["popupState", "placeholderValues"], () => {
            chrome.runtime.sendMessage({ action: "closePopup" });
        });
    } else {
        saveState(); // This will be called when clicking outside, preserving state
        chrome.runtime.sendMessage({ action: "closePopup" });
    }
}

function undoLastAction() {
    elements.templateName.value = lastState.name || "";
    lastState = null;
}

function handlePromptInput() {
    if (isUpdatingContent) return;

    const templateContent = getContentWithPlaceholders();
    tabsState.currentTemplate = templateContent;

    buildTabsFromTemplate(templateContent);

    elements.fetchBtn2.style.display = elements.promptArea.textContent.trim() ? "none" : "block";
    
    saveState();
}
// Enhanced function to insert line break with preservation
function insertLineBreak() {
  const selection = window.getSelection();
  if (selection.rangeCount === 0) return;
  
  const range = selection.getRangeAt(0);
  
  // Use newline character instead of <br> for better preservation
  const textNode = document.createTextNode('\n');
  range.insertNode(textNode);
  
  // Move cursor after the newline
  range.setStartAfter(textNode);
  range.setEndAfter(textNode);
  selection.removeAllRanges();
  selection.addRange(range);
  
  scrollToCursor();
  preserveFormatting();
}

// Enhanced function to insert spaces with preservation
function insertSpaces(count) {
  const selection = window.getSelection();
  if (selection.rangeCount === 0) return;
  
  const range = selection.getRangeAt(0);
  
  // Use regular spaces - they'll be preserved by CSS white-space: pre-wrap
  const spaces = ' '.repeat(count);
  const textNode = document.createTextNode(spaces);
  range.insertNode(textNode);
  
  // Move cursor after the spaces
  range.setStartAfter(textNode);
  range.setEndAfter(textNode);
  selection.removeAllRanges();
  selection.addRange(range);
  
  scrollToCursor();
  preserveFormatting();
}

// Function to scroll the contenteditable div to keep cursor visible
function scrollToCursor() {
  const selection = window.getSelection();
  if (selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      const editorRect = elements.promptArea.getBoundingClientRect();
      
      if (rect.bottom > editorRect.bottom) {
          elements.promptArea.scrollTop += rect.bottom - editorRect.bottom + 10;
      }
  }
}
function getCharOffset(root, node, offset) {
      const range = document.createRange();
      range.setStart(root, 0);
      range.setEnd(node, offset);
      return range.toString().length;
    }
    
function handleTabKey(event) {
    const selection = window.getSelection();
    if (!selection.rangeCount) return;

    const range = selection.getRangeAt(0);
    const isCollapsed = range.collapsed;

    if (isCollapsed) {
     // Case 1: No selection, just a cursor.
     event.preventDefault();
     if (event.shiftKey) {
          // If Shift+Tab, find the start of the line and un-indent
          const fullText = elements.promptArea.textContent;
          const cursorOffset = getCharOffset(elements.promptArea, range.startContainer, range.startOffset);
          const lineStart = fullText.lastIndexOf('\n', cursorOffset - 1) + 1;
          const line = fullText.substring(lineStart, cursorOffset);
          const spacesToRemove = Math.min(4, line.match(/^ {1,4}/)?.[0].length || 0);

          if (spacesToRemove > 0) {
               const newText = fullText.substring(0, lineStart) + fullText.substring(lineStart + spacesToRemove);
               elements.promptArea.textContent = newText;
               handlePromptInput();
               const { node, offset } = findTextNodeAndOffset(elements.promptArea, cursorOffset - spacesToRemove);
               const newRange = document.createRange();
               newRange.setStart(node, offset);
               selection.removeAllRanges();
               selection.addRange(newRange);
          }
     } else {
          // If Tab, simply insert 4 spaces
          document.execCommand('insertText', false, '    ');
     }
     return;
    }

    // Case 2: Multiline selection.
    event.preventDefault();
    const startOffset = getCharOffset(elements.promptArea, range.startContainer, range.startOffset);
    const endOffset = getCharOffset(elements.promptArea, range.endContainer, range.endOffset);

    const fullText = elements.promptArea.textContent;
    const startOfLine = fullText.lastIndexOf('\n', startOffset - 1) + 1;
    const endOfLine = fullText.indexOf('\n', endOffset) === -1 ? fullText.length : fullText.indexOf('\n', endOffset);

    const beforeText = fullText.substring(0, startOfLine);
    const affectedText = fullText.substring(startOfLine, endOfLine);
    const afterText = fullText.substring(endOfLine);

    const lines = affectedText.split('\n');
    let processedLines = [];

    if (event.shiftKey) { // Un-indent
     processedLines = lines.map(line => {
          const leadingSpaces = line.match(/^ {1,4}/);
          return leadingSpaces ? line.substring(leadingSpaces[0].length) : line;
     });
    } else { // Indent
     processedLines = lines.map(line => '    ' + line);
    }

    const processedText = processedLines.join('\n');
    const newFullText = beforeText + processedText + afterText;

    elements.promptArea.textContent = newFullText;
    handlePromptInput();

    const newEndOffset = startOfLine + processedText.length;
    const { node: startNode, offset: startNodeOffset } = findTextNodeAndOffset(elements.promptArea, startOfLine);
    const { node: endNode, offset: endNodeOffset } = findTextNodeAndOffset(elements.promptArea, newEndOffset);
    
    const newRange = document.createRange();
    newRange.setStart(startNode, startNodeOffset);
    newRange.setEnd(endNode, endNodeOffset);
    selection.removeAllRanges();
    selection.addRange(newRange);
}

// Enhanced unindent function
function handleUnindent() {
  const selection = window.getSelection();
  if (selection.rangeCount === 0) return;
  
  const range = selection.getRangeAt(0);
  const startContainer = range.startContainer;
  
  // Find the start of the current line
  let textNode = startContainer.nodeType === Node.TEXT_NODE ? startContainer : startContainer.firstChild;
  if (!textNode) return;
  
  const text = textNode.textContent;
  const cursorOffset = range.startOffset;
  
  // Find line start
  let lineStart = text.lastIndexOf('\n', cursorOffset - 1) + 1;
  
  // Check if line starts with spaces/non-breaking spaces
  let spacesToRemove = 0;
  for (let i = lineStart; i < Math.min(lineStart + 4, text.length); i++) {
      if (text[i] === ' ' || text[i] === '\u00A0') {
          spacesToRemove++;
      } else {
          break;
      }
  }
  
  if (spacesToRemove > 0) {
      // Remove the spaces
      const newText = text.substring(0, lineStart) + text.substring(lineStart + spacesToRemove);
      textNode.textContent = newText;
      
      // Adjust cursor position
      const newOffset = Math.max(lineStart, cursorOffset - spacesToRemove);
      range.setStart(textNode, newOffset);
      range.setEnd(textNode, newOffset);
      selection.removeAllRanges();
      selection.addRange(range);
  }
}

function handlePromptKeydown(event) {
    // Handle Tab key for indentation
    if (event.key === "Tab") {
    event.preventDefault();
    handleTabKey(event);
    return;
    }
    
    // Handle Enter key for line breaks
    if (event.key === "Enter") {
    event.preventDefault();
    document.execCommand('insertLineBreak');
    return;
    }

    // Your existing placeholder handling
    if (isWithinPlaceholder(window.getSelection().focusNode)) {
    event.preventDefault();
    const placeholderElement = window.getSelection().focusNode.closest('.placeholder-marker');
    if (placeholderElement) {
        switchToPlaceholderTab(placeholderElement.getAttribute('data-type'));
    }
    }
}

function handlePaste(event) {
  if (isWithinPlaceholder(window.getSelection().focusNode)) {
      event.preventDefault();
      return;
  }
  
  // Get plain text from clipboard
  event.preventDefault();
  const text = event.clipboardData.getData('text/plain');
  
  // Insert plain text at cursor position
  const selection = window.getSelection();
  if (selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      const textNode = document.createTextNode(text);
      range.insertNode(textNode);
      
      // Move cursor after inserted text
      range.setStartAfter(textNode);
      range.setEndAfter(textNode);
      selection.removeAllRanges();
      selection.addRange(range);
  }
  
  setTimeout(() => {
      const content = elements.promptArea.textContent || '';
      const sanitizedContent = sanitizeTemplateInput(content);
      if (sanitizedContent !== content) {
          elements.promptArea.textContent = sanitizedContent;
          showToast("Pasted content had invalid placeholders.", 3000, "orange", [], "paste-restriction");
      }
      handlePromptInput(); // Trigger input handler to update state
  }, 0);
}

async function handleCloseWithUnsavedCheck() {
    const unsaved = await hasUnsavedChanges();
    if (unsaved) {
        showToast(
            "You have unsaved changes. Are you sure you want to close?",
            8000,
            "confirmation",
            [
                { text: "Yes", callback: () => closePopupAndClearState(true) },
                { text: "No", callback: () => {} }
            ],
            "closeConfirm"
        );
    } else {
        closePopupAndClearState(true);
    }
}

// --- Helper Functions for Code Reuse ---

function getContentWithPlaceholders() {
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = elements.promptArea.innerHTML;

    tempDiv.querySelectorAll('.placeholder-marker').forEach(span => {
        const placeholderType = span.getAttribute('data-type');
        if (placeholderType) {
            const textNode = document.createTextNode(`{{${placeholderType}}}`);
            span.parentNode.replaceChild(textNode, span);
        }
    });
    return tempDiv.textContent;
}

function isWithinPlaceholder(node) {
    return node && (node.closest('.placeholder-marker') || node.closest('.placeholder-value'));
}

function sanitizeTemplateInput(content) {
    return content.replace(/\{\{([^}]+)\}\}/g, (match, placeholder) => {
        return ALLOWED_PLACEHOLDERS.includes(placeholder.trim()) ? match : placeholder;
    });
}

function saveNextIndex() {
    chrome.storage.local.set({ nextIndex });
}

function initializeTooltips() {
    document.querySelectorAll('[data-bs-toggle="tooltip"]').forEach(el => new bootstrap.Tooltip(el));
}