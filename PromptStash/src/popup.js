import jsyaml from "js-yaml";
import defaultTemplates from "./defaultTemplates.mjs";

// Get version from manifest instead of hardcoding
const EXTENSION_VERSION = chrome.runtime.getManifest().version;

// Prevent session snapshot writes during destructive operations (delete/import)
let suppressSessionSave = false;

// --- Utility Functions ---

// --- Session Storage Functions ---
// These functions handle unsaved changes persistence across reloads/tab switches
// Data persists within the same Chrome session but is cleared when Chrome closes

function saveToSession() {
    if (suppressSessionSave) return;
    // Save current unsaved state to session storage
    const sessionData = {
        templateName: elements.templateName.value,
        templateTags: elements.templateTags.value,
        templateContent: tabsState.currentTemplate,
        placeholderValues: tabsState.placeholderValues,
        selectedTemplateName: selectedTemplateName,
        editingTargetName: editingTargetName,
        timestamp: Date.now(),
        // Store which placeholders have tabs
        existingTabPlaceholders: tabsState.existingTabPlaceholders || [],
        // Store preview mode state
        previewMode: tabsState.previewMode || false,
    };

    // Create a key based on the current template context
    const sessionKey = selectedTemplateName ? `unsaved_${selectedTemplateName}` : "unsaved_draft";

    chrome.storage.session.set({
        [sessionKey]: sessionData,
        currentSessionKey: sessionKey, // Track which template we're working on
    });
}

function loadFromSession(callback) {
    // Load unsaved changes from session storage
    // First check if we closed with X button - if so, don't restore but keep the data
    chrome.storage.session.get(["closedWithX", "currentSessionKey"], (result) => {
        if (result.closedWithX) {
            // We closed with X, so show new template but keep session data
            chrome.storage.session.remove(["closedWithX", "currentSessionKey"]);
            if (callback) callback(null);
            return;
        }

        if (!result.currentSessionKey) {
            if (callback) callback(null);
            return;
        }

        chrome.storage.session.get([result.currentSessionKey], (sessionResult) => {
            const sessionData = sessionResult[result.currentSessionKey];
            if (callback) callback(sessionData);
        });
    });
}

function clearSessionForTemplate(templateName) {
    // Clear session data for a specific template after successful save
    const sessionKey = templateName ? `unsaved_${templateName}` : "unsaved_draft";
    chrome.storage.session.remove([sessionKey]);

    // If this was the current session, also clear the current key
    chrome.storage.session.get(["currentSessionKey"], (result) => {
        if (result.currentSessionKey === sessionKey) {
            chrome.storage.session.remove(["currentSessionKey"]);
        }
    });
}

async function saveSessionOnTemplateSwitch() {
    // Save current template's unsaved changes before switching
    try {
        const hasChanges = await hasUnsavedChanges();
        if (hasChanges) {
            saveToSession();
        }
    } catch (e) {
        // If check fails, save anyway to be safe
        saveToSession();
    }
}

function loadSessionForTemplate(templateName) {
    // Load session data for a specific template
    const sessionKey = templateName ? `unsaved_${templateName}` : "unsaved_draft";

    chrome.storage.session.get([sessionKey], (result) => {
        const sessionData = result[sessionKey];
        if (sessionData && sessionData.timestamp) {
            // Apply the session data if it exists
            applySessionData(sessionData);
        }
    });
}

function applySessionData(sessionData) {
    // Apply session data to the UI
    if (!sessionData) return;

    elements.templateName.value = sessionData.templateName || "";
    elements.templateTags.value = sessionData.templateTags || "";
    tabsState.currentTemplate = sessionData.templateContent || "";
    elements.promptArea.textContent = sessionData.templateContent || "";
    tabsState.placeholderValues = sessionData.placeholderValues || {};
    tabsState.existingTabPlaceholders = sessionData.existingTabPlaceholders || [];
    tabsState.previewMode = sessionData.previewMode || false;

    // Rebuild tabs with the session data
    if (sessionData.templateContent) {
        buildTabsFromTemplate(sessionData.templateContent, false);
        renderPlaceholdersInTemplate();
    }

    // Restore preview mode if it was active
    if (sessionData.previewMode) {
        setTimeout(() => {
            togglePreviewTab(true);
        }, 100);
    }
}

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

// Re-apply highlights for the currently active container (called on tab switches)
function rehighlightActiveContainer() {
    if (!isGlobalSearchVisible || !elements.globalSearchInput) return;
    const q = elements.globalSearchInput.value.trim();
    if (!q) return;
    const activeId = getActiveContainerId();
    const container = getContainerById(activeId);
    if (!container) return;
    if (container.type === "textarea" && container.element) {
        ensureTextareaHighlightOverlay(container.element);
        const matches = getContainerMatches(container.id);
        let activeIndex = -1;
        if (
            currentGlobalMatchIndex >= 0 &&
            allSearchMatches[currentGlobalMatchIndex] &&
            allSearchMatches[currentGlobalMatchIndex].containerId === container.id
        ) {
            const active = allSearchMatches[currentGlobalMatchIndex];
            activeIndex = matches.findIndex((m) => m.start === active.start && m.end === active.end);
        }
        renderTextareaHighlights(container.element, matches, activeIndex);
        syncTextareaOverlayScroll(container.element);
    } else if (container.element) {
        const matches = getContainerMatches(container.id);
        clearHighlightsInElement(container.element);
        let activeIndex = -1;
        if (
            currentGlobalMatchIndex >= 0 &&
            allSearchMatches[currentGlobalMatchIndex] &&
            allSearchMatches[currentGlobalMatchIndex].containerId === container.id
        ) {
            const active = allSearchMatches[currentGlobalMatchIndex];
            activeIndex = matches.findIndex((m) => m.start === active.start && m.end === active.end);
        }
        applyHighlightsInElement(container.element, matches, activeIndex);
    }
}

// Re-highlight on bootstrap tab switch
document.addEventListener("shown.bs.tab", (event) => {
    try {
        rehighlightActiveContainer();
    } catch (_) {}
    try {
        const target = event.target; // the activated tab button
        if (!target || !target.getAttribute) return;
        const id = target.getAttribute("id") || "";
        if (id === "template-tab") {
            // Focus the main editor when switching back to Template
            setTimeout(() => {
                if (elements.promptArea && elements.promptArea.focus) {
                    elements.promptArea.focus();
                    // Ensure a caret exists so the first Enter works immediately
                    try {
                        const caret = getEditorCaretOffset();
                        setEditorCaretOffset(caret);
                        scrollToCursor();
                    } catch (_) {}
                }
            }, 0);
        } else if (id.startsWith("placeholder-")) {
            const textarea = document.getElementById(`${id}-textarea`);
            if (textarea && textarea.focus) {
                setTimeout(() => textarea.focus(), 0);
            }
        }
    } catch (_) {}
});

function validateTemplateName(name, templates, isSaveAs = false) {
    const trimmedName = name.trim();
    if (!trimmedName) {
        showToast("Template name is required.", 3000, "error", [], "save");
        return { isValid: false, sanitizedName: null };
    }
    if (trimmedName.length > 50) {
        showToast("Template name must be 50 characters or less.", 3000, "error", [], "nameLength");
        return { isValid: false, sanitizedName: null };
    }
    const sanitizedName = trimmedName.replace(/[^a-zA-Z0-9-_.@\s]/g, "");
    if (sanitizedName !== trimmedName) {
        showToast(
            "Template name can include only letters, numbers, underscores (_), hyphens (-), periods (.), at (@), or spaces.",
            4000,
            "error",
            [],
            "nameChar"
        );
        return { isValid: false, sanitizedName: null };
    }
    // Allow updating the same template even when selectedTemplateName is null (draft after undo)
    const currentTarget = selectedTemplateName || editingTargetName || null;
    const isDuplicate = templates.some((t) => t.name === sanitizedName && (isSaveAs || t.name !== currentTarget));
    if (isDuplicate) {
        showModal(
            "Template name must be unique. Please choose a different name.",
            [{ text: "OK", callback: () => {} }],
            "error"
        );
        return { isValid: false, sanitizedName: null };
    }
    return { isValid: true, sanitizedName };
}

function sanitizeTags(input) {
    if (!input) return [];
    const tags = input
        .split(",")
        .map((tag) => tag.trim())
        .filter((tag) => tag);
    if (tags.length > 5) {
        showToast("Maximum of 5 tags allowed per template.", 4000, "error", [], "tagsLength");
        return null;
    }
    const sanitizedTags = tags.map((tag) => tag.replace(/[^a-zA-Z0-9-_.@\s]/g, "").slice(0, 20));
    if (sanitizedTags.some((tag) => tag.length === 0)) {
        showToast(
            "Each tag must contain only letters, numbers, underscores(_), hyphens(-), periods(.), at(@), or spaces, and be 20 characters or less.",
            3000,
            "error",
            [],
            "save"
        );
        return null;
    }
    return sanitizedTags;
}

function parsePlaceholders(templateContent, onlyExistingTabs = false) {
    const placeholderRegex = /\{\{([^}]+)\}\}/g;
    const placeholders = [];
    const placeholderPositions = new Map();
    let match;

    // Use the runtime-merged allowed list (defaults + user-defined)
    const allowedPlaceholders = onlyExistingTabs ? tabsState.existingTabPlaceholders : ALLOWED_PLACEHOLDERS;
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
                original: match[0],
            });
        }
    }
    return { placeholders, placeholderPositions };
}

function findTextNodeAndOffset(container, charOffset) {
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null, false);
    let currentPos = 0;
    let node = walker.nextNode();
    let lastValidNode = null;
    
    while (node) {
        // Skip text nodes inside non-editable elements (like placeholder spans)
        let parent = node.parentNode;
        let isEditable = true;
        while (parent && parent !== container) {
            if (parent.getAttribute && parent.getAttribute('contenteditable') === 'false') {
                isEditable = false;
                break;
            }
            parent = parent.parentNode;
        }
        
        if (isEditable) {
            lastValidNode = node;
            const nodeLength = node.textContent.length;
            if (currentPos + nodeLength >= charOffset) {
                return { node, offset: Math.min(charOffset - currentPos, nodeLength) };
            }
            currentPos += nodeLength;
        } else {
            // Count the text but don't consider it as a valid position
            currentPos += node.textContent.length;
        }
        
        node = walker.nextNode();
    }
    
    // If we couldn't find a valid position, return the last valid text node
    if (lastValidNode) {
        return { node: lastValidNode, offset: lastValidNode.textContent.length };
    }
    
    // Fallback: return the container itself
    return { node: container, offset: 0 };
}

// Compute character offset from the start of a container to a specific DOM position
function getCharOffset(container, node, nodeOffset) {
    try {
        const range = document.createRange();
        range.selectNodeContents(container);
        range.setEnd(node, nodeOffset);
        return range.toString().length;
    } catch (_) {
        // Fallback: linear walk through text nodes
        let offset = 0;
        const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null, false);
        let current;
        while ((current = walker.nextNode())) {
            if (current === node) {
                offset += Math.min(nodeOffset, current.textContent.length);
                break;
            }
            offset += current.textContent.length;
        }
        return offset;
    }
}

// Safe deep clone for plain data structures (templates arrays/objects)
function deepClone(obj) {
    try {
        return JSON.parse(JSON.stringify(obj));
    } catch (_) {
        // Fallback shallow copy
        if (Array.isArray(obj)) return obj.map((x) => ({ ...x }));
        if (obj && typeof obj === "object") return { ...obj };
        return obj;
    }
}

function hasUnsavedChanges() {
    if (!selectedTemplateName) {
        // For new templates, check if there's any meaningful content
        const defaultName = getDefaultTemplateName();
        const hasName = elements.templateName.value.trim() !== defaultName && elements.templateName.value.trim() !== "";
        const hasTags = elements.templateTags.value.trim() !== "";
        const hasContent =
            elements.promptArea.textContent.trim() !== "" &&
            elements.promptArea.textContent.trim() !== `# Your Role\n*\n\n# Background Information\n*\n\n# Your Task\n*`;
        const hasPlaceholderValues = Object.values(tabsState.placeholderValues).some(
            (value) => value && value.trim() !== ""
        );

        return hasName || hasTags || hasContent || hasPlaceholderValues;
    }

    // For existing templates, compare with stored version
    return new Promise((resolve) => {
        chrome.storage.local.get(["templates"], (result) => {
            const templates = result.templates || [];
            const currentTemplate = templates.find((t) => t.name === selectedTemplateName);

            if (!currentTemplate) {
                resolve(true); // Template was deleted externally
                return;
            }

            const nameChanged = elements.templateName.value.trim() !== currentTemplate.name;
            const tagsChanged =
                elements.templateTags.value !==
                (Array.isArray(currentTemplate.tags) ? currentTemplate.tags.join(", ") : "");
            const contentChanged = elements.promptArea.textContent !== currentTemplate.content;
            const hasPlaceholderValues = Object.values(tabsState.placeholderValues).some(
                (value) => (value || "").trim() !== ""
            );

            resolve(nameChanged || tagsChanged || contentChanged || hasPlaceholderValues);
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
let currentOperationId = null;
let nextToastTimeout = null;
const toastTimestamps = {};
let isUndoToastVisible = false; // Track if an undo-eligible toast is currently visible

// Modal notification state
let isModalShowing = false;
let modalCloseCallback = null;

// Track the logical template we are editing (even if we temporarily mark the UI as unsaved/draft)
let editingTargetName = null;

// --- Editor Undo/Redo State ---
let editorUndoStack = [];
let editorRedoStack = [];
let editorLastSnapshot = "";
let editorLastCaret = 0;

// --- Tags Input Undo/Redo State ---
let tagsUndoStack = [];
let tagsRedoStack = [];
let tagsLastSnapshot = "";
let tagsLastCaret = 0;
let tagsStackContextSerial = 0; // isolate across templates/contexts

// --- Template Name Input Undo/Redo State ---
let nameUndoStack = [];
let nameRedoStack = [];
let nameLastSnapshot = "";
let nameLastCaret = 0;
let nameStackContextSerial = 0; // isolate across templates/contexts

// Bumped whenever context changes (switch template, new template, save-undo unsaves)
let contextSerial = 1;

// --- Content Finder State ---
let isGlobalSearchVisible = false;
let currentSearchMatches = [];
let currentMatchIndex = -1;
let searchHighlightClass = "content-search-highlight";
// Global scope across all containers (Template, Placeholder tabs, Preview)
let allSearchMatches = [];
let currentGlobalMatchIndex = -1;
let searchContainers = [];

const elements = {};
const ALLOWED_PLACEHOLDERS = [];
const tabsState = {
    placeholders: [],
    placeholderValues: {},
    currentTemplate: "",
    previewMode: false,
    existingTabPlaceholders: [], // Track which placeholders already have tabs
};

// --- Initialization and Core Logic ---

document.addEventListener("DOMContentLoaded", () => {
    [
        "searchBox",
        "dropdownResults",
        "template",
        "templateName",
        "templateTags",
        "tagsDisplay",
        "tagsView",
        "editTagsBtn",
        "cancelTagsEditBtn",
        "promptArea",
        "previewArea",
        "buttons",
        "fetchBtn",
        "fetchBtn2",
        "saveBtn",
        "saveAsBtn",
        "deleteBtn",
        "clearSearch",
        "clearPrompt",
        "clearAllBtn",
        "findBtn",
        "sendBtn",
        "favoriteSuggestions",
        "fullscreenToggle",
        "closeBtn",
        "newBtn",
        "searchOverlay",
        "toast",
        "modalOverlay",
        "modalNotification",
        "themeToggle",
        "importBtn",
        "importFileInput",
        "exportAllBtn",
        "exportSingleBtn",
        "scroll-left-btn",
        "scroll-right-btn",
        "globalSearchWidget",
        "globalSearchInput",
        "globalSearchClose",
        "searchMatchCount",
        "searchPrevious",
        "searchNext",
        "updateBanner",
        "whatsNewLink",
        "dismissBanner",
    ].forEach((id) => {
        elements[id] = document.getElementById(id);
    });

    const missingElements = Object.entries(elements)
        .filter(([key, value]) => !value)
        .map(([key]) => key);
    if (missingElements.length > 0) {
        showToast("Error: Extension UI failed to load. Please reload the extension.", 3000, "error", [], "init");
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

    // First, try to load any unsaved changes from session storage
    loadFromSession((sessionData) => {
        chrome.storage.local.get(
            [
                "popupState",
                "theme",
                "extensionVersion",
                "recentIndices",
                "templates",
                "nextIndex",
                "isFullscreen",
                "placeholderValues",
                "userPlaceholders",
            ],
            (result) => {
                const userPlaceholders = Array.isArray(result.userPlaceholders) ? result.userPlaceholders : [];
                // Merge user-defined placeholders into the allowed list (dedupe)
                userPlaceholders.forEach((ph) => {
                    if (typeof ph === "string") {
                        const trimmed = ph.trim();
                        if (trimmed && !ALLOWED_PLACEHOLDERS.includes(trimmed)) {
                            ALLOWED_PLACEHOLDERS.push(trimmed);
                        }
                    }
                });
                const storedVersion = result.extensionVersion || "0.0.0";
                if (storedVersion !== EXTENSION_VERSION) {
                    // Version has changed, check if we should show the update banner
                    chrome.storage.local.get(["updateBannerDismissedVersion"], (bannerResult) => {
                        const dismissedVersion = bannerResult.updateBannerDismissedVersion || "0.0.0";
                        // Show banner if this version hasn't been dismissed yet
                        if (dismissedVersion !== EXTENSION_VERSION) {
                            showUpdateBanner();
                        }
                    });
                    chrome.storage.local.set({ extensionVersion: EXTENSION_VERSION });
                }

                currentTheme = result.theme || "light";
                document.body.className = currentTheme;

                nextIndex = result.nextIndex || defaultTemplates.length;
                recentIndices = result.recentIndices || [];
                isFullscreen = result.isFullscreen || false;
                elements.fullscreenToggle
                    .querySelector("svg use")
                    .setAttribute("href", isFullscreen ? "sprite.svg#compress" : "sprite.svg#fullscreen");

                const state = result.popupState || {};
                originalTagsBeforeEdit = state.originalTags || null;
                const isTagsInEditMode = state.isTagsInEditMode === undefined ? true : state.isTagsInEditMode;

                const defaultText = `# Your Role\n*\n\n# Background Information\n*\n\n# Your Task\n*`;

                // Check if we have session data to restore
                if (sessionData && sessionData.timestamp) {
                    // Session exists - restore from session (same Chrome session)
                    elements.templateName.value = sessionData.templateName || state.name || getDefaultTemplateName();
                    elements.templateTags.value = sessionData.templateTags || state.tags || "";
                    tabsState.currentTemplate = sessionData.templateContent || state.content || defaultText;
                    elements.promptArea.textContent = tabsState.currentTemplate;
                    tabsState.placeholderValues = sessionData.placeholderValues || result.placeholderValues || {};
                    tabsState.previewMode = sessionData.previewMode || state.previewMode || false;
                    tabsState.existingTabPlaceholders = sessionData.existingTabPlaceholders || [];
                    selectedTemplateName = sessionData.selectedTemplateName || state.selectedName || null;
                    editingTargetName =
                        sessionData.editingTargetName || state.editingTargetName || selectedTemplateName || null;
                } else {
                    // No session data - this is a new Chrome session, start with new template
                    // Don't restore selected template from localStorage
                    selectedTemplateName = null;
                    editingTargetName = null;
                    elements.templateName.value = getDefaultTemplateName();
                    elements.templateTags.value = "";
                    tabsState.currentTemplate = defaultText;
                    elements.promptArea.textContent = defaultText;
                    tabsState.placeholderValues = {};
                    tabsState.previewMode = false;
                    tabsState.existingTabPlaceholders = [];
                }

                if (!isTagsInEditMode && (state.tags || selectedTemplateName)) {
                    switchToTagsViewMode();
                } else {
                    switchToTagsEditMode();
                }

                elements.fetchBtn2.style.display = elements.promptArea.textContent ? "none" : "block";
                elements.clearPrompt.style.display = elements.promptArea.textContent ? "block" : "none";
                if (tabsState.currentTemplate) {
                    // When loading a saved template, parse to get its existing placeholders
                    const { placeholders } = parsePlaceholders(tabsState.currentTemplate, false);
                    tabsState.existingTabPlaceholders = [...placeholders];
                    buildTabsFromTemplate(tabsState.currentTemplate, true); // Allow all placeholders on initial load
                    renderPlaceholdersInTemplate(); // Re-render placeholders with saved values

                    // Restore preview mode with transitions suppressed, then re-enable them
                    if (tabsState.previewMode) {
                        const tabsList = document.getElementById("editorTabs");
                        const previewTabItem = document.getElementById("preview-tab-item");
                        const previewPanel = document.getElementById("preview-panel");
                        const templatePanel = document.getElementById("template-panel");
                        const previewTabLink = document.getElementById("preview-tab");
                        const templateTabLink = document.getElementById("template-tab");

                        if (previewTabItem && previewPanel && templatePanel && tabsList && previewTabLink) {
                            // Ensure Preview tab button is visible and hide placeholder tabs
                            previewTabItem.style.display = "block";
                            tabsList.querySelectorAll("li:not(:first-child):not(#preview-tab-item)").forEach((tab) => {
                                tab.style.display = "none";
                            });

                            // Temporarily remove fade to avoid initial transition flicker
                            const hadFadePreview = previewPanel.classList.contains("fade");
                            const hadFadeTemplate = templatePanel.classList.contains("fade");
                            previewPanel.classList.remove("fade");
                            templatePanel.classList.remove("fade");

                            // Use Bootstrap API to set the correct active state
                            updatePreviewArea();
                            const tab = bootstrap.Tab.getOrCreateInstance(previewTabLink);
                            tab.show();
                            // Force button active states and aria for first interaction to be correct
                            previewTabLink.classList.add("active");
                            previewTabLink.setAttribute("aria-selected", "true");
                            if (templateTabLink) {
                                templateTabLink.classList.remove("active");
                                templateTabLink.setAttribute("aria-selected", "false");
                            }

                            // Restore fade classes on next frame so subsequent switches animate
                            requestAnimationFrame(() => {
                                if (hadFadePreview) previewPanel.classList.add("fade");
                                if (hadFadeTemplate) templatePanel.classList.add("fade");
                            });
                        }
                    }
                }

                // Initialize editor undo tracking with the loaded content
                editorUndoStack = [];
                editorRedoStack = [];
                editorLastSnapshot = tabsState.currentTemplate || "";

                // Initialize tags undo tracking with the loaded content
                tagsUndoStack = [];
                tagsRedoStack = [];
                tagsLastSnapshot = elements.templateTags.value || "";
                tagsLastCaret = 0;

                // Initialize template name undo tracking with the loaded content
                nameUndoStack = [];
                nameRedoStack = [];
                nameLastSnapshot = elements.templateName.value || "";
                nameLastCaret = 0;

                updateSaveButtonState();
                updateDeleteButtonState();
                updateExportSingleBtnState();

                let templates = result.templates;
                if (!templates) {
                    templates = defaultTemplates.map((t, i) => {
                        // Check if tags are a string and convert them to an array
                        const tagsArray =
                            typeof t.tags === "string"
                                ? t.tags
                                      .split(",")
                                      .map((tag) => tag.trim())
                                      .filter(Boolean)
                                : t.tags || []; // Use existing array or default to empty

                        return { ...t, tags: tagsArray, index: i };
                    });
                    chrome.storage.local.set({ templates });
                }
            }
        );
    });
}

function setupEventListeners() {
    elements.templateTags.addEventListener(
        "input",
        debounce(() => {
            validateTagsInput();
            saveState();
        }, 100)
    );
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
        if (lastState) lastState.actionType = "clearPrompt";
        elements.promptArea.textContent = "";
        elements.fetchBtn2.style.display = "block";
        elements.clearPrompt.style.display = "none";
        destroyTabs();
        saveState();
        showToast("Prompt cleared. Use Ctrl+Z/Cmd+Z to undo.", 3000, "info", [], "clearPrompt");
        // Move focus out of the editor so UI-level Ctrl+Z works immediately
        moveFocusOutOfEditor();
    });

    // Preview tab close button event listener
    const previewCloseBtn = document.getElementById("preview-close-btn");
    if (previewCloseBtn) {
        previewCloseBtn.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            togglePreviewTab(false);
        });
    }
    elements.clearAllBtn.addEventListener("click", () => {
        storeLastState();
        if (lastState) lastState.actionType = "clearAll";
        elements.templateName.value = "";
        elements.templateTags.value = "";
        tabsState.currentTemplate = template.content;
        elements.promptArea.textContent = template.content;
        selectedTemplateName = template.name;
        originalTagsBeforeEdit = null;
        switchToTagsEditMode();
        destroyTabs();
        tabsState.existingTabPlaceholders = []; // Clear existing tabs for new template
        buildTabsFromTemplate(tabsState.currentTemplate);
        elements.fetchBtn2.style.display = "block";
        elements.clearPrompt.style.display = "none";
        elements.searchBox.value = "";
        updateExportSingleBtnState();
        updateSaveButtonState();
        updateDeleteButtonState();
        saveState();
        showToast("All fields cleared. Use Ctrl+Z/Cmd+Z to undo.", 3000, "info", [], "clearAll");
    });

    elements.findBtn.addEventListener("click", () => {
        toggleGlobalSearch();
    });

    elements.themeToggle.addEventListener("click", () => {
        currentTheme = currentTheme === "light" ? "dark" : "light";
        document.body.className = currentTheme;
        saveState();
    });
    elements.fullscreenToggle.addEventListener("click", () => {
        isFullscreen = !isFullscreen;
        saveState();
        elements.fullscreenToggle
            .querySelector("svg use")
            .setAttribute("href", isFullscreen ? "sprite.svg#compress" : "sprite.svg#fullscreen");
        chrome.runtime.sendMessage({ action: "toggleFullscreen" });
    });
    elements.closeBtn.addEventListener("click", handleCloseWithUnsavedCheck);
    elements.newBtn.addEventListener("click", () => handleNewTemplate());
    elements.editTagsBtn.addEventListener("click", () => handleEditTags());
    elements.cancelTagsEditBtn.addEventListener("click", () => handleCancelTagsEdit());
    
    // Update banner event listeners
    if (elements.whatsNewLink) {
        elements.whatsNewLink.addEventListener("click", (e) => {
            e.preventDefault();
            // Open Chrome Web Store page
            chrome.tabs.create({ 
                url: "https://chromewebstore.google.com/detail/promptstash-chatgpt-grok/fjbacajcjnfbpjladgkkkckfcemehbpa"
            });
            hideUpdateBanner(true);
        });
    }
    
    if (elements.dismissBanner) {
        elements.dismissBanner.addEventListener("click", () => {
            hideUpdateBanner(true);
        });
    }

    elements.templateName.addEventListener(
        "input",
        debounce(() => {
            handleNameInput();
            validateTemplateNameInput();
            updateExportSingleBtnState();
            saveState();
        }, 10)
    );
    elements.templateName.addEventListener("keydown", handleNameKeydown);
    elements.templateTags.addEventListener(
        "input",
        debounce(() => {
            handleTagsInput();
            validateTagsInput();
            saveState();
        }, 100)
    );
    elements.templateTags.addEventListener("keydown", handleTagsKeydown);
    elements.promptArea.addEventListener("input", handlePromptInput);
    
    // Prevent promptArea from stealing focus when search is active
    elements.promptArea.addEventListener("focus", (e) => {
        if (isGlobalSearchVisible) {
            // Immediately blur the promptArea and refocus search input
            elements.promptArea.blur();
            setTimeout(() => {
                if (elements.globalSearchInput && isGlobalSearchVisible) {
                    elements.globalSearchInput.focus();
                }
            }, 0);
        }
    });
    // Only normalize caret on mouseup when clicking at the very end, not on every keyup
    elements.promptArea.addEventListener("mouseup", (e) => {
        // Don't handle mouseup if search is visible - prevents focus stealing
        if (isGlobalSearchVisible) return;
        
        // Only normalize if clicking at the very end of the content
        const selection = window.getSelection();
        if (selection.rangeCount > 0) {
            const range = selection.getRangeAt(0);
            const isAtEnd = range.collapsed && range.endContainer === elements.promptArea.lastChild;
            if (isAtEnd) {
                normalizeCaretPosition();
            }
        }
    });
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

    // Global search event listeners
    setupGlobalSearchListeners();
    setupTabSlider();
}

// --- Content Finder Functions ---

function setupGlobalSearchListeners() {
    if (elements.globalSearchInput) {
        elements.globalSearchInput.addEventListener(
            "input",
            debounce(() => {
                // Ensure search input maintains focus during search
                const hadFocus = document.activeElement === elements.globalSearchInput;
                performContentSearch(elements.globalSearchInput.value);
                // Restore focus after search if it was lost
                if (hadFocus && document.activeElement !== elements.globalSearchInput) {
                    setTimeout(() => {
                        elements.globalSearchInput.focus();
                    }, 0);
                }
            }, 100)
        );

        elements.globalSearchInput.addEventListener("keydown", (e) => {
            console.log("757");
            if (e.key === "Escape") {
                hideGlobalSearch();
            } else if (e.key === "Enter") {
                e.preventDefault();
                if (e.shiftKey) {
                    navigateToPreviousMatch();
                } else {
                    navigateToNextMatch();
                }
            }
        });
    }

    if (elements.globalSearchClose) {
        elements.globalSearchClose.addEventListener("click", () => {
            hideGlobalSearch();
        });
    }

    if (elements.searchNext) {
        elements.searchNext.addEventListener("click", () => {
            navigateToNextMatch();
        });
    }

    if (elements.searchPrevious) {
        elements.searchPrevious.addEventListener("click", () => {
            navigateToPreviousMatch();
        });
    }

    // Auto-save session when popup loses focus (tab switch, outside click)
    // This preserves unsaved changes when user switches tabs or clicks outside
    window.addEventListener("blur", () => {
        // Save current state to session when window loses focus
        saveToSession();
    });

    // Also save when document visibility changes (tab switch)
    document.addEventListener("visibilitychange", () => {
        if (document.hidden) {
            // Save when tab becomes hidden
            saveToSession();
        }
    });

    // Save before unload (popup closing naturally, not via X button)
    window.addEventListener("beforeunload", () => {
        saveToSession();
    });
}

// Receive shortcut forwarded from host page (content script/background) to toggle finder
window.addEventListener("message", (e) => {
    const data = e && e.data;
    if (data && data.type === "promptstash:toggleFind") {
        toggleGlobalSearch();
    }
});

function toggleGlobalSearch() {
    if (isGlobalSearchVisible) {
        hideGlobalSearch();
    } else {
        showGlobalSearch();
    }
}

function showGlobalSearch() {
    if (!elements.globalSearchWidget) return;

    isGlobalSearchVisible = true;
    elements.globalSearchWidget.style.display = "block";

    // Trigger animation after a small delay to ensure display is set
    requestAnimationFrame(() => {
        elements.globalSearchWidget.classList.add("show");
    });

    // Focus input after animation starts
    setTimeout(() => {
        elements.globalSearchInput.focus();
    }, 50);

    elements.globalSearchInput.value = "";
    // Mark finder-open for CSS overlays
    try {
        document.body.classList.add("ps-finder-open");
    } catch (_) {}
    clearSearchHighlights();
    updateMatchCount();
}

function hideGlobalSearch() {
    if (!elements.globalSearchWidget) return;

    isGlobalSearchVisible = false;

    // Start closing animation
    elements.globalSearchWidget.classList.remove("show");

    // Hide after animation completes
    setTimeout(() => {
        elements.globalSearchWidget.style.display = "none";
    }, 300); // Match the CSS transition duration

    elements.globalSearchInput.value = "";
    clearSearchHighlights();
    currentSearchMatches = [];
    // Remove finder-open marker
    try {
        document.body.classList.remove("ps-finder-open");
    } catch (_) {}
    updateMatchCount();
}

function performContentSearch(query) {
    // Clear previous search highlights completely
    clearSearchHighlights();
    currentSearchMatches = [];
    currentMatchIndex = -1;
    allSearchMatches = [];
    currentGlobalMatchIndex = -1;

    const cleanQuery = (query || "").trim();
    if (!cleanQuery) {
        // Ensure all textarea overlays are cleared when search is empty
        const overlayContents = document.querySelectorAll(".ps-highlight-content");
        overlayContents.forEach((content) => {
            content.innerHTML = "";
        });
        updateMatchCount();
        return;
    }
    
    // Store the currently focused element before applying highlights
    const currentlyFocused = document.activeElement;

    // Build container scope in desired order: Template -> Placeholder tabs -> Preview
    searchContainers = collectSearchContainers();

    // Escape special regex characters and create pattern for exact matches only
    const escaped = cleanQuery.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // Use word boundary or case-insensitive flag for exact character/word matching
    const regex = new RegExp(escaped, "gi");

    // Aggregate matches across all containers
    searchContainers.forEach((c) => {
        const text = c.getText();
        if (!text) return;
        let m;
        regex.lastIndex = 0; // Reset regex before each container
        while ((m = regex.exec(text)) !== null) {
            allSearchMatches.push({ containerId: c.id, start: m.index, end: m.index + m[0].length, text: m[0] });
            // Don't manually reset lastIndex - let regex advance naturally
            // This prevents overlapping matches for single characters
            if (m[0].length === 0) {
                // Only handle zero-length matches to avoid infinite loop
                regex.lastIndex = m.index + 1;
            }
        }
    });

    if (allSearchMatches.length === 0) {
        updateMatchCount();
        return;
    }

    // Prefer matches in the currently active tab/panel; do not auto-switch away
    const activeId = getActiveContainerId();
    const firstInActive = allSearchMatches.findIndex((m) => m.containerId === activeId);
    if (firstInActive !== -1) {
        currentGlobalMatchIndex = firstInActive;
        focusGlobalMatch(currentGlobalMatchIndex);
    } else {
        // No match in current container: stay on current tab
        // Don't focus any match yet - let user press Enter to start navigation
        currentGlobalMatchIndex = -1;
        currentSearchMatches = [];
        currentMatchIndex = -1;
        // If the active container is a placeholder textarea, update its overlay to clear highlights
        const activeContainer = getContainerById(activeId);
        if (activeContainer && activeContainer.type === "textarea" && activeContainer.element) {
            try {
                ensureTextareaHighlightOverlay(activeContainer.element);
                const matchesInActive = getContainerMatches(activeId);
                renderTextareaHighlights(activeContainer.element, matchesInActive, -1);
                syncTextareaOverlayScroll(activeContainer.element);
            } catch (_) {}
        }
    }
    updateMatchCount();
    
    // Restore focus to the search input if it was focused before
    if (currentlyFocused === elements.globalSearchInput && isGlobalSearchVisible) {
        // Use setTimeout to ensure focus is restored after all DOM manipulations
        setTimeout(() => {
            if (elements.globalSearchInput && isGlobalSearchVisible) {
                elements.globalSearchInput.focus();
            }
        }, 0);
    }
}

// Build the list of searchable containers in navigation order
function collectSearchContainers() {
    const containers = [];

    // Template container
    if (elements.promptArea) {
        containers.push({
            id: "template",
            type: "contenteditable",
            element: elements.promptArea,
            panelId: "template-panel",
            getText: () => {
                // Get text from the DOM as it's rendered, not the raw template
                // This ensures search matches align with what's actually displayed
                return elements.promptArea.textContent || "";
            },
        });
    }

    // Placeholder tabs in visual order
    const tabsList = document.getElementById("editorTabs");
    if (tabsList) {
        const buttons = Array.from(tabsList.querySelectorAll("li .nav-link")).filter(
            (btn) => btn.id && btn.id.startsWith("placeholder-")
        );
        buttons.forEach((btn) => {
            const id = btn.id; // placeholder-<name>
            const textId = `${id}-textarea`;
            const textarea = document.getElementById(textId);
            const placeholderName = id.replace(/^placeholder-/, "").replace(/-/g, " ");
            containers.push({
                id,
                type: "textarea",
                element: textarea,
                panelId: `${id}-panel`,
                placeholder: placeholderName,
                getText: () => (textarea ? textarea.value : tabsState.placeholderValues[placeholderName] || ""),
            });
        });
    }

    // Preview container - only include if template has placeholders (preview tab should be available)
    const hasPlaceholders = tabsState.placeholders && tabsState.placeholders.length > 0;
    if (elements.previewArea && hasPlaceholders) {
        containers.push({
            id: "preview",
            type: "div",
            element: elements.previewArea,
            panelId: "preview-panel",
            getText: () => getPreviewTextContent(),
        });
    }

    return containers;
}

// Identify the active container (template, a specific placeholder tab, or preview)
function getActiveContainerId() {
    const activePanel = document.querySelector(".tab-pane.active");
    if (!activePanel) return "template";
    const id = activePanel.id || "";
    if (id === "template-panel") return "template";
    if (id === "preview-panel") return "preview";
    if (id.startsWith("placeholder-") && id.endsWith("-panel")) {
        return id.replace(/-panel$/, "");
    }
    return "template";
}

// Toggle readOnly on placeholder textareas to prevent accidental editing during Finder
function setPlaceholderTextareasReadonly(flag) {
    try {
        const panels = document.getElementById("tabPanels");
        if (!panels) return;
        panels.querySelectorAll(".tab-pane textarea").forEach((ta) => {
            ta.readOnly = !!flag;
        });
    } catch (_) {}
}

function getContainerById(id) {
    return searchContainers.find((c) => c.id === id);
}

function getContainerMatches(containerId) {
    return allSearchMatches.filter((m) => m.containerId === containerId);
}

function focusGlobalMatch(globalIndex) {
    const match = allSearchMatches[globalIndex];
    if (!match) return;
    const container = getContainerById(match.containerId);
    if (!container) return;

    // Ensure the correct tab/panel is visible for this container
    ensureContainerVisible(container);

    // Apply per-container focus/highlight behavior
    if (container.type === "textarea" && container.element) {
        // Textarea: do not move focus into the editor; only update overlay highlight
        // Highlight ALL matches in this container, with the current one as active
        const containerMatches = getContainerMatches(container.id);
        currentSearchMatches = containerMatches;
        // Find the index of the current active match within this container's matches
        currentMatchIndex = containerMatches.findIndex((m) => m.start === match.start && m.end === match.end);
        if (currentMatchIndex === -1) currentMatchIndex = 0;

        // Build/update overlay highlight for the textarea (with all matches)
        try {
            const ta = container.element;
            ensureTextareaHighlightOverlay(ta);
            renderTextareaHighlights(ta, currentSearchMatches, currentMatchIndex);
            syncTextareaOverlayScroll(ta);
        } catch (_) {}
        // Do not change focus here; keep user's current focus (e.g., typing in textarea)
        updateMatchCount();
        return;
    }

    // Contenteditable/div containers: highlight ALL matches in this container
    const containerMatches = getContainerMatches(container.id);
    currentSearchMatches = containerMatches;
    // Find the index of the current active match within this container's matches
    currentMatchIndex = containerMatches.findIndex((m) => m.start === match.start && m.end === match.end);
    if (currentMatchIndex === -1) currentMatchIndex = 0;

    if (container.element) {
        // Clear highlights only in the target container to preserve others
        clearHighlightsInElement(container.element);
        // Highlight all matches in this container, with the current one as active
        applyHighlightsInElement(container.element, currentSearchMatches, currentMatchIndex);
        scrollToMatch(currentMatchIndex, container.element);
    }
}

// Ensure overlay elements for a placeholder textarea exist and are wired
function ensureTextareaHighlightOverlay(textarea) {
    if (!textarea || !textarea.parentElement) return null;
    const wrapper = textarea.parentElement; // panelContentWrapper (position-relative)
    let layer = wrapper.querySelector(".ps-highlight-layer");
    if (!layer) {
        layer = document.createElement("div");
        layer.className = "ps-highlight-layer";
        const content = document.createElement("div");
        content.className = "ps-highlight-content";
        layer.appendChild(content);
        wrapper.insertBefore(layer, textarea); // place behind textarea in DOM
    }
    const content = layer.querySelector(".ps-highlight-content");

    // Copy key text metrics from textarea so overlay lines wrap identically
    try {
        const cs = getComputedStyle(textarea);
        content.style.fontFamily = cs.fontFamily;
        content.style.fontSize = cs.fontSize;
        content.style.lineHeight = cs.lineHeight;
        content.style.letterSpacing = cs.letterSpacing;
        // Match padding to align text
        content.style.paddingTop = cs.paddingTop;
        content.style.paddingRight = cs.paddingRight;
        content.style.paddingBottom = cs.paddingBottom;
        content.style.paddingLeft = cs.paddingLeft;
    } catch (_) {}

    // Sync scroll
    if (!textarea.__psScrollSync) {
        textarea.addEventListener("scroll", () => syncTextareaOverlayScroll(textarea));
        textarea.__psScrollSync = true;
    }
    return { layer, content };
}

function syncTextareaOverlayScroll(textarea) {
    try {
        const wrapper = textarea.parentElement;
        const layer = wrapper && wrapper.querySelector(".ps-highlight-layer");
        const content = layer && layer.querySelector(".ps-highlight-content");
        if (content) {
            content.style.transform = `translate(${-textarea.scrollLeft}px, ${-textarea.scrollTop}px)`;
        }
    } catch (_) {}
}

// Render overlay highlights for a textarea from its matches
function renderTextareaHighlights(textarea, matches, activeIndex) {
    if (!textarea || !Array.isArray(matches)) return;
    const wrapper = textarea.parentElement;
    const layer = wrapper && wrapper.querySelector(".ps-highlight-layer");
    const content = layer && layer.querySelector(".ps-highlight-content");
    if (!content) return;

    const text = textarea.value || "";
    if (!text) {
        content.innerHTML = "";
        return;
    }

    const parts = [];
    let last = 0;
    const sorted = [...matches].sort((a, b) => a.start - b.start);
    sorted.forEach((m, i) => {
        if (m.start > last) parts.push(escapeHtml(text.slice(last, m.start)));
        const cls = i === activeIndex ? "content-search-highlight active" : "content-search-highlight";
        parts.push(`<span class="${cls}">` + escapeHtml(text.slice(m.start, m.end)) + "</span>");
        last = m.end;
    });
    if (last < text.length) parts.push(escapeHtml(text.slice(last)));
    content.innerHTML = parts.join("");
}

function ensureContainerVisible(container) {
    // Switch tabs/panels as needed
    if (container.id === "template") {
        const templateTab = document.getElementById("template-tab");
        if (templateTab) new bootstrap.Tab(templateTab).show();
        // If preview mode hides placeholders, it's fine for template
        return;
    }
    if (container.id === "preview") {
        // Ensure preview is visible and populated
        togglePreviewTab(true);
        // updatePreviewArea will run inside togglePreviewTab; also re-apply highlights after tab switch
        setTimeout(() => {
            try {
                rehighlightActiveContainer();
            } catch (_) {}
        }, 0);
        return;
    }
    // Placeholder tab
    if (container.id.startsWith("placeholder-")) {
        // Make sure placeholder tabs are visible
        if (tabsState.previewMode) togglePreviewTab(false);
        const tabButton = document.getElementById(container.id);
        if (tabButton) new bootstrap.Tab(tabButton).show();
    }
}

function highlightMatches(searchTerm, targetElement = elements.promptArea, originalContent = null) {
    const content = targetElement.textContent || targetElement.value || "";

    // Only highlight in contenteditable elements or divs, not textareas
    if (targetElement.tagName === "TEXTAREA") {
        // For textareas, we can't highlight, so just store the matches
        return;
    }

    // Apply highlights non-destructively using DOM Ranges so existing
    // placeholder markup and event listeners are preserved
    const matchesDesc = [...currentSearchMatches].sort((a, b) => b.start - a.start);

    matchesDesc.forEach((match) => {
        try {
            const startPos = findTextNodeAndOffset(targetElement, match.start);
            const endPos = findTextNodeAndOffset(targetElement, match.end);
            if (!startPos.node || !endPos.node) return;

            const range = document.createRange();
            range.setStart(startPos.node, Math.max(0, startPos.offset));
            range.setEnd(endPos.node, Math.max(0, endPos.offset));

            const wrapper = document.createElement("span");
            wrapper.className = "content-search-highlight";
            range.surroundContents(wrapper);
        } catch (_) {
            // Ignore ranges that cannot be wrapped safely
        }
    });
}

function clearSearchHighlights() {
    // Clear ALL search highlights from the entire document

    // 1. Clear all highlight spans everywhere in the document
    const allHighlights = document.querySelectorAll(".content-search-highlight");
    allHighlights.forEach((span) => {
        // If it's a placeholder marker with highlight classes, just remove the classes
        if (span.classList.contains("placeholder-marker")) {
            span.classList.remove("content-search-highlight", "active");
        } else {
            // Otherwise, unwrap the highlight span
            const parent = span.parentNode;
            if (!parent) return;
            while (span.firstChild) parent.insertBefore(span.firstChild, span);
            parent.removeChild(span);
        }
    });

    // 2. Clear highlights in placeholder textarea overlays
    const overlayContents = document.querySelectorAll(".ps-highlight-content");
    overlayContents.forEach((content) => {
        content.innerHTML = "";
    });

    // 3. Normalize text nodes in main containers
    const containers = [elements.promptArea, elements.previewArea].filter(Boolean);
    containers.forEach((container) => {
        container.normalize();
    });
}

// Remove highlight wrappers inside a single container element
function clearHighlightsInElement(container) {
    if (!container) return;
    
    // Store focus before DOM manipulation
    const previouslyFocused = document.activeElement;
    const shouldRestoreFocus = isGlobalSearchVisible && previouslyFocused === elements.globalSearchInput;

    // Special handling for Preview area - remove highlight classes from placeholder spans
    if (container === elements.previewArea) {
        const placeholderSpans = container.querySelectorAll(".placeholder-marker");
        placeholderSpans.forEach((span) => {
            span.classList.remove("content-search-highlight", "active");
        });
    }

    // Clear any nested highlights inside placeholder markers
    const nestedHighlights = container.querySelectorAll(".placeholder-marker .content-search-highlight");
    nestedHighlights.forEach((span) => {
        const parent = span.parentNode;
        if (!parent) return;
        while (span.firstChild) parent.insertBefore(span.firstChild, span);
        parent.removeChild(span);
    });

    const highlights = container.querySelectorAll(".content-search-highlight:not(.placeholder-marker)");
    highlights.forEach((span) => {
        const parent = span.parentNode;
        if (!parent) return;
        while (span.firstChild) parent.insertBefore(span.firstChild, span);
        parent.removeChild(span);
    });
    container.normalize();
    
    // Restore focus if needed
    if (shouldRestoreFocus) {
        setTimeout(() => {
            if (elements.globalSearchInput && isGlobalSearchVisible) {
                elements.globalSearchInput.focus();
            }
        }, 0);
    }
}

// Apply non-destructive highlights for a given element using provided matches
function applyHighlightsInElement(element, matches, activeIndex) {
    if (!element || !Array.isArray(matches) || element.tagName === "TEXTAREA") return;

    // Store the currently focused element before DOM manipulation
    const previouslyFocused = document.activeElement;
    const shouldRestoreFocus = isGlobalSearchVisible && previouslyFocused === elements.globalSearchInput;

    // Check if this element contains placeholder spans (Template or Preview)
    const placeholderSpans = element.querySelectorAll(".placeholder-marker");
    if (placeholderSpans.length > 0) {
        // Use the specialized function for elements with placeholder spans
        applyHighlightsInPreview(element, matches, activeIndex);
        // Restore focus if needed
        if (shouldRestoreFocus) {
            setTimeout(() => {
                elements.globalSearchInput.focus();
            }, 0);
        }
        return;
    }

    // Apply in reverse order so offsets remain valid (for plain text elements)
    const matchesDesc = [...matches].sort((a, b) => b.start - a.start);
    matchesDesc.forEach((match, idxDesc) => {
        try {
            const startPos = findTextNodeAndOffset(element, match.start);
            const endPos = findTextNodeAndOffset(element, match.end);
            if (!startPos.node || !endPos.node) return;

            // Ensure we're not crossing text node boundaries incorrectly
            if (startPos.node !== endPos.node) {
                // For now, skip matches that span multiple text nodes
                // This prevents incorrect highlighting
                return;
            }

            const range = document.createRange();
            range.setStart(startPos.node, Math.max(0, startPos.offset));
            range.setEnd(endPos.node, Math.max(0, endPos.offset));

            // Verify the range contains exactly what we expect
            const rangeText = range.toString();
            const expectedText = element.textContent.substring(match.start, match.end);
            if (rangeText !== expectedText) {
                // Range doesn't match expected text, skip this highlight
                return;
            }

            const wrapper = document.createElement("span");
            wrapper.className = "content-search-highlight";
            // Determine actual index from ascending order for active logic
            const ascIndex = matches.filter((m) => m.start < match.start).length;
            if (typeof activeIndex === "number" && ascIndex === activeIndex) wrapper.classList.add("active");
            range.surroundContents(wrapper);
        } catch (_) {
            /* ignore unwrappable ranges */
        }
    });
    
    // Restore focus to search input if it was focused before and search is still visible
    if (shouldRestoreFocus) {
        setTimeout(() => {
            elements.globalSearchInput.focus();
        }, 0);
    }
}

// Apply highlights in Preview area which has placeholder-marker spans
function applyHighlightsInPreview(element, matches, activeIndex) {
    if (!element || !Array.isArray(matches)) return;

    // Build a precise map of where each placeholder span is in the document
    const placeholderSpans = element.querySelectorAll(".placeholder-marker");
    const spanRanges = [];
    let currentPos = 0;

    // Walk through all child nodes to find exact positions
    function walkNodes(node) {
        if (node.nodeType === Node.TEXT_NODE) {
            currentPos += node.textContent.length;
        } else if (node.nodeType === Node.ELEMENT_NODE) {
            if (node.classList && node.classList.contains("placeholder-marker")) {
                const startPos = currentPos;
                const endPos = currentPos + node.textContent.length;
                spanRanges.push({
                    element: node,
                    start: startPos,
                    end: endPos,
                    text: node.textContent,
                });
                currentPos = endPos;
            } else {
                for (let child of node.childNodes) {
                    walkNodes(child);
                }
            }
        }
    }

    for (let child of element.childNodes) {
        walkNodes(child);
    }

    // Track which matches have been handled
    const handledMatches = new Set();

    // Apply in reverse order to preserve offsets
    const matchesDesc = [...matches].sort((a, b) => b.start - a.start);

    // For each match, determine if it's within a placeholder span or regular text
    matchesDesc.forEach((match, idx) => {
        const ascIndex = matches.filter((m) => m.start < match.start).length;
        const isActive = ascIndex === activeIndex;

        // Check if this match is within any placeholder span
        let foundInPlaceholder = false;
        for (const spanInfo of spanRanges) {
            if (match.start >= spanInfo.start && match.end <= spanInfo.end) {
                // Match is inside a placeholder - highlight just the matched text within it
                if (!handledMatches.has(idx)) {
                    const innerStart = match.start - spanInfo.start;
                    const innerEnd = match.end - spanInfo.start;
                    try {
                        const startPos = findTextNodeAndOffset(spanInfo.element, innerStart);
                        const endPos = findTextNodeAndOffset(spanInfo.element, innerEnd);
                        if (startPos.node && endPos.node && startPos.node === endPos.node) {
                            const range = document.createRange();
                            range.setStart(startPos.node, Math.max(0, startPos.offset));
                            range.setEnd(endPos.node, Math.max(0, endPos.offset));
                            const wrapper = document.createElement("span");
                            wrapper.className = "content-search-highlight";
                            if (isActive) wrapper.classList.add("active");
                            range.surroundContents(wrapper);
                        }
                    } catch (_) {
                        /* ignore errors during partial highlight */
                    }
                    handledMatches.add(idx);
                }
                foundInPlaceholder = true;
                break;
            }
        }

        // If not in a placeholder, try to highlight in regular text nodes
        if (!foundInPlaceholder && !handledMatches.has(idx)) {
            try {
                const startPos = findTextNodeAndOffset(element, match.start);
                const endPos = findTextNodeAndOffset(element, match.end);

                if (startPos.node && endPos.node) {
                    // Check if this is crossing into a placeholder span
                    let parent = startPos.node.parentNode;
                    let isInPlaceholder = false;
                    while (parent && parent !== element) {
                        if (parent.classList && parent.classList.contains("placeholder-marker")) {
                            isInPlaceholder = true;
                            break;
                        }
                        parent = parent.parentNode;
                    }

                    if (!isInPlaceholder && startPos.node === endPos.node) {
                        const range = document.createRange();
                        range.setStart(startPos.node, Math.max(0, startPos.offset));
                        range.setEnd(endPos.node, Math.max(0, endPos.offset));

                        const wrapper = document.createElement("span");
                        wrapper.className = "content-search-highlight";
                        if (isActive) wrapper.classList.add("active");

                        range.surroundContents(wrapper);
                        handledMatches.add(idx);
                    }
                }
            } catch (err) {
                console.debug("Could not highlight match:", err);
            }
        }
    });
}

function navigateToNextMatch() {
    if (allSearchMatches.length === 0) return;

    // Handle initial state (-1) or wrap around properly
    if (currentGlobalMatchIndex < 0) {
        currentGlobalMatchIndex = 0;
    } else {
        currentGlobalMatchIndex = (currentGlobalMatchIndex + 1) % allSearchMatches.length;
    }

    focusGlobalMatch(currentGlobalMatchIndex);
    updateMatchCount();
}

function navigateToPreviousMatch() {
    if (allSearchMatches.length === 0) return;

    // Handle initial state (-1) or wrap around properly
    if (currentGlobalMatchIndex < 0) {
        currentGlobalMatchIndex = allSearchMatches.length - 1;
    } else {
        currentGlobalMatchIndex = currentGlobalMatchIndex === 0 ? allSearchMatches.length - 1 : currentGlobalMatchIndex - 1;
    }

    focusGlobalMatch(currentGlobalMatchIndex);
    updateMatchCount();
}

function updateActiveMatch(targetElement = elements.promptArea) {
    // Remove active class from all highlights
    const highlights = targetElement.querySelectorAll(".content-search-highlight");
    highlights.forEach((highlight, index) => {
        if (index === currentMatchIndex) {
            highlight.classList.add("active");
        } else {
            highlight.classList.remove("active");
        }
    });
}

function scrollToMatch(matchIndex, targetElement = elements.promptArea) {
    const highlights = targetElement.querySelectorAll(".content-search-highlight");
    const highlight = highlights[matchIndex];
    let rect = null;
    if (highlight) {
        rect = highlight.getBoundingClientRect();
    } else if (currentSearchMatches[matchIndex]) {
        // Fallback: compute bounding rect from text range
        try {
            const m = currentSearchMatches[matchIndex];
            const startPos = findTextNodeAndOffset(targetElement, m.start);
            const endPos = findTextNodeAndOffset(targetElement, m.end);
            const range = document.createRange();
            range.setStart(startPos.node, Math.max(0, startPos.offset));
            range.setEnd(endPos.node, Math.max(0, endPos.offset));
            rect = range.getBoundingClientRect();
        } catch (_) {}
    }
    if (!rect) return;
    const targetRect = targetElement.getBoundingClientRect();
    const relativeTop = rect.top - targetRect.top;
    const targetHeight = targetElement.clientHeight;
    const targetScrollTop = targetElement.scrollTop + relativeTop - targetHeight / 2;
    targetElement.scrollTo({ top: targetScrollTop, behavior: "smooth" });
}

function updateMatchCount() {
    if (!elements.searchMatchCount) return;
    const total = allSearchMatches.length;
    const hasQuery = elements.globalSearchInput.value.trim().length > 0;
    if (!hasQuery) {
        elements.searchMatchCount.textContent = "";
    } else if (total > 0 && currentGlobalMatchIndex >= 0) {
        elements.searchMatchCount.textContent = `${currentGlobalMatchIndex + 1}/${total}`;
    } else if (total > 0) {
        elements.searchMatchCount.textContent = `1/${total}`;
    } else {
        elements.searchMatchCount.textContent = "0/0";
    }
    const enabled = total > 0;
    elements.searchNext.disabled = !enabled;
    elements.searchPrevious.disabled = !enabled;
}

// If finder is open and has a query, re-run the search to keep results fresh
function refreshSearchIfActive() {
    if (!elements.globalSearchInput) return;
    const q = elements.globalSearchInput.value.trim();
    if (q) performContentSearch(q);
}

function escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
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

    const apply = (isPreBuilt) => {
        if (hasTabs && isPreBuilt) {
            // Default (pre-built) templates: hide clear when placeholders exist
            elements.clearPrompt.style.display = "none";
        } else {
            // User-created templates (including Save As) OR no tabs: show when content exists
            elements.clearPrompt.style.display = hasContent ? "block" : "none";
        }
    };

    // If a saved template is selected, check its type
    if (selectedTemplateName) {
        chrome.storage.local.get(["templates"], (result) => {
            const templates = result.templates || [];
            const tmpl = templates.find((t) => t.name === selectedTemplateName);
            const isPreBuilt = tmpl && tmpl.type === "pre-built";
            apply(isPreBuilt);
        });
    } else {
        // New/unsaved templates are user-created by definition
        apply(false);
    }
}

function updateSaveButtonState() {
    const saveButtonWrapper = elements.saveBtn.parentElement;
    let tooltip = bootstrap.Tooltip.getInstance(saveButtonWrapper);

    if (!selectedTemplateName) {
        // If we are in a draft state (no selectedTemplateName), but our editingTargetName
        // refers to a pre-built template, disable Save to prevent saving default templates.
        if (editingTargetName) {
            // Pessimistically disable until we resolve the template type to avoid momentary enable
            elements.saveBtn.disabled = true;
            elements.saveBtn.style.pointerEvents = "none";
            saveButtonWrapper.classList.add("disabled-wrapper");
            chrome.storage.local.get(["templates"], (result) => {
                const templates = result.templates || [];
                const target = templates.find((t) => t.name === editingTargetName);
                const isPreBuilt = target && target.type === "pre-built";

                if (isPreBuilt) {
                    elements.saveBtn.disabled = true;
                    elements.saveBtn.style.pointerEvents = "none";

                    // Remove tooltip from button
                    const buttonTooltip = bootstrap.Tooltip.getInstance(elements.saveBtn);
                    if (buttonTooltip) {
                        buttonTooltip.dispose();
                    }

                    // Add tooltip to wrapper
                    if (!tooltip) {
                        tooltip = new bootstrap.Tooltip(saveButtonWrapper, {
                            title: 'Cannot save default templates. Use "Save As" to create a copy.',
                        });
                    } else {
                        tooltip.setContent({
                            ".tooltip-inner": 'Cannot save default templates. Use "Save As" to create a copy.',
                        });
                    }

                    saveButtonWrapper.classList.add("disabled-wrapper");
                } else {
                    elements.saveBtn.disabled = false;
                    elements.saveBtn.style.pointerEvents = "auto";

                    // Remove tooltip from wrapper if it exists
                    if (tooltip) {
                        tooltip.dispose();
                    }

                    // Add tooltip to button
                    let btnTooltip = bootstrap.Tooltip.getInstance(elements.saveBtn);
                    if (!btnTooltip) {
                        new bootstrap.Tooltip(elements.saveBtn, {
                            title: "Save changes to template",
                        });
                    } else {
                        btnTooltip.setContent({ ".tooltip-inner": "Save changes to template" });
                    }

                    saveButtonWrapper.classList.remove("disabled-wrapper");
                }
            });
        } else {
            // No selected template and no target: allow saving a new custom template
            elements.saveBtn.disabled = false;
            elements.saveBtn.style.pointerEvents = "auto";

            // Remove tooltip from wrapper if it exists
            if (tooltip) {
                tooltip.dispose();
            }

            // Add tooltip to button
            tooltip = bootstrap.Tooltip.getInstance(elements.saveBtn);
            if (!tooltip) {
                new bootstrap.Tooltip(elements.saveBtn, {
                    title: "Save changes to template",
                });
            } else {
                tooltip.setContent({ ".tooltip-inner": "Save changes to template" });
            }

            saveButtonWrapper.classList.remove("disabled-wrapper");
        }
        return;
    }

    chrome.storage.local.get(["templates"], (result) => {
        const templates = result.templates || [];
        const currentTemplate = templates.find((t) => t.name === selectedTemplateName);
        const isPreBuilt = currentTemplate && currentTemplate.type === "pre-built";

        if (isPreBuilt) {
            elements.saveBtn.disabled = true;
            elements.saveBtn.style.pointerEvents = "none";

            // Remove tooltip from button
            const buttonTooltip = bootstrap.Tooltip.getInstance(elements.saveBtn);
            if (buttonTooltip) {
                buttonTooltip.dispose();
            }

            // Add tooltip to wrapper
            if (!tooltip) {
                tooltip = new bootstrap.Tooltip(saveButtonWrapper, {
                    title: 'Cannot save default templates. Use "Save As" to create a copy.',
                });
            } else {
                tooltip.setContent({ ".tooltip-inner": 'Cannot save default templates. Use "Save As" to create a copy.' });
            }

            saveButtonWrapper.classList.add("disabled-wrapper");
        } else {
            elements.saveBtn.disabled = false;
            elements.saveBtn.style.pointerEvents = "auto";

            // Remove tooltip from wrapper
            if (tooltip) {
                tooltip.dispose();
            }

            // Add tooltip to button
            const buttonTooltip = bootstrap.Tooltip.getInstance(elements.saveBtn);
            if (!buttonTooltip) {
                new bootstrap.Tooltip(elements.saveBtn, {
                    title: "Save changes to template",
                });
            } else {
                buttonTooltip.setContent({ ".tooltip-inner": "Save changes to template" });
            }

            saveButtonWrapper.classList.remove("disabled-wrapper");
        }
    });
}

function updateDeleteButtonState() {
    const deleteButtonWrapper = elements.deleteBtn.parentElement;
    let tooltip = bootstrap.Tooltip.getInstance(deleteButtonWrapper);

    if (!selectedTemplateName) {
        elements.deleteBtn.disabled = true;
        elements.deleteBtn.style.pointerEvents = "none";

        // Remove tooltip from button if it exists
        const buttonTooltip = bootstrap.Tooltip.getInstance(elements.deleteBtn);
        if (buttonTooltip) {
            buttonTooltip.dispose();
        }

        // Add tooltip to wrapper
        if (!tooltip) {
            tooltip = new bootstrap.Tooltip(deleteButtonWrapper, {
                title: "No template selected to delete.",
            });
        } else {
            tooltip.setContent({ ".tooltip-inner": "No template selected to delete." });
        }

        deleteButtonWrapper.classList.add("disabled-wrapper");
        return;
    }

    chrome.storage.local.get(["templates"], (result) => {
        const templates = result.templates || [];
        const currentTemplate = templates.find((t) => t.name === selectedTemplateName);
        const isPreBuilt = currentTemplate && currentTemplate.type === "pre-built";

        if (isPreBuilt) {
            elements.deleteBtn.disabled = true;
            elements.deleteBtn.style.pointerEvents = "none";

            // Remove tooltip from button
            const buttonTooltip = bootstrap.Tooltip.getInstance(elements.deleteBtn);
            if (buttonTooltip) {
                buttonTooltip.dispose();
            }

            // Add tooltip to wrapper
            if (!tooltip) {
                tooltip = new bootstrap.Tooltip(deleteButtonWrapper, {
                    title: "Cannot delete a default template.",
                });
            } else {
                tooltip.setContent({ ".tooltip-inner": "Cannot delete a default template." });
            }

            deleteButtonWrapper.classList.add("disabled-wrapper");
        } else {
            elements.deleteBtn.disabled = false;
            elements.deleteBtn.style.pointerEvents = "auto";

            // Remove tooltip from wrapper
            if (tooltip) {
                tooltip.dispose();
            }

            // Add tooltip to button
            const buttonTooltip = bootstrap.Tooltip.getInstance(elements.deleteBtn);
            if (!buttonTooltip) {
                new bootstrap.Tooltip(elements.deleteBtn, {
                    title: "Delete this template.",
                });
            } else {
                buttonTooltip.setContent({ ".tooltip-inner": "Delete this template." });
            }

            deleteButtonWrapper.classList.remove("disabled-wrapper");
        }
    });
}

function switchToTagsViewMode() {
    const tagsArray = elements.templateTags.value
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
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
            editingTargetName,
            isTagsInEditMode: !elements.templateTags.classList.contains("hidden"),
            originalTags: originalTagsBeforeEdit,
            previewMode: tabsState.previewMode, // Save preview mode state
        },
        theme: currentTheme,
        isFullscreen,
        extensionVersion: EXTENSION_VERSION,
        placeholderValues: tabsState.placeholderValues,
    };
    chrome.storage.local.set(state);

    // Also save to session storage for persistence across reloads
    saveToSession();
}

function storeLastState() {
    lastState = {
        name: elements.templateName.value,
        tags: elements.templateTags.value,
        content: elements.promptArea.textContent,
        rawTemplate: tabsState.currentTemplate || elements.promptArea.textContent,
        selectedName: selectedTemplateName,
        // Capture the template context at the time of the action
        contextName: selectedTemplateName,
        isTagsInEditMode: !elements.templateTags.classList.contains("hidden"),
        originalTags: originalTagsBeforeEdit,
        // Snapshot current placeholder values so we can restore tabs with values on undo
        placeholderValuesSnapshot: deepClone(tabsState.placeholderValues),
        // Snapshot allowed placeholders so we can revert any newly added placeholders on undo
        allowedPlaceholdersSnapshot: Array.isArray(ALLOWED_PLACEHOLDERS) ? [...ALLOWED_PLACEHOLDERS] : [],
        templates: null,
        nextIndexSnapshot: typeof nextIndex === "number" ? nextIndex : null,
        recentIndicesSnapshot: Array.isArray(recentIndices) ? [...recentIndices] : [],
    };
}

// --- Toast Notification System (Top-right, non-blocking) ---

/**
 * Shows a toast notification (non-blocking, top-right)
 * Use for: Success messages, informational updates
 * @param {string} message - The message to display (can include <strong> for bold)
 * @param {number} duration - Auto-dismiss duration in ms (default: 4000, range: 3000-5000)
 * @param {string} type - Type: 'success', 'error', 'warning', 'info', or legacy 'green', 'red', 'gray'
 * @param {string} operationId - Operation identifier for throttling
 */
function showToast(message, duration = 4000, type = "error", buttons = [], operationId) {
    // Legacy support: if buttons array is provided, redirect to showModal
    if (buttons && buttons.length > 0) {
        // Convert to modal - determine modal type based on type parameter or message content
        const modalType = type === "warning" || message.toLowerCase().includes("warning") ? "warning" : "error";
        showModal(message, buttons, modalType);
        return;
    }

    const toastKey = `${message}|${operationId}`;
    const now = Date.now();

    // Determine undo eligibility up front from message text
    const undoEligible = message.includes("Ctrl+Z") || message.includes("Cmd+Z") || message.includes("undo");

    // Throttle only non-undo toasts; allow consecutive undo-eligible toasts
    if (!undoEligible && toastTimestamps[toastKey] && now - toastTimestamps[toastKey] < 1010) {
        return;
    }
    toastTimestamps[toastKey] = now;

    // If operation changed, clear queue and close current toast
    if (operationId && operationId !== currentOperationId) {
        if (isToastShowing) {
            closeToast();
        }
        toastQueue = [];
        currentOperationId = operationId;
    }

    // Queue the toast
    const isUndoEligible = undoEligible;
    toastQueue.push({ message, duration, type, isUndoEligible });

    // Display immediately if no toast is showing
    if (!isToastShowing) {
        displayNextToast();
    }
}

function closeToast(onClose) {
    clearTimeout(autoHideTimeout);
    autoHideTimeout = null;
    clearTimeout(nextToastTimeout);

    elements.toast.classList.remove("show");
    elements.toast.classList.remove("ps-show");
    elements.toast.classList.add("ps-hide");

    // Clear undo availability when toast closes
    isUndoToastVisible = false;

    setTimeout(() => {
        elements.toast.classList.remove("hide");
        elements.toast.classList.remove("ps-hide");
        elements.toast.innerHTML = "";
        isToastShowing = false;
        if (onClose) onClose();
        nextToastTimeout = setTimeout(displayNextToast, 10);
    }, 300); // Match CSS transition duration
}

function displayNextToast() {
    if (isToastShowing) return;
    if (toastQueue.length === 0) return;

    clearTimeout(autoHideTimeout);
    isToastShowing = true;

    const { message, duration, type, isUndoEligible } = toastQueue.shift();

    // Set undo availability based on toast content
    isUndoToastVisible = !!isUndoEligible;

    // Clear any existing content
    elements.toast.innerHTML = "";

    // Create content wrapper (for message, separate from close button)
    const contentWrapper = document.createElement("div");
    contentWrapper.className = `toast-content-wrapper ${type}`;

    // Create message content
    const messageEl = document.createElement("div");
    messageEl.innerHTML = message;
    contentWrapper.appendChild(messageEl);
    elements.toast.appendChild(contentWrapper);

    // Create close button (always visible)
    const closeBtn = document.createElement("button");
    closeBtn.textContent = "×";
    closeBtn.className = "toast-close-btn";
    closeBtn.setAttribute("aria-label", "Close notification");
    closeBtn.addEventListener("click", (event) => {
        event.stopPropagation();
        closeToast();
    });
    elements.toast.appendChild(closeBtn);

    // Auto-dismiss after duration (3-5 seconds as per guidelines)
    const safeDuration = Math.max(3000, Math.min(5000, duration));
    autoHideTimeout = setTimeout(() => closeToast(), safeDuration);

    // Apply type class and show
    elements.toast.className = `ps-toast ${type}`;
    // Force reflow to ensure transition works
    void elements.toast.offsetHeight;
    elements.toast.classList.add("ps-show");
}

// --- Update Banner System ---

let updateBannerTimeout = null;
const BANNER_AUTO_DISMISS_TIME = 8000; // 8 seconds, same as toast duration for consistency

/**
 * Shows the update notification banner
 */
function showUpdateBanner() {
    if (!elements.updateBanner) return;
    
    // Show the banner with animation
    elements.updateBanner.style.display = 'block';
    // Removed body class manipulation to prevent layout issues
    
    // Auto-dismiss after timeout
    updateBannerTimeout = setTimeout(() => {
        hideUpdateBanner();
    }, BANNER_AUTO_DISMISS_TIME);
}

/**
 * Hides the update notification banner
 * @param {boolean} wasDismissed - Whether the user explicitly dismissed the banner
 */
function hideUpdateBanner(wasDismissed = false) {
    if (!elements.updateBanner) return;
    
    // Clear any existing timeout
    if (updateBannerTimeout) {
        clearTimeout(updateBannerTimeout);
        updateBannerTimeout = null;
    }
    
    // If explicitly dismissed, save the version to prevent showing again
    if (wasDismissed) {
        chrome.storage.local.set({ 
            updateBannerDismissedVersion: EXTENSION_VERSION 
        });
    }
    
    // Add hiding animation class
    elements.updateBanner.classList.add('hiding');
    
    // Remove banner after animation completes
    setTimeout(() => {
        elements.updateBanner.style.display = 'none';
        elements.updateBanner.classList.remove('hiding');
        // Removed body class manipulation to prevent layout issues
    }, 300);
}

// --- Modal Notification System (Center, blocking) ---

/**
 * Shows a modal notification (blocking, centered)
 * Use for: Warnings, errors requiring decisions
 * @param {string} message - The message to display
 * @param {Array} buttons - Array of {text, callback, type} objects
 *   type can be: 'save', 'delete', 'confirm', 'ok' (primary) or 'cancel', 'discard', 'no' (secondary)
 * @param {string} modalType - 'warning' or 'error'
 */
function showModal(message, buttons = [], modalType = "warning") {
    if (isModalShowing) {
        closeModal();
    }

    isModalShowing = true;

    // Store modal type for button styling
    const currentModalType = modalType;

    // Create content wrapper (for message, separate from buttons)
    const contentWrapper = document.createElement("div");
    contentWrapper.className = "modal-content-wrapper";

    // Create message content
    const messageEl = document.createElement("div");
    messageEl.innerHTML = message;
    contentWrapper.appendChild(messageEl);
    elements.modalNotification.appendChild(contentWrapper);

    // Create close button
    const closeBtn = document.createElement("button");
    closeBtn.textContent = "×";
    closeBtn.className = "modal-close-btn";
    closeBtn.setAttribute("aria-label", "Close");
    closeBtn.addEventListener("click", (event) => {
        event.stopPropagation();
        // Find cancel/no button callback
        const cancelBtn = buttons.find(
            (b) => b.text.toLowerCase() === "cancel" || b.text.toLowerCase() === "no" || b.text.toLowerCase() === "discard"
        );
        closeModal(cancelBtn?.callback);
    });
    elements.modalNotification.appendChild(closeBtn);

    // Create button container (outside content wrapper, justified end)
    if (buttons.length > 0) {
        const buttonContainer = document.createElement("div");
        buttonContainer.className = "modal-button-container";

        buttons.forEach(({ text, callback, type: btnType }) => {
            const btn = document.createElement("button");
            btn.textContent = text;

            // Determine button style based on text or explicit type
            const lowerText = text.toLowerCase();
            const isPrimary =
                btnType === "primary" ||
                lowerText === "save" ||
                lowerText === "delete" ||
                lowerText === "confirm" ||
                lowerText === "yes" ||
                lowerText === "ok" ||
                lowerText === "close without saving";

            if (isPrimary) {
                btn.className = "modal-primary-btn";
                // Add specific class for color based on modal type and button text
                if (lowerText === "save") btn.classList.add("save");
                else if (lowerText === "delete" || lowerText === "confirm" || lowerText === "yes")
                    btn.classList.add("confirm");
                else if (lowerText === "ok" && currentModalType === "error")
                    btn.classList.add("confirm"); // Red OK for error modals
                else if (lowerText === "ok") btn.classList.add("ok");
                else if (lowerText === "close without saving" && currentModalType === "warning")
                    btn.classList.add("save"); // Amber for warning modals
                else btn.classList.add("ok"); // Default for other primary buttons
            } else {
                btn.className = "modal-secondary-btn";
            }

            btn.setAttribute("aria-label", text);
            btn.setAttribute("data-text", lowerText);
            btn.addEventListener("click", (event) => {
                event.stopPropagation();
                closeModal(callback);
            });
            buttonContainer.appendChild(btn);
        });

        elements.modalNotification.appendChild(buttonContainer);
    }

    // Show overlay
    elements.modalOverlay.style.display = "block";
    requestAnimationFrame(() => {
        elements.modalOverlay.classList.add("show");
    });

    // Apply type class and show modal
    elements.modalNotification.className = `ps-modal ${modalType}`;
    elements.modalNotification.style.display = "flex"; // Show the modal
    requestAnimationFrame(() => {
        elements.modalNotification.classList.add("ps-show");
    });

    // Handle overlay click to close
    const overlayClickHandler = (event) => {
        if (event.target === elements.modalOverlay) {
            const cancelBtn = buttons.find(
                (b) =>
                    b.text.toLowerCase() === "cancel" || b.text.toLowerCase() === "no" || b.text.toLowerCase() === "discard"
            );
            closeModal(cancelBtn?.callback);
        }
    };
    elements.modalOverlay.addEventListener("click", overlayClickHandler);
    modalCloseCallback = overlayClickHandler;
}

function closeModal(onClose) {
    if (!isModalShowing) return;

    // Remove overlay click listener
    if (modalCloseCallback) {
        elements.modalOverlay.removeEventListener("click", modalCloseCallback);
        modalCloseCallback = null;
    }

    elements.modalNotification.classList.remove("show");
    elements.modalNotification.classList.remove("ps-show");
    elements.modalNotification.classList.add("ps-hide");
    elements.modalOverlay.classList.remove("show");

    setTimeout(() => {
        elements.modalNotification.classList.remove("ps-hide");
        elements.modalNotification.style.display = "none"; // Hide completely after animation
        elements.modalNotification.innerHTML = "";
        elements.modalOverlay.style.display = "none";
        isModalShowing = false;
        if (onClose) onClose();
    }, 300); // Match CSS transition duration
}

// --- Save Count and Feedback System ---

/**
 * Check if we should show feedback prompt based on custom template count
 * Shows at specific milestones: 2, 5, 10, 20, 50
 */
function checkFeedbackMilestone(customTemplateCount) {
    const milestones = [2, 5, 10, 20, 50];
    return milestones.includes(customTemplateCount);
}

/**
 * Get the appropriate message for the milestone
 */
function getMilestoneMessage(customTemplateCount) {
    const messages = {
        2: "You're getting the hang of it — another one saved.",
        5: "Nice streak! Looks like templates are becoming your thing.",
        10: "You're a template pro now — keep building your stash.",
        20: "You've mastered this! PromptStash suits your workflow perfectly.",
        50: "Wow! You've built quite the collection — your stash is growing strong."
    };
    return messages[customTemplateCount] || "";
}

/**
 * Show feedback prompt toast
 */
function showFeedbackPrompt(customTemplateCount) {
    const milestoneMessage = getMilestoneMessage(customTemplateCount);
    const message = `${milestoneMessage}`;
    
    // Ensure no existing toast is showing
    if (isToastShowing) {
        closeToast();
        // Wait for close animation to complete
        setTimeout(() => showFeedbackPrompt(customTemplateCount), 350);
        return;
    }

    isToastShowing = true;

    // Clear any existing content
    elements.toast.innerHTML = "";

    // Create main container for vertical layout
    const mainContainer = document.createElement("div");
    mainContainer.style.cssText = "display: flex; flex-direction: column; width: 100%;";

    // Create content wrapper for message with icon
    const contentWrapper = document.createElement("div");
    contentWrapper.className = "toast-content-wrapper success";
    contentWrapper.style.cssText = "margin-bottom: 10px;";
    
    // Create message element
    const messageEl = document.createElement("span");
    messageEl.className = "toast-message";
    messageEl.innerHTML = message;
    contentWrapper.appendChild(messageEl);
    mainContainer.appendChild(contentWrapper);

    // Create button container
    const buttonContainer = document.createElement("div");
    buttonContainer.style.cssText = "display: flex; gap: 10px; justify-content: flex-start; padding-left: 22px;";
    
    // Create "Leave Feedback" button
    const feedbackBtn = document.createElement("button");
    feedbackBtn.textContent = "Leave Feedback";
    feedbackBtn.style.cssText = "background: #34A853; color: white; border: none; padding: 6px 14px; border-radius: 4px; cursor: pointer; font-size: 12px; font-weight: 500; transition: background 0.2s;";
    feedbackBtn.addEventListener("mouseenter", () => {
        feedbackBtn.style.background = "#2d8e47";
    });
    feedbackBtn.addEventListener("mouseleave", () => {
        feedbackBtn.style.background = "#34A853";
    });
    feedbackBtn.addEventListener("click", () => {
        chrome.tabs.create({ 
            url: "https://chromewebstore.google.com/detail/promptstash-chatgpt-grok/fjbacajcjnfbpjladgkkkckfcemehbpa/reviews"
        });
        closeToast();
    });
    
    // Create "Not Now" button
    const notNowBtn = document.createElement("button");
    notNowBtn.textContent = "Not Now";
    notNowBtn.style.cssText = "background: rgba(255, 255, 255, 0.9); color: #333; border: 1px solid #dadce0; padding: 6px 14px; border-radius: 4px; cursor: pointer; font-size: 12px; font-weight: 500; transition: background 0.2s;";
    notNowBtn.addEventListener("mouseenter", () => {
        notNowBtn.style.background = "rgba(255, 255, 255, 1)";
        notNowBtn.style.borderColor = "#c0c0c0";
    });
    notNowBtn.addEventListener("mouseleave", () => {
        notNowBtn.style.background = "rgba(255, 255, 255, 0.9)";
        notNowBtn.style.borderColor = "#dadce0";
    });
    notNowBtn.addEventListener("click", () => {
        closeToast();
    });
    
    buttonContainer.appendChild(feedbackBtn);
    buttonContainer.appendChild(notNowBtn);
    mainContainer.appendChild(buttonContainer);
    
    // Append main container to toast
    elements.toast.appendChild(mainContainer);

    // Create close button
    const closeBtn = document.createElement("button");
    closeBtn.textContent = "×";
    closeBtn.className = "toast-close-btn";
    closeBtn.setAttribute("aria-label", "Close notification");
    closeBtn.addEventListener("click", (event) => {
        event.stopPropagation();
        closeToast();
    });
    elements.toast.appendChild(closeBtn);

    // Auto-dismiss after 10 seconds
    autoHideTimeout = setTimeout(() => closeToast(), 10000);

    // Apply type class and show
    elements.toast.className = "ps-toast success";
    // Force reflow to ensure transition works
    void elements.toast.offsetHeight;
    elements.toast.classList.add("ps-show");
}

/**
 * Get count of custom templates (max 50)
 */
function getCustomTemplateCount(templates) {
    const customTemplates = templates.filter(t => t.type === "custom" || t.type === undefined);
    return Math.min(customTemplates.length, 50);
}

/**
 * Check and show feedback prompt if milestone reached
 */
function checkAndShowFeedback() {
    chrome.storage.local.get(["totalCustomTemplatesSaved", "lastFeedbackMilestone"], (result) => {
        const totalSaved = Math.min(result.totalCustomTemplatesSaved || 0, 50);
        const lastMilestone = result.lastFeedbackMilestone || 0;
        
        // Check if we've hit a new milestone that we haven't shown yet
        if (checkFeedbackMilestone(totalSaved) && totalSaved > lastMilestone) {
            chrome.storage.local.set({ lastFeedbackMilestone: totalSaved }, () => {
                // Wait for save toast to finish before showing feedback prompt
                setTimeout(() => {
                    // Close any existing toast first to prevent conflicts
                    if (isToastShowing) {
                        closeToast(() => {
                            // Show feedback prompt after toast is fully closed
                            setTimeout(() => {
                                showFeedbackPrompt(totalSaved);
                            }, 100);
                        });
                    } else {
                        showFeedbackPrompt(totalSaved);
                    }
                }, 3500);
            });
        }
    });
}

// --- Template and Data Management ---

function saveTemplates(templates, callback, isNewTemplate) {
    const timeout = setTimeout(() => {
        showToast("Operation timed out. Please try again.", 5000, "error", [], "save");
    }, 5000);
    chrome.storage.local.set({ templates }, () => {
        clearTimeout(timeout);
        if (chrome.runtime.lastError) {
            const msg = chrome.runtime.lastError.message.includes("QUOTA")
                ? "<strong>Storage limit exceeded.</strong>"
                : "<strong>Failed to save.</strong>";
            showToast(msg, 5000, "error", [], "save");
            console.error("Local storage error:", chrome.runtime.lastError.message);
        } else {
            callback();
            showToast(
                isNewTemplate ? "Template saved. Use Ctrl+Z/Cmd+Z to undo." : "Template updated. Use Ctrl+Z/Cmd+Z to undo.",
                3000,
                "success",
                [],
                "save"
            );
            // Check for feedback milestone after save (for new templates only)
            if (isNewTemplate) {
                // Increment total saved count
                chrome.storage.local.get(["totalCustomTemplatesSaved"], (result) => {
                    const currentTotal = Math.min(result.totalCustomTemplatesSaved || 0, 50);
                    const newTotal = Math.min(currentTotal + 1, 50);
                    chrome.storage.local.set({ totalCustomTemplatesSaved: newTotal }, () => {
                        checkAndShowFeedback();
                    });
                });
            }
            chrome.storage.local.get(null, (items) => {
                const totalSizeInBytes = new TextEncoder().encode(JSON.stringify(items)).length;
                if (totalSizeInBytes > 0.9 * (10 * 1024 * 1024)) {
                    showToast("Warning: Storage is nearly full.", 5000, "warning", [], "save");
                }
            });
        }
    });
}

function loadTemplates(query = "", showDropdown = false) {
    chrome.storage.local.get(["templates", "nextIndex"], (result) => {
        const toArrayTags = (tags) => {
            if (Array.isArray(tags)) return tags;
            if (typeof tags === "string")
                return tags
                    .split(",")
                    .map((s) => s.trim())
                    .filter(Boolean);
            return [];
        };

        const normalize = (t) => ({ ...t, tags: toArrayTags(t.tags) });

        const storedRaw = Array.isArray(result.templates) ? result.templates : [];
        let next = typeof result.nextIndex === "number" ? result.nextIndex : storedRaw.length;

        const stored = storedRaw.map(normalize);
        const defaults = defaultTemplates.map(normalize);

        // Build name sets
        const defaultNames = new Set(defaults.map((t) => t.name));

        // Remove obsolete pre-built defaults that no longer exist (renamed/removed) to avoid duplicates
        // Keep all user templates (type !== 'pre-built') and pre-built that still exist by name
        const kept = stored.filter((t) => t && t.type !== "pre-built");
        const existingPreBuilt = stored.filter((t) => t && t.type === "pre-built" && defaultNames.has(t.name));

        const keptNames = new Set(kept.map((t) => t.name));
        const existingPreBuiltNames = new Set(existingPreBuilt.map((t) => t.name));

        // Update existing pre-built templates with latest content from defaults
        const updatedPreBuilt = existingPreBuilt.map((stored) => {
            const defaultTemplate = defaults.find((dt) => dt.name === stored.name);
            if (defaultTemplate) {
                // Preserve stored properties like index, but update content and other properties from default
                return {
                    ...defaultTemplate,
                    index: next++,
                    favorite: stored.favorite || false, // Preserve user's favorite setting
                };
            }
            return stored;
        });

        // Add any new defaults not present in kept or existing pre-built
        const newDefaults = defaults
            .filter((dt) => dt && !keptNames.has(dt.name) && !existingPreBuiltNames.has(dt.name))
            .map((dt, i) => ({ ...dt, index: next++ }));
        next += newDefaults.length;

        // If no stored, initialize from defaults with stable indices
        const merged =
            stored.length > 0
                ? [...kept, ...updatedPreBuilt, ...newDefaults]
                : defaults.map((t, i) => ({ ...t, index: i }));
        // Persist if we normalized tags, removed obsolete defaults, or added new defaults
        const changed =
            storedRaw.length !== merged.length ||
            storedRaw.some((t, i) => {
                const a = t && Array.isArray(t.tags) ? t.tags.join(",") : typeof t.tags === "string" ? t.tags : "";
                const bT = merged.find((m) => m.name === (t && t.name));
                const b = bT ? (Array.isArray(bT.tags) ? bT.tags.join(",") : "") : "";
                return a !== b;
            });
        if (changed) {
            chrome.storage.local.set({ templates: merged, nextIndex: next });
        }

        let templates = merged;

        // Helper for timestamps
        const ts = (t) =>
            typeof t.updatedAt === "number" ? t.updatedAt : typeof t.createdAt === "number" ? t.createdAt : 0;

        if (query) {
            templates = templates.filter(
                (t) =>
                    t.name.toLowerCase().includes(query) ||
                    (Array.isArray(t.tags) && t.tags.some((tag) => tag.toLowerCase().includes(query)))
            );
            // When searching, still prefer most recently updated/created for user templates
            const customs = templates.filter((t) => t.type !== "pre-built");
            const preb = templates.filter((t) => t.type === "pre-built");
            customs.sort((a, b) => ts(b) - ts(a) || a.name.localeCompare(b.name));
            preb.sort((a, b) => a.name.localeCompare(b.name));
            templates = [...customs, ...preb];
        } else {
            // No query: show user-created templates by most recent update/create, then pre-built alphabetically
            const customs = templates.filter((t) => t.type !== "pre-built");
            const preb = templates.filter((t) => t.type === "pre-built");
            customs.sort((a, b) => ts(b) - ts(a) || a.name.localeCompare(b.name));
            preb.sort((a, b) => a.name.localeCompare(b.name));
            templates = [...customs, ...preb];
        }
        renderDropdown(templates, showDropdown);
        renderFavoriteSuggestions(templates.filter((t) => t.favorite));
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
        div.innerHTML += `<button class="favorite-toggle ${tmpl.favorite ? "favorited" : "unfavorited"}" data-name="${
            tmpl.name
        }" aria-label="${tmpl.favorite ? "Unfavorite" : "Favorite"} template">${tmpl.favorite ? "★" : "☆"}</button>`;
        elements.dropdownResults.appendChild(div);
    });
}

function renderFavoriteSuggestions(favorites) {
    elements.favoriteSuggestions.innerHTML = "";
    if (favorites.length > 0) {
        elements.favoriteSuggestions.classList.remove("d-none");
        document.body.classList.remove("no-favorites");
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
        document.body.classList.add("no-favorites");
    }
    // Update prompt area height when favorites visibility changes
    updatePromptAreaHeight();
}

function updatePromptAreaHeight() {
    const tabsList = document.getElementById("editorTabs");
    const hasPlaceholderTabs = tabsList && tabsList.style.display !== "none";
    const hasFavorites = elements.favoriteSuggestions && !elements.favoriteSuggestions.classList.contains("d-none");

    let height;
    if (hasPlaceholderTabs && hasFavorites) {
        height = "calc(100vh - 395px)";
    } else if (hasPlaceholderTabs) {
        height = "calc(100vh - 360px)";
    } else if (hasFavorites) {
        height = "calc(100vh - 355px)";
    } else {
        height = "calc(100vh - 320px)";
    }

    // Apply height directly without any content manipulation
    elements.promptArea.style.height = height;
    elements.promptArea.style.minHeight = height;
    if (elements.previewArea) {
        elements.previewArea.style.height = height;
        elements.previewArea.style.minHeight = height;
    }

    // Update placeholder tab textareas
    const placeholderTextareas = document.querySelectorAll(".tab-pane textarea");
    placeholderTextareas.forEach((textarea) => {
        textarea.style.height = height;
        textarea.style.minHeight = height;
    });
}

function loadTemplateFromSelection(tmpl) {
    // Save current template's unsaved changes before switching (if any)
    // IMPORTANT: Do this BEFORE changing selectedTemplateName
    if (selectedTemplateName || elements.promptArea.textContent.trim()) {
        // Save tags/content/placeholders; do NOT persist an edited name as the saved name
        const originalName = selectedTemplateName;
        saveToSession();
        // Force the session to keep the original name reference for restoration
        try {
            const sessionKey = `ps_session_${originalName || "unsaved_draft"}`;
            chrome.storage.session.get([sessionKey], (r) => {
                const d = r[sessionKey];
                if (d) {
                    d.selectedTemplateName = originalName || null;
                    d.editingTargetName = originalName || null;
                    d.templateName = originalName || "";
                    const payload = {};
                    payload[sessionKey] = d;
                    chrome.storage.session.set(payload);
                }
            });
        } catch (_) {}
    }

    // Now switch to the new template
    // New template context: bump serial to isolate undo stacks
    contextSerial++;

    // Check if this template has unsaved changes in session storage
    const sessionKey = `unsaved_${tmpl.name}`;
    chrome.storage.session.get([sessionKey], (result) => {
        const sessionData = result[sessionKey];

        if (sessionData && sessionData.timestamp) {
            // This template has unsaved changes - restore ALL cached changes including name
            selectedTemplateName = sessionData.selectedTemplateName || tmpl.name;
            editingTargetName = sessionData.editingTargetName || tmpl.name;
            // ✅ Preserve cached name changes when switching templates
            elements.templateName.value = sessionData.templateName || tmpl.name;
            const tagsArray = Array.isArray(tmpl.tags) ? tmpl.tags : [];
            elements.templateTags.value = sessionData.templateTags || tagsArray.join(", ");
            tabsState.currentTemplate = sessionData.templateContent || tmpl.content;
            elements.promptArea.textContent = tabsState.currentTemplate;
            tabsState.placeholderValues = sessionData.placeholderValues || {};
            tabsState.existingTabPlaceholders = sessionData.existingTabPlaceholders || [];
            tabsState.previewMode = sessionData.previewMode || false;

            // Update the current session key
            chrome.storage.session.set({ currentSessionKey: sessionKey });
        } else {
            // No unsaved changes - load the clean template
            selectedTemplateName = tmpl.name;
            editingTargetName = tmpl.name;
            elements.templateName.value = tmpl.name;
            const tagsArray = Array.isArray(tmpl.tags) ? tmpl.tags : [];
            elements.templateTags.value = tagsArray.join(", ");
            tabsState.currentTemplate = tmpl.content; // Set the raw template content
            elements.promptArea.textContent = tmpl.content;
            tabsState.placeholderValues = {}; // Clear placeholder values for the new template

            // Update the current session key
            chrome.storage.session.set({ currentSessionKey: sessionKey });
        }

        updateExportSingleBtnState();
        // Reset name/tags undo-redo stacks for the newly selected template
        try {
            nameUndoStack = [];
            nameRedoStack = [];
            nameLastSnapshot = elements.templateName.value || "";
            nameLastCaret = 0;
            nameStackContextSerial = contextSerial;

            tagsUndoStack = [];
            tagsRedoStack = [];
            tagsLastSnapshot = elements.templateTags.value || "";
            tagsLastCaret = 0;
            tagsStackContextSerial = contextSerial;
        } catch (_) {}

        const tags = elements.templateTags.value || "";
        if (tags) {
            switchToTagsViewMode();
        } else {
            switchToTagsEditMode();
        }

        // Reset scroll to top when switching templates
        try {
            elements.promptArea.scrollTop = 0;
        } catch (_) {}
        // When switching templates, exit preview mode and hide preview UI
        if (!tabsState.previewMode) {
            const previewTabItem = document.getElementById("preview-tab-item");
            const previewPanel = document.getElementById("preview-panel");
            if (previewTabItem) previewTabItem.style.display = "none";
            if (previewPanel) {
                previewPanel.classList.remove("active", "show");
                previewPanel.classList.add("fade");
            }
            if (elements.previewArea) elements.previewArea.innerHTML = "";
        }

        // Reset editor undo/redo stacks
        editorUndoStack = [];
        editorRedoStack = [];
        editorLastSnapshot = tabsState.currentTemplate || "";
        editorLastCaret = 0;

        const templateTabButton = document.getElementById("template-tab");
        if (templateTabButton) {
            new bootstrap.Tab(templateTabButton).show();
        }

        // Ensure both editors start at top after building tabs
        try {
            elements.promptArea.scrollTop = 0;
        } catch (_) {}
        try {
            if (elements.previewArea) elements.previewArea.scrollTop = 0;
        } catch (_) {}

        // When loading a template, get its placeholders and set them as existing tabs
        const { placeholders: loadedPlaceholders } = parsePlaceholders(tabsState.currentTemplate, false);
        tabsState.existingTabPlaceholders = [...loadedPlaceholders];
        buildTabsFromTemplate(tabsState.currentTemplate, true); // Allow all placeholders from the loaded template
        renderPlaceholdersInTemplate(); // Ensure styles are applied

        elements.searchBox.value = "";
        elements.clearSearch.style.display = "none";
        elements.searchOverlay.style.display = "none";
        elements.dropdownResults.classList.remove("show");
        elements.fetchBtn2.style.display = "none";
        updateClearButtonState();
        updateSaveButtonState();
        updateDeleteButtonState();
        saveState();
        elements.promptArea.focus();
    }); // Close the chrome.storage.session.get callback
}

function updateRecentIndices(index) {
    recentIndices.unshift(index);
    recentIndices = [...new Set(recentIndices)].slice(0, 10);
    chrome.storage.local.set({ recentIndices });
}

function extractAllowedPlaceholdersFromDefaults() {
    const placeholders = new Set();
    const regex = /\{\{([^}]+)\}\}/g;
    defaultTemplates.forEach((template) => {
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
    const tabsWrapper = document.querySelector(".tabs-wrapper");
    const leftArrow = document.getElementById("scroll-left-btn");
    const rightArrow = document.getElementById("scroll-right-btn");

    if (!tabsWrapper || !leftArrow || !rightArrow) return;

    const updateArrows = () => {
        const scrollLeft = tabsWrapper.scrollLeft;
        const scrollWidth = tabsWrapper.scrollWidth;
        const clientWidth = tabsWrapper.clientWidth;
        const tolerance = 1;

        leftArrow.classList.toggle("hidden", scrollLeft <= tolerance);
        rightArrow.classList.toggle("hidden", scrollLeft >= scrollWidth - clientWidth - tolerance);
    };

    leftArrow.addEventListener("click", () => {
        tabsWrapper.scrollBy({ left: -200, behavior: "smooth" });
    });

    rightArrow.addEventListener("click", () => {
        tabsWrapper.scrollBy({ left: 200, behavior: "smooth" });
    });

    tabsWrapper.addEventListener("scroll", updateArrows);
    window.addEventListener("resize", debounce(updateArrows, 100));

    let isDragging = false;
    let startX;
    let scrollLeftStart;

    tabsWrapper.addEventListener("mousedown", (e) => {
        isDragging = true;
        tabsWrapper.classList.add("is-dragging");
        startX = e.pageX - tabsWrapper.offsetLeft;
        scrollLeftStart = tabsWrapper.scrollLeft;
    });

    tabsWrapper.addEventListener("mouseleave", () => {
        isDragging = false;
        tabsWrapper.classList.remove("is-dragging");
    });

    tabsWrapper.addEventListener("mouseup", () => {
        isDragging = false;
        tabsWrapper.classList.remove("is-dragging");
    });

    tabsWrapper.addEventListener("mousemove", (e) => {
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
    observer.observe(document.getElementById("editorTabs"), { childList: true, subtree: true });

    updateArrows(); // Initial check
}

function buildTabsFromTemplate(templateContent, isFromSave = false) {
    // When not saving, only build tabs for placeholders that already exist as tabs
    const { placeholders } = parsePlaceholders(templateContent, !isFromSave);
    tabsState.placeholders = placeholders;
    tabsState.currentTemplate = templateContent;

    // Update existing tab placeholders list if this is from a save operation
    if (isFromSave) {
        tabsState.existingTabPlaceholders = [...placeholders];
    }

    const tabsList = document.getElementById("editorTabs");
    const tabPanels = document.getElementById("tabPanels");
    const templateTab = document.getElementById("template-tab");
    const templatePanel = document.getElementById("template-panel");
    const previewTab = document.getElementById("preview-tab");
    const previewPanel = document.getElementById("preview-panel");

    // Always clear placeholder tabs and panels (but keep Template and Preview tabs)
    tabsList.querySelectorAll("li:not(:first-child):not(:nth-child(2))").forEach((tab) => tab.remove());
    tabPanels.querySelectorAll(".tab-pane:not(#template-panel):not(#preview-panel)").forEach((panel) => panel.remove());

    if (placeholders.length === 0) {
        // Hide tabs and show only the main editor
        tabsList.style.display = "none";
        if (templateTab) templateTab.classList.remove("active");
        if (templatePanel) templatePanel.classList.add("active", "show");
        // Hide Preview tab by default
        const previewTabItem = document.getElementById("preview-tab-item");
        if (previewTabItem) previewTabItem.style.display = "none";
    } else {
        // Show tabs and build placeholder tabs
        tabsList.style.display = "flex";
        // Hide Preview tab by default - it will be shown when preview icon is clicked
        const previewTabItem = document.getElementById("preview-tab-item");
        if (previewTabItem) previewTabItem.style.display = "none";
        // Do not force-hide clear here; let updateClearButtonState decide based on template type

        placeholders.forEach((placeholder) => {
            const tabId = `placeholder-${placeholder.replace(/\s+/g, "-").toLowerCase()}`;
            const panelId = `${tabId}-panel`;

            const tabItem = document.createElement("li");
            tabItem.className = "nav-item";
            tabItem.setAttribute("role", "presentation");
            const tabButton = document.createElement("button");
            tabButton.className = "nav-link";
            tabButton.id = tabId;
            tabButton.setAttribute("data-bs-toggle", "tab");
            tabButton.setAttribute("data-bs-target", `#${panelId}`);
            tabButton.type = "button";
            tabButton.setAttribute("role", "tab");
            tabButton.textContent = placeholder;
            tabItem.appendChild(tabButton);
            tabsList.appendChild(tabItem);

            const tabPanel = document.createElement("div");
            tabPanel.className = "tab-pane fade";
            tabPanel.id = panelId;
            tabPanel.setAttribute("role", "tabpanel");

            const panelContentWrapper = document.createElement("div");
            panelContentWrapper.className = "position-relative h-100 overflow-auto"; // Add h-100 and overflow-auto to make the textarea inherit the height of its parent container

            const textarea = document.createElement("textarea");
            textarea.className = "form-control px-3 py-2 h-100";
            textarea.style.resize = "none";
            textarea.placeholder = `Enter value for ${placeholder}...`;
            textarea.id = `${tabId}-textarea`;
            textarea.addEventListener("input", () => updatePlaceholder(placeholder, textarea.value));
            textarea.addEventListener("keydown", (e) => {
                if (e.key === "Enter") {
                    // Mark that Enter was just pressed
                    textarea.dataset.justPressedEnter = "true";
                    
                    setTimeout(() => {
                        // Get cursor position
                        const cursorPos = textarea.selectionStart;
                        const textBeforeCursor = textarea.value.substring(0, cursorPos);
                        const lines = textBeforeCursor.split('\n');
                        
                        // Get line height
                        const style = window.getComputedStyle(textarea);
                        const lineHeight = parseInt(style.lineHeight) || parseInt(style.fontSize) * 1.2;
                        
                        // Calculate the position of the cursor line from the top
                        const cursorLineTop = (lines.length - 1) * lineHeight;
                        
                        // Get current scroll position and viewport height
                        const currentScroll = textarea.scrollTop;
                        const viewportHeight = textarea.clientHeight;
                        const cursorLineBottom = cursorLineTop + lineHeight;
                        
                        // Scroll to keep cursor visible with more breathing room
                        if (cursorLineBottom > currentScroll + viewportHeight - (lineHeight * 5)) {
                            // Keep cursor 5 lines away from bottom
                            textarea.scrollTop = Math.max(0, cursorLineBottom - viewportHeight + (lineHeight * 6));
                        }
                        else if (cursorLineTop < currentScroll + (lineHeight * 2)) {
                            // Keep cursor 2 lines away from top
                            textarea.scrollTop = Math.max(0, cursorLineTop - (lineHeight * 2));
                        }
                        
                        // Clear the flag after a short delay
                        setTimeout(() => {
                            delete textarea.dataset.justPressedEnter;
                        }, 100);
                    }, 10);
                }
            });
            panelContentWrapper.appendChild(textarea);

            // Create button container in tab pane
            const buttonContainer = document.createElement("div");
            buttonContainer.className = "button-container";


            const previewButton = document.createElement("button");
            previewButton.className = "clrbtn";
            previewButton.innerHTML = `<svg width="18" height="18"><use href="sprite.svg#preview"></use></svg>`;
            previewButton.setAttribute("aria-label", `Preview ${placeholder}`);
            previewButton.setAttribute("data-bs-toggle", "tooltip");
            previewButton.setAttribute("data-bs-placement", "top");
            previewButton.title = `Preview template with values`;
            previewButton.addEventListener("click", () => {
                togglePreviewTab(true);
            });
            buttonContainer.appendChild(previewButton);

            const clearButton = document.createElement("button");
            clearButton.className = "clrbtn";
            clearButton.innerHTML = `<svg width="15" height="15"><use href="sprite.svg#clear"></use></svg>`;
            clearButton.setAttribute("aria-label", `Clear ${placeholder}`);
            clearButton.setAttribute("data-bs-toggle", "tooltip");
            clearButton.setAttribute("data-bs-placement", "top");
            clearButton.title = `Clear ${placeholder}`;
            clearButton.addEventListener("click", () => {
                updatePlaceholder(placeholder, "");
                textarea.value = "";
                textarea.focus();
            });
            buttonContainer.appendChild(clearButton);

            panelContentWrapper.appendChild(buttonContainer);

            new bootstrap.Tooltip(clearButton);
            new bootstrap.Tooltip(previewButton);

            tabPanel.appendChild(panelContentWrapper);
            tabPanels.appendChild(tabPanel);

            tabsState.placeholderValues[placeholder] = tabsState.placeholderValues[placeholder] || "";
            textarea.value = tabsState.placeholderValues[placeholder];
            updateTabTitle(placeholder, textarea.value.trim() !== "");
        });

        // Show the template tab by default, unless we're in preview mode
        if (templateTab && !tabsState.previewMode) new bootstrap.Tab(templateTab).show();

        // If we were in preview mode, restore it after rebuilding tabs
        if (tabsState.previewMode) {
            const previewTabItem = document.getElementById("preview-tab-item");
            if (previewTabItem) {
                previewTabItem.style.display = "block";
                // Hide all placeholder tabs again
                tabsList.querySelectorAll("li:not(:first-child):not(#preview-tab-item)").forEach((tab) => {
                    tab.style.display = "none";
                });
                // Don't automatically switch to preview tab when editing - stay on current tab
            }
        }
    }
    updateClearButtonState();
    renderPlaceholdersInTemplate();
    updatePreviewArea(); // Update preview area when tabs are built
    // The MutationObserver will handle the arrow updates automatically
    // Update prompt area height after building tabs
    updatePromptAreaHeight();
}

function destroyTabs() {
    const tabsList = document.getElementById("editorTabs");
    const templateTab = document.getElementById("template-tab");
    const templatePanel = document.getElementById("template-panel");
    const previewTabItem = document.getElementById("preview-tab-item");
    const previewPanel = document.getElementById("preview-panel");

    // Reset preview mode when destroying tabs
    tabsState.previewMode = false;

    tabsList.style.display = "none";
    // Remove only placeholder tabs, keep Template and Preview tabs
    tabsList.querySelectorAll("li:not(:first-child):not(#preview-tab-item)").forEach((tab) => tab.remove());
    document
        .getElementById("tabPanels")
        .querySelectorAll(".tab-pane:not(#template-panel):not(#preview-panel)")
        .forEach((panel) => panel.remove());

    if (templateTab) templateTab.classList.remove("active");
    if (templatePanel) templatePanel.classList.add("active", "show");
    // Hide Preview tab by default
    if (previewTabItem) previewTabItem.style.display = "none";
    // Hide Preview panel and clear its content
    if (previewPanel) {
        previewPanel.classList.remove("active", "show");
        previewPanel.classList.add("fade");
    }
    // Clear preview area content
    if (elements.previewArea) elements.previewArea.innerHTML = "";

    // Update height after destroying tabs
    updatePromptAreaHeight();
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

    // Create a document fragment to safely build the content
    const fragment = document.createDocumentFragment();
    // Only parse and style placeholders that have existing tabs
    const { placeholderPositions } = parsePlaceholders(tabsState.currentTemplate, true);

    let lastIndex = 0;
    const allPositions = [];
    placeholderPositions.forEach((positions, placeholder) => {
        positions.forEach((pos) => {
            allPositions.push({ ...pos, placeholder });
        });
    });

    // Sort positions in ascending order for proper processing
    allPositions.sort((a, b) => a.start - b.start);

    allPositions.forEach((pos) => {
        const { placeholder, start, end, original } = pos;

        // Add text before this placeholder (safely escaped)
        if (start > lastIndex) {
            const textBefore = tabsState.currentTemplate.slice(lastIndex, start);
            fragment.appendChild(document.createTextNode(textBefore));
        }

        // Create placeholder span
        const hasValue = tabsState.placeholderValues[placeholder]?.trim();
        const span = document.createElement("span");
        span.className = `placeholder-marker ${hasValue ? "placeholder-filled" : "placeholder-empty"}`;
        span.setAttribute("data-type", placeholder);
        span.setAttribute("title", `Click to edit ${placeholder}`);
        span.setAttribute("contenteditable", "false");
        span.textContent = original; // This safely escapes the content
        fragment.appendChild(span);

        lastIndex = end;
    });

    // Add remaining text after the last placeholder
    if (lastIndex < tabsState.currentTemplate.length) {
        const textAfter = tabsState.currentTemplate.slice(lastIndex);
        fragment.appendChild(document.createTextNode(textAfter));
    }

    isUpdatingContent = true;
    elements.promptArea.innerHTML = "";
    elements.promptArea.appendChild(fragment);
    isUpdatingContent = false;

    if (shouldPreserveCursor) {
        try {
            const { node, offset } = findTextNodeAndOffset(elements.promptArea, cursorOffset);
            const range = document.createRange();
            const sel = window.getSelection();
            
            // Ensure we have a valid text node and offset
            if (node && node.nodeType === Node.TEXT_NODE) {
                // Clamp offset to valid range
                const safeOffset = Math.min(offset, node.textContent.length);
                range.setStart(node, safeOffset);
                range.setEnd(node, safeOffset);
                sel.removeAllRanges();
                sel.addRange(range);
                
                // Only focus promptArea if search is not visible
                if (!isGlobalSearchVisible) {
                    elements.promptArea.focus();
                }
            } else {
                // If we can't find a valid text node, try to place cursor at the end
                const lastChild = elements.promptArea.lastChild;
                if (lastChild && lastChild.nodeType === Node.TEXT_NODE) {
                    range.setStart(lastChild, lastChild.textContent.length);
                    range.setEnd(lastChild, lastChild.textContent.length);
                    sel.removeAllRanges();
                    sel.addRange(range);
                    // Only focus promptArea if search is not visible
                    if (!isGlobalSearchVisible) {
                        elements.promptArea.focus();
                    }
                }
            }
        } catch (e) {
            console.warn("Cursor restoration failed:", e);
            // Fallback: only focus the prompt area if search is not visible
            if (!isGlobalSearchVisible) {
                elements.promptArea.focus();
            }
        }
    }

    elements.promptArea.querySelectorAll(".placeholder-marker").forEach((element) => {
        element.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            const placeholderType = e.target.getAttribute("data-type");
            // Only switch to tab if it exists
            if (placeholderType && tabsState.existingTabPlaceholders.includes(placeholderType)) {
                switchToPlaceholderTab(placeholderType);
            }
        });
        element.setAttribute("contenteditable", "false");
    });
    try {
        refreshSearchIfActive();
    } catch (_) {}
}

function updatePlaceholder(type, value) {
    tabsState.placeholderValues[type] = value;

    // Save to session on placeholder value change
    saveToSession();

    // Store the currently focused element and cursor position before any DOM manipulation
    const currentlyFocused = document.activeElement;
    const isFocusedTextarea = currentlyFocused && currentlyFocused.tagName === 'TEXTAREA';
    let savedCursorStart = 0;
    let savedCursorEnd = 0;
    let savedScrollTop = 0;
    let skipScrollRestore = false;
    
    if (isFocusedTextarea && currentlyFocused.selectionStart !== undefined) {
        savedCursorStart = currentlyFocused.selectionStart;
        savedCursorEnd = currentlyFocused.selectionEnd;
        savedScrollTop = currentlyFocused.scrollTop;
        // Check if Enter was just pressed - if so, don't restore scroll
        skipScrollRestore = currentlyFocused.dataset.justPressedEnter === "true";
    }

    const textarea = document.getElementById(`placeholder-${type.replace(/\s+/g, "-").toLowerCase()}-textarea`);
    if (textarea && textarea.value !== value) {
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const scrollTop = textarea.scrollTop;
        textarea.value = value;
        // Only restore scroll if Enter wasn't just pressed
        if (!skipScrollRestore) {
            textarea.scrollTop = scrollTop;
        }
        textarea.setSelectionRange(start, end);
    }
    updateTabTitle(type, value.trim() !== "");
    renderPlaceholdersInTemplate();
    updatePreviewArea();
    saveState();
    try {
        refreshSearchIfActive();
    } catch (_) {}
    
    // Restore focus, cursor position, and conditionally restore scroll position
    if (isFocusedTextarea && currentlyFocused && currentlyFocused === textarea) {
        textarea.focus();
        textarea.setSelectionRange(savedCursorStart, savedCursorEnd);
        // Only restore scroll if Enter wasn't just pressed
        if (!skipScrollRestore) {
            textarea.scrollTop = savedScrollTop;
        }
    }
}

function updateTabTitle(placeholder, hasValue) {
    const tabId = `placeholder-${placeholder.replace(/\s+/g, "-").toLowerCase()}`;
    const tabButton = document.getElementById(tabId);
    if (tabButton) {
        tabButton.textContent = placeholder;
        tabButton.classList.toggle("filled", hasValue);

        if (hasValue) {
            const checkmark = document.createElement("span");
            checkmark.innerHTML = "&nbsp;&#10003;";
            checkmark.style.color = "#3b82f6"; // A clean blue for the checkmark
            checkmark.style.fontSize = "12px";
            tabButton.appendChild(checkmark);
        }
    }
}

function switchToPlaceholderTab(placeholder) {
    // Exit preview mode if we're in it
    if (tabsState.previewMode) {
        togglePreviewTab(false);
    }

    // Construct the tab ID and switch to it
    const tabId = `placeholder-${placeholder.replace(/\s+/g, "-").toLowerCase()}`;
    const tabButton = document.getElementById(tabId);

    if (tabButton) {
        new bootstrap.Tab(tabButton).show();

        // Focus the textarea in the placeholder tab
        const textareaId = `${tabId}-textarea`;
        const textarea = document.getElementById(textareaId);
        if (textarea) {
            setTimeout(() => textarea.focus(), 100);
        }
    }
}

function generatePreviewContent() {
    if (!tabsState.currentTemplate) return "";

    // For preview, only show placeholders that have tabs
    const { placeholderPositions } = parsePlaceholders(tabsState.currentTemplate, true);
    let htmlContent = tabsState.currentTemplate;

    const allPositions = [];
    placeholderPositions.forEach((positions, placeholder) => {
        positions.forEach((pos) => {
            allPositions.push({ ...pos, placeholder });
        });
    });

    // Sort positions in descending order to avoid index shifting issues
    allPositions.sort((a, b) => b.start - a.start);

    // Replace placeholders with styled spans
    allPositions.forEach((pos) => {
        const { placeholder, start, end, original } = pos;
        const hasValue = tabsState.placeholderValues[placeholder]?.trim();
        // Show value if available, otherwise show placeholder
        const displayContent = hasValue ? tabsState.placeholderValues[placeholder] : original;
        
        // Escape HTML but preserve newlines by converting them to <br> tags
        const escapedContent = escapeHtml(displayContent).replace(/\n/g, '<br>');
        
        const spanHtml = `<span class="placeholder-marker ${
            hasValue ? "placeholder-filled" : "placeholder-empty"
        }" data-type="${placeholder}" title="${placeholder}: ${
            hasValue ? displayContent : "No value set"
        }">${escapedContent}</span>`;
        htmlContent = htmlContent.slice(0, start) + spanHtml + htmlContent.slice(end);
    });

    // Escape HTML for the non-placeholder text parts
    // We need to escape the regular text but preserve our placeholder spans
    const parts = [];
    let lastEnd = 0;
    const placeholderRegex = /<span class="placeholder-marker[^>]*>.*?<\/span>/g;
    let match;
    while ((match = placeholderRegex.exec(htmlContent)) !== null) {
        // Add escaped text before the placeholder
        if (match.index > lastEnd) {
            parts.push(escapeHtml(htmlContent.slice(lastEnd, match.index)));
        }
        // Add the placeholder span as-is
        parts.push(match[0]);
        lastEnd = match.index + match[0].length;
    }
    // Add any remaining text after the last placeholder
    if (lastEnd < htmlContent.length) {
        parts.push(escapeHtml(htmlContent.slice(lastEnd)));
    }

    return parts.join("");
}

function updatePreviewArea() {
    if (elements.previewArea) {
        // Only update preview content if we're in preview mode or have placeholders
        if (tabsState.previewMode && tabsState.currentTemplate) {
            elements.previewArea.innerHTML = generatePreviewContent();
            // Keep placeholder styling in preview but don't make them clickable
            elements.previewArea.querySelectorAll(".placeholder-marker").forEach((element) => {
                element.setAttribute("contenteditable", "false");
                // No click handler - placeholders in preview mode are just for viewing
            });
            // If Finder is open, render highlights for the Preview panel
            try {
                if (isGlobalSearchVisible && elements.globalSearchInput && elements.globalSearchInput.value.trim()) {
                    const previewMatches = getContainerMatches("preview");
                    clearHighlightsInElement(elements.previewArea);
                    // Active index within preview if the global active match belongs here
                    let activeIndex = -1;
                    if (
                        currentGlobalMatchIndex >= 0 &&
                        allSearchMatches[currentGlobalMatchIndex] &&
                        allSearchMatches[currentGlobalMatchIndex].containerId === "preview"
                    ) {
                        const active = allSearchMatches[currentGlobalMatchIndex];
                        activeIndex = previewMatches.findIndex((m) => m.start === active.start && m.end === active.end);
                    }
                    applyHighlightsInElement(elements.previewArea, previewMatches, activeIndex);
                } else {
                    clearHighlightsInElement(elements.previewArea);
                }
            } catch (_) {}
        } else {
            // Clear preview area when not in preview mode
            elements.previewArea.innerHTML = "";
        }
    }
}

function togglePreviewTab(show) {
    const previewTabItem = document.getElementById("preview-tab-item");
    const previewTab = document.getElementById("preview-tab");
    const templateTab = document.getElementById("template-tab");
    const tabsList = document.getElementById("editorTabs");

    // Update preview mode state
    tabsState.previewMode = show;

    if (show) {
        // Store the currently active tab before switching to preview
        const activeTab = document.querySelector("#editorTabs .nav-link.active");
        if (activeTab) {
            tabsState.previousActiveTabId = activeTab.id;
        }

        // Show Preview tab and hide all placeholder tabs
        previewTabItem.style.display = "block";

        // Hide all placeholder tabs (keep only Template and Preview)
        tabsList.querySelectorAll("li:not(:first-child):not(#preview-tab-item)").forEach((tab) => {
            tab.style.display = "none";
        });

        // Switch to Preview tab
        updatePreviewArea();
        new bootstrap.Tab(previewTab).show();
        // Persist state so reopening the popup restores preview mode
        try {
            saveState();
        } catch (_) {}
    } else {
        // Hide Preview tab and show all placeholder tabs
        previewTabItem.style.display = "none";

        // Show all placeholder tabs
        tabsList.querySelectorAll("li:not(:first-child):not(#preview-tab-item)").forEach((tab) => {
            tab.style.display = "block";
        });

        // Switch back to the previously active tab (or Template tab if none stored)
        const previousTabId = tabsState.previousActiveTabId || "template-tab";
        const previousTab = document.getElementById(previousTabId);
        if (previousTab) {
            new bootstrap.Tab(previousTab).show();
        } else {
            // Fallback to Template tab if previous tab no longer exists
            new bootstrap.Tab(templateTab).show();
        }
        
        // Clear the stored tab ID after restoring
        tabsState.previousActiveTabId = null;
        
        // Persist state so reopening the popup restores non-preview mode
        try {
            saveState();
        } catch (_) {}
    }
}

function getPreviewTextContent() {
    if (!tabsState.currentTemplate) return "";

    let previewContent = tabsState.currentTemplate;

    // Only replace placeholders that have tabs (plain text, no HTML)
    tabsState.existingTabPlaceholders.forEach((placeholder) => {
        const value = tabsState.placeholderValues[placeholder];
        if (value && value.trim()) {
            const placeholderRegex = new RegExp(
                `\\{\\{\\s*${placeholder.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\}\\}`,
                "g"
            );
            previewContent = previewContent.replace(placeholderRegex, value);
        }
    });

    return previewContent;
}

// --- Event Handlers ---

function handleNameInput() {
    const currentValue = elements.templateName.value;
    const currentCaret = elements.templateName.selectionStart;
    // Rebase stacks if context changed
    if (nameStackContextSerial !== contextSerial) {
        nameUndoStack = [];
        nameRedoStack = [];
        nameLastSnapshot = currentValue;
        nameLastCaret = currentCaret || 0;
        nameStackContextSerial = contextSerial;
        return;
    }

    // Push snapshot to undo stack only on user edits
    if (currentValue !== nameLastSnapshot) {
        nameUndoStack.push({ content: nameLastSnapshot, caret: nameLastCaret });
        // Limit history length to avoid memory bloat
        if (nameUndoStack.length > 100) nameUndoStack.shift();
        nameLastSnapshot = currentValue;
        nameLastCaret = currentCaret;
        nameRedoStack = []; // Clear redo stack on new input
    }
}

function handleNameKeydown(event) {
    // Handle Ctrl+Z and Ctrl+Shift+Z within the template name input
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) {
            // Redo
            if (nameStackContextSerial !== contextSerial) {
                // Rebase to current context and do nothing
                nameUndoStack = [];
                nameRedoStack = [];
                nameLastSnapshot = elements.templateName.value || "";
                nameLastCaret = elements.templateName.selectionStart || 0;
                nameStackContextSerial = contextSerial;
                return;
            }
            if (nameRedoStack.length > 0) {
                nameRedo();
            }
            return;
        } else {
            // Undo
            if (nameStackContextSerial !== contextSerial) {
                nameUndoStack = [];
                nameRedoStack = [];
                nameLastSnapshot = elements.templateName.value || "";
                nameLastCaret = elements.templateName.selectionStart || 0;
                nameStackContextSerial = contextSerial;
                return;
            }
            if (nameUndoStack.length > 0) {
                nameUndo();
            }
            return;
        }
    }
}

function nameUndo() {
    if (!nameUndoStack.length) return;
    if (nameStackContextSerial !== contextSerial) return;

    const prev = nameUndoStack.pop();
    const prevContent = typeof prev === "string" ? prev : prev.content || "";
    const prevCaret = typeof prev === "string" ? 0 : prev.caret ?? 0;
    const currentCaret = elements.templateName.selectionStart;
    const current = nameLastSnapshot;

    nameRedoStack.push({ content: current, caret: currentCaret });
    nameLastSnapshot = prevContent;
    nameLastCaret = prevCaret;

    elements.templateName.value = prevContent;
    setTimeout(() => {
        elements.templateName.setSelectionRange(prevCaret, prevCaret);
    }, 0);

    validateTemplateNameInput();
    updateExportSingleBtnState();
    saveState();
}

function nameRedo() {
    if (!nameRedoStack.length) return;
    if (nameStackContextSerial !== contextSerial) return;

    const next = nameRedoStack.pop();
    const nextContent = typeof next === "string" ? next : next.content || "";
    const nextCaret = typeof next === "string" ? 0 : next.caret ?? 0;
    const currentCaret = elements.templateName.selectionStart;

    nameUndoStack.push({ content: nameLastSnapshot, caret: currentCaret });
    nameLastSnapshot = nextContent;
    nameLastCaret = nextCaret;

    elements.templateName.value = nextContent;
    setTimeout(() => {
        elements.templateName.setSelectionRange(nextCaret, nextCaret);
    }, 0);

    validateTemplateNameInput();
    updateExportSingleBtnState();
    saveState();
}

function handleTagsInput() {
    const currentValue = elements.templateTags.value;
    const currentCaret = elements.templateTags.selectionStart;
    // Rebase stacks if context changed
    if (tagsStackContextSerial !== contextSerial) {
        tagsUndoStack = [];
        tagsRedoStack = [];
        tagsLastSnapshot = currentValue;
        tagsLastCaret = currentCaret || 0;
        tagsStackContextSerial = contextSerial;
        return;
    }

    // Push snapshot to undo stack only on user edits
    if (currentValue !== tagsLastSnapshot) {
        tagsUndoStack.push({ content: tagsLastSnapshot, caret: tagsLastCaret });
        // Limit history length to avoid memory bloat
        if (tagsUndoStack.length > 100) tagsUndoStack.shift();
        tagsLastSnapshot = currentValue;
        tagsLastCaret = currentCaret;
        tagsRedoStack = []; // Clear redo stack on new input
    }
}

function handleTagsKeydown(event) {
    // Handle Ctrl+Z and Ctrl+Shift+Z within the tags input
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) {
            if (tagsStackContextSerial !== contextSerial) {
                tagsUndoStack = [];
                tagsRedoStack = [];
                tagsLastSnapshot = elements.templateTags.value || "";
                tagsLastCaret = elements.templateTags.selectionStart || 0;
                tagsStackContextSerial = contextSerial;
                return;
            }
            if (tagsRedoStack.length > 0) {
                tagsRedo();
            }
            return;
        } else {
            if (tagsStackContextSerial !== contextSerial) {
                tagsUndoStack = [];
                tagsRedoStack = [];
                tagsLastSnapshot = elements.templateTags.value || "";
                tagsLastCaret = elements.templateTags.selectionStart || 0;
                tagsStackContextSerial = contextSerial;
                return;
            }
            if (tagsUndoStack.length > 0) {
                tagsUndo();
            }
            return;
        }
    }

    // Smart Backspace handling for comma-space separators
    // When the caret is just after a comma-space (", "), delete both at once
    // This prevents the caret from getting stuck on the space due to input normalization
    if (event.key === "Backspace" && !event.ctrlKey && !event.metaKey) {
        const input = elements.templateTags;
        const start = input.selectionStart;
        const end = input.selectionEnd;
        if (start === end && start >= 2) {
            const v = input.value;
            if (v[start - 1] === " " && v[start - 2] === ",") {
                event.preventDefault();

                // Snapshot current state for tags undo/redo consistency
                const prevContent = input.value;
                const prevCaret = start;
                tagsUndoStack.push({ content: tagsLastSnapshot, caret: tagsLastCaret });
                if (tagsUndoStack.length > 100) tagsUndoStack.shift();
                tagsLastSnapshot = prevContent;
                tagsLastCaret = prevCaret;
                tagsRedoStack = [];

                // Remove the comma-space pair
                const newValue = v.slice(0, start - 2) + v.slice(end);
                input.value = newValue;
                const newCaret = start - 2;
                setTimeout(() => {
                    input.setSelectionRange(newCaret, newCaret);
                }, 0);

                validateTagsInput();
                saveState();
                return;
            }
        }
    }
}

function tagsUndo() {
    if (!tagsUndoStack.length) return;
    if (tagsStackContextSerial !== contextSerial) return;

    const prev = tagsUndoStack.pop();
    const prevContent = typeof prev === "string" ? prev : prev.content || "";
    const prevCaret = typeof prev === "string" ? 0 : prev.caret ?? 0;
    const currentCaret = elements.templateTags.selectionStart;
    const current = tagsLastSnapshot;

    tagsRedoStack.push({ content: current, caret: currentCaret });
    tagsLastSnapshot = prevContent;
    tagsLastCaret = prevCaret;

    elements.templateTags.value = prevContent;
    setTimeout(() => {
        elements.templateTags.setSelectionRange(prevCaret, prevCaret);
    }, 0);

    validateTagsInput();
    saveState();
}

function tagsRedo() {
    if (!tagsRedoStack.length) return;
    if (tagsStackContextSerial !== contextSerial) return;

    const next = tagsRedoStack.pop();
    const nextContent = typeof next === "string" ? next : next.content || "";
    const nextCaret = typeof next === "string" ? 0 : next.caret ?? 0;
    const currentCaret = elements.templateTags.selectionStart;

    tagsUndoStack.push({ content: tagsLastSnapshot, caret: currentCaret });
    tagsLastSnapshot = nextContent;
    tagsLastCaret = nextCaret;

    elements.templateTags.value = nextContent;
    setTimeout(() => {
        elements.templateTags.setSelectionRange(nextCaret, nextCaret);
    }, 0);

    validateTagsInput();
    saveState();
}

function validateTagsInput() {
    let value = elements.templateTags.value;
    if (value) {
        // Normalize input: remove leading/trailing commas/spaces, standardize comma-space separator
        value = value.replace(/^[,\s]+/g, "").replace(/[\s]*,[,\s]*/g, ", ");
        value = value.replace(/\s+/g, " "); // Replace multiple spaces with single space
        const tags = value.split(", ");

        // Validate tag count
        if (tags.length > 5) {
            showToast("Maximum of 5 tags allowed per template.", 4000, "error", [], "tagsLength");
            value = tags.slice(0, 5).join(", ");
        }

        // Validate and sanitize tags
        if (tags.some((tag) => tag.length > 20)) {
            showToast("Each tag must be 20 characters or fewer.", 4000, "error", [], "tagLength");
        }
        const trimmedTags = tags.map((tag) => tag.slice(0, 20));

        const sanitizedTags = trimmedTags.map((tag) => tag.replace(/[^a-zA-Z0-9-_.@\s]/g, ""));
        if (sanitizedTags.some((tag, i) => tag !== trimmedTags[i])) {
            showToast(
                "Each tag can include only letters, numbers, underscores (_), hyphens (-), periods (.), at (@), or spaces.",
                4000,
                "error",
                [],
                "tagChar"
            );
        }

        // Update input value with sanitized tags
        value = sanitizedTags.join(", ");
        elements.templateTags.value = value;
    }
}

function validateTemplateNameInput() {
    const name = elements.templateName.value.trim();
    // Just basic validation for real-time feedback
    if (name.length > 50) {
        elements.templateName.value = name.slice(0, 50);
    }
}

function handleNewTemplate(options = {}) {
    const { skipStore = false, suppressToast = false, skipSaveState = false } = options;

    // Save current template's unsaved changes before creating new
    // IMPORTANT: Do this BEFORE changing selectedTemplateName
    if (selectedTemplateName || elements.promptArea.textContent.trim()) {
        saveToSession(); // Save with the current template name before switching
    }

    if (!skipStore) storeLastState();
    // New template context: bump serial to isolate undo stacks
    contextSerial++;
    selectedTemplateName = null;
    editingTargetName = null;
    originalTagsBeforeEdit = null;

    // Update the current session key to draft mode
    chrome.storage.session.set({ currentSessionKey: "unsaved_draft" });
    elements.templateName.value = getDefaultTemplateName();
    elements.templateTags.value = "";
    const defaultContent = `# Your Role\n*\n\n# Background Information\n*\n\n# Your Task\n*`;
    elements.promptArea.textContent = defaultContent;
    tabsState.currentTemplate = defaultContent; // Set the current template
    tabsState.placeholderValues = {}; // Clear placeholder values for new template
    tabsState.previewMode = false; // Reset preview mode for new template
    // Clear preview area content
    if (elements.previewArea) elements.previewArea.innerHTML = "";
    // Reset scroll positions for a fresh editor view
    try {
        elements.promptArea.scrollTop = 0;
    } catch (_) {}
    try {
        if (elements.previewArea) elements.previewArea.scrollTop = 0;
    } catch (_) {}
    // Reset editor stacks to this blank template so later Ctrl+Z doesn't jump back here
    editorUndoStack = [];
    editorRedoStack = [];
    editorLastSnapshot = defaultContent;
    editorLastCaret = 0;
    // Reset name/tags stacks for new template context
    try {
        nameUndoStack = [];
        nameRedoStack = [];
        nameLastSnapshot = elements.templateName.value || "";
        nameLastCaret = 0;
        nameStackContextSerial = contextSerial;

        tagsUndoStack = [];
        tagsRedoStack = [];
        tagsLastSnapshot = elements.templateTags.value || "";
        tagsLastCaret = 0;
        tagsStackContextSerial = contextSerial;
    } catch (_) {}
    switchToTagsEditMode();
    updateSaveButtonState();
    updateDeleteButtonState();
    updateExportSingleBtnState();
    elements.fetchBtn2.style.display = "none";
    elements.searchBox.value = "";
    // Reset preview mode before destroying tabs
    tabsState.previewMode = false;
    destroyTabs();
    tabsState.existingTabPlaceholders = []; // Clear existing tabs for new template
    buildTabsFromTemplate(defaultContent); // Build tabs from the default content
    // Ensure scroll stays at the top after layout updates
    try {
        elements.promptArea.scrollTop = 0;
    } catch (_) {}
    try {
        if (elements.previewArea) elements.previewArea.scrollTop = 0;
    } catch (_) {}
    // Don't call updatePreviewArea() here since we're not in preview mode
    if (!skipSaveState) {
        saveState();
    }
    // Suppress any toast for creating a new template as per new requirement
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
        // Use the raw content with placeholder tokens restored from the editor
        let content = getContentWithPlaceholders();
        if (!content.trim()) {
            showToast("Prompt content is required.", 3000, "error", [], "save");
            elements.promptArea.focus();
            return;
        }

        const { placeholders } = parsePlaceholders(content);
        const hasPlaceholderValuesAll = placeholders.some((placeholder) => {
            const value = tabsState.placeholderValues[placeholder];
            return value && value.trim() !== "";
        });
        const isNewTemplate = !selectedTemplateName && !editingTargetName;
        
        // Check 50 template limit for new templates
        if (isNewTemplate) {
            const customCount = getCustomTemplateCount(templates);
            if (customCount >= 50) {
                showToast("You've reached the maximum of 50 custom templates. Please delete some templates to save new ones.", 5000, "warning", [], "save");
                return;
            }
        }
        
        if (!isNewTemplate) {
            const templateName = selectedTemplateName || editingTargetName;
            const template = templates.find((t) => t.name === templateName);
            // If template doesn't exist (e.g., after undoing a new template save), treat as new
            if (!template) {
                // Reset editingTargetName since the template doesn't exist
                editingTargetName = null;
                // Recursively call with corrected state
                handleSaveTemplate();
                return;
            }
            const isEdited =
                elements.templateName.value !== template.name ||
                tags.join(",") !== (template.tags || []).join(",") ||
                content !== template.content ||
                hasPlaceholderValuesAll;
            if (!isEdited) {
                showToast("No changes to save.", 3000, "info", [], "save");
                return;
            }
        }

        // Detect any new placeholders ({{...}}) not yet allowed and persist them
        const regex = /\{\{([^}]+)\}\}/g;
        const found = new Set();
        let m;
        while ((m = regex.exec(content)) !== null) {
            const ph = m[1].trim();
            if (ph) found.add(ph);
        }
        const unknown = Array.from(found).filter((ph) => !ALLOWED_PLACEHOLDERS.includes(ph));
        if (unknown.length > 0) {
            chrome.storage.local.get(["userPlaceholders"], (r2) => {
                const existing = Array.isArray(r2.userPlaceholders) ? r2.userPlaceholders : [];
                const merged = Array.from(new Set([...existing, ...unknown]));
                // Update runtime allowed list too
                unknown.forEach((ph) => {
                    if (!ALLOWED_PLACEHOLDERS.includes(ph)) ALLOWED_PLACEHOLDERS.push(ph);
                });
                chrome.storage.local.set({ userPlaceholders: merged });
            });
        }

        const saveAction = () => {
            // Re-enable undo for Save: snapshot current UI and templates before saving
            storeLastState();
            if (lastState) {
                lastState.actionType = isNewTemplate ? "saveNew" : "saveUpdate";
                lastState.templates = deepClone(templates);
            }
            if (isNewTemplate) {
                const now = Date.now();
                const newTemplate = {
                    name,
                    tags,
                    content,
                    type: "custom",
                    favorite: false,
                    index: nextIndex,
                    createdAt: now,
                    updatedAt: now,
                };
                templates.push(newTemplate);
                updateRecentIndices(nextIndex);
                nextIndex++;
                saveNextIndex();
            } else {
                const templateName = selectedTemplateName || editingTargetName;
                const templateIndex = templates.findIndex((t) => t.name === templateName);
                templates[templateIndex] = { ...templates[templateIndex], name, tags, content, updatedAt: Date.now() };
            }

            saveTemplates(
                templates,
                () => {
                    selectedTemplateName = name;
                    editingTargetName = name;

                    // Clear session data after successful save
                    clearSessionForTemplate(name);

                    // Update UI with raw content (placeholders retained)
                    tabsState.currentTemplate = content;
                    elements.promptArea.textContent = content;
                    // Keep placeholder values after SAVE (no longer reset)
                    buildTabsFromTemplate(content, true); // isFromSave = true
                    renderPlaceholdersInTemplate(); // Render placeholders immediately after building tabs

                    loadTemplates();
                    saveState();
                    switchToTagsViewMode();
                    updateExportSingleBtnState();
                    updateDeleteButtonState();
                },
                isNewTemplate
            );
        };

        // Check for tags and show warning if none
        const hasNoTags = tags.length === 0;
        if (hasNoTags) {
            showModal(
                "No tags have been added. Confirm saving this template without tags.",
                [
                    { text: "Cancel", callback: () => elements.templateTags.focus() },
                    { text: "Save", callback: saveAction },
                ],
                "warning"
            );
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

        let content = getContentWithPlaceholders();
        if (!content.trim()) {
            showToast("Prompt content is required.", 3000, "error", [], "saveAs");
            elements.promptArea.focus();
            return;
        }
        
        // Check 50 template limit for SaveAs (always creates new template)
        const customCount = getCustomTemplateCount(templates);
        if (customCount >= 50) {
            showToast("You've reached the maximum of 50 custom templates. Please delete some templates to save new ones.", 5000, "warning", [], "saveAs");
            return;
        }

        // Detect and persist any new user placeholders
        const regex = /\{\{([^}]+)\}\}/g;
        const found = new Set();
        let m;
        while ((m = regex.exec(content)) !== null) {
            const ph = m[1].trim();
            if (ph) found.add(ph);
        }
        const unknown = Array.from(found).filter((ph) => !ALLOWED_PLACEHOLDERS.includes(ph));
        if (unknown.length > 0) {
            chrome.storage.local.get(["userPlaceholders"], (r2) => {
                const existing = Array.isArray(r2.userPlaceholders) ? r2.userPlaceholders : [];
                const merged = Array.from(new Set([...existing, ...unknown]));
                unknown.forEach((ph) => {
                    if (!ALLOWED_PLACEHOLDERS.includes(ph)) ALLOWED_PLACEHOLDERS.push(ph);
                });
                chrome.storage.local.set({ userPlaceholders: merged });
            });
        }

        // Create a processed copy with placeholder values filled for SAVE AS
        let contentWithValues = content;
        for (const placeholder in tabsState.placeholderValues) {
            const value = tabsState.placeholderValues[placeholder];
            if (value && value.trim() !== "") {
                const regex = new RegExp(`\\{\\{${placeholder.replace(/[-\\/\\^$*+?.()|[\\]{}]/g, "\\$&")}\\}\\}`, "g");
                contentWithValues = contentWithValues.replace(regex, value);
            }
        }

        const saveAction = () => {
            // Re-enable undo for Save As: snapshot current UI and templates before saving
            storeLastState();
            if (lastState) {
                lastState.actionType = "saveAs";
                lastState.templates = deepClone(templates);
            }
            
            // Store the original template name before Save As
            const originalTemplateName = selectedTemplateName || editingTargetName;
            
            const now = Date.now();
            const newTemplate = {
                name,
                tags,
                content: contentWithValues,
                type: "custom",
                favorite: false,
                index: nextIndex,
                createdAt: now,
                updatedAt: now,
            };
            templates.push(newTemplate);
            updateRecentIndices(nextIndex);
            nextIndex++;
            saveTemplates(
                templates,
                () => {
                    // Clear tags from the original template's session data (if any)
                    // while preserving content changes
                    if (originalTemplateName) {
                        const sessionKey = `unsaved_${originalTemplateName}`;
                        chrome.storage.session.get([sessionKey], (result) => {
                            const sessionData = result[sessionKey];
                            if (sessionData) {
                                // Get the original template from storage
                                const originalTemplate = templates.find(t => t.name === originalTemplateName);
                                if (originalTemplate) {
                                    const originalTags = Array.isArray(originalTemplate.tags) 
                                        ? originalTemplate.tags.join(", ") 
                                        : "";
                                    
                                    // Update session to reset name and tags to original, but keep content changes
                                    sessionData.templateName = originalTemplate.name;  // Reset name to original
                                    sessionData.templateTags = originalTags;           // Reset tags to original
                                    // Keep templateContent as-is to preserve content changes
                                    
                                    const payload = {};
                                    payload[sessionKey] = sessionData;
                                    chrome.storage.session.set(payload);
                                }
                            }
                        });
                    }
                    
                    // Update template name/selection
                    selectedTemplateName = name;
                    editingTargetName = name;

                    // After Save As, update editor with content that has values filled in
                    tabsState.currentTemplate = contentWithValues;
                    elements.promptArea.textContent = contentWithValues;
                    
                    // Clear placeholder values since they're now part of the content
                    tabsState.placeholderValues = {};
                    
                    // Parse placeholders from the new content (which may have none if all were filled)
                    const { placeholders } = parsePlaceholders(contentWithValues, false);
                    tabsState.existingTabPlaceholders = [...placeholders];
                    
                    // Rebuild tabs - will destroy all tabs if no placeholders remain
                    buildTabsFromTemplate(contentWithValues, true);
                    renderPlaceholdersInTemplate();

                    // Switch tags to view mode after Save As to make them clickable
                    if (tags && tags.length > 0) {
                        switchToTagsViewMode();
                    }

                    loadTemplates();
                    updateExportSingleBtnState();
                    updateSaveButtonState();
                    updateDeleteButtonState();
                    saveState();
                    saveNextIndex();
                },
                true
            );
        };

        const hasNoTags = tags.length === 0;
        if (hasNoTags) {
            showModal(
                "No tags have been added. Confirm saving this template without tags.",
                [
                    { text: "Cancel", callback: () => elements.templateTags.focus() },
                    { text: "Save", callback: saveAction },
                ],
                "warning"
            );
        } else {
            saveAction();
        }
    });
}
function handleDeleteTemplate() {
    if (!selectedTemplateName) {
        showToast("Please select a template to delete.", 3000, "error", [], "delete");
        return;
    }
    chrome.storage.local.get(["templates", "recentIndices"], (result) => {
        const templates = result.templates || [];
        const storedRecentIndices = result.recentIndices || [];
        const template = templates.find((t) => t.name === selectedTemplateName);
        if (!template) {
            showToast("Template not found.", 3000, "error", [], "delete");
            return;
        }
        if (template.type === "pre-built") {
            showToast("Cannot delete a default template.", 3000, "error", [], "delete");
            return;
        }

        showModal(
            `<strong>Confirm deletion</strong><br><br>Deleting '${selectedTemplateName}' is permanent. You cannot undo this action.`,
            [
                { text: "Cancel", callback: () => {} },
                {
                    text: "Delete",
                    callback: () => {
                        const templateIndex = templates.findIndex((t) => t.name === selectedTemplateName);
                        const deletedTemplate = templates[templateIndex] ? { ...templates[templateIndex] } : null;

                        storeLastState();
                        if (lastState) {
                            lastState.actionType = "delete";
                            lastState.templates = deepClone(templates);
                            lastState.recentIndicesSnapshot = [...storedRecentIndices];
                            lastState.nextIndexSnapshot = nextIndex;
                            lastState.deletedTemplate = deletedTemplate;
                        }
                        const deletedIndex = templates[templateIndex].index;
                        const deletedName = templates[templateIndex].name;
                        templates.splice(templateIndex, 1);
                        const updatedRecentIndices = storedRecentIndices.filter((idx) => idx !== deletedIndex);

                        chrome.storage.local.set({ templates, recentIndices: updatedRecentIndices }, () => {
                            if (chrome.runtime.lastError) {
                                showToast("Failed to delete.", 3000, "error", [], "delete");
                            } else {
                                if (lastState && deletedTemplate) {
                                    lastState.selectedName = deletedTemplate.name;
                                }
                                // Update global variables to match storage
                                recentIndices = updatedRecentIndices;
                                
                                // NOTE: We do NOT reset milestone tracking after deletion
                                // Once a milestone is reached, it stays reached forever
                                // This prevents re-showing feedback after delete + rebuild

                                // Clear session data for the deleted template and suppress further session saves briefly
                                suppressSessionSave = true;
                                clearSessionForTemplate(deletedTemplate.name || deletedName);

                                handleNewTemplate({ skipStore: true, suppressToast: true, skipSaveState: true });
                                // Refresh templates and favorite suggestions after deletion
                                loadTemplates();
                                // Re-enable session saves on next tick
                                setTimeout(() => {
                                    suppressSessionSave = false;
                                }, 0);
                                showToast("Template deleted.", 3000, "success", [], "delete");
                                // Ensure focus is moved out of all inputs immediately
                                setTimeout(() => {
                                    moveFocusOutOfEditor();
                                    if (elements.templateName && elements.templateName.blur) elements.templateName.blur();
                                    if (elements.templateTags && elements.templateTags.blur) elements.templateTags.blur();
                                    // Focus on a neutral element
                                    if (elements.deleteBtn && elements.deleteBtn.focus) {
                                        elements.deleteBtn.focus();
                                    }
                                }, 0);
                            }
                        });
                    },
                },
            ],
            "warning"
        );
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

function processFetchedContent(fetchedPrompt) {
    storeLastState();

    // Exit preview mode if we're currently in it
    if (tabsState.previewMode) {
        togglePreviewTab(false);
    }

    // Set the content and update the template
    tabsState.currentTemplate = fetchedPrompt;
    elements.promptArea.textContent = fetchedPrompt;

    // Rebuild tabs from the new content - don't create new tabs until saved
    destroyTabs();
    // Keep existing tab placeholders, don't add new ones from fetched content
    buildTabsFromTemplate(fetchedPrompt);
    renderPlaceholdersInTemplate();

    // Update UI elements
    elements.fetchBtn2.style.display = "none";
    elements.clearPrompt.style.display = "block";
    updateClearButtonState();

    // Reset editor undo/redo to this new content
    editorUndoStack = [];
    editorRedoStack = [];
    editorLastSnapshot = fetchedPrompt;
    editorLastCaret = 0;

    saveState();
}

function handleFetchPrompt() {
    getTargetTabId((tabId) => {
        if (!tabId) return;
        chrome.tabs.sendMessage(tabId, { action: "getPrompt" }, (response) => {
            if (chrome.runtime.lastError) {
                reInjectAndRetry(tabId, "getPrompt", (res) => {
                    if (res && res.prompt) {
                        processFetchedContent(res.prompt);
                    } else {
                        showToast("No text found.", 3000, "error", [], "fetch");
                    }
                });
            } else if (response && response.prompt) {
                processFetchedContent(response.prompt);
            } else {
                showToast("No text found. Please select a field that contains text.", 3000, "error", [], "fetch");
            }
        });
    });
}

function handleSendPrompt() {
    getTargetTabId((tabId) => {
        if (!tabId) return;
        // Send the preview content (with placeholder values filled in) instead of template content
        const promptToSend = getPreviewTextContent();
        chrome.tabs.sendMessage(tabId, { action: "sendPrompt", prompt: promptToSend }, (response) => {
            if (chrome.runtime.lastError) {
                console.error("Send prompt error:", chrome.runtime.lastError.message);
                showToast("Failed to send prompt. Please try again.", 3000, "error", [], "send");
            } else if (response && response.success) {
                // Close but preserve popup position/size so it remains for next open
                closePopupAndClearState(false, { preservePosition: true });
            } else {
                showToast("Failed to send prompt. Target chat not found.", 3000, "error", [], "send");
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
            showToast("Failed to connect to the page. Please try again or refresh the page.", 3000, "error", [], action);
        }
    });
}

function handleImportFile(event) {
    // During import, suppress session writes to avoid resurrecting stale unsaved data
    suppressSessionSave = true;
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const imported = jsyaml.load(e.target.result);
            // Accept either a list of templates or a single template object
            const list = Array.isArray(imported) ? imported : imported && typeof imported === "object" ? [imported] : null;
            if (!list) {
                showToast("Invalid YAML: Expected a list of prompts or a single template.", 3000, "error");
                return;
            }
            chrome.storage.local.get(["templates", "userPlaceholders"], (result) => {
                let templates = result.templates || [];
                let userPlaceholders = Array.isArray(result.userPlaceholders) ? result.userPlaceholders : [];
                let added = 0,
                    overwritten = 0,
                    skipped = 0;
                let newPlaceholdersFound = [];
                let skippedDefaultTemplates = [];
                let currentTemplateUpdated = false; // Track if currently loaded template was updated
                list.forEach((imp) => {
                    // Normalize shape
                    if (typeof imp !== "object" || !imp) imp = {};
                    // tags may come as comma-separated string from single export; normalize to array
                    if (typeof imp.tags === "string") {
                        imp.tags = imp.tags
                            .split(",")
                            .map((t) => t.trim())
                            .filter(Boolean);
                    }
                    if (!Array.isArray(imp.tags)) imp.tags = [];
                    if (typeof imp.type !== "string") imp.type = "custom";
                    if (typeof imp.favorite !== "boolean") imp.favorite = false;
                    if (!imp.name || typeof imp.name !== "string" || !imp.name.trim()) {
                        imp.name = `Imported Prompt ${templates.length + 1}`;
                    }

                    // Extract placeholders from imported template content
                    if (imp.content && typeof imp.content === "string") {
                        const placeholderRegex = /\{\{([^}]+)\}\}/g;
                        let match;
                        while ((match = placeholderRegex.exec(imp.content)) !== null) {
                            const placeholder = match[1].trim();
                            if (placeholder) {
                                // Check if placeholder already exists in allowed placeholders or user placeholders
                                const alreadyExists =
                                    ALLOWED_PLACEHOLDERS.includes(placeholder) || userPlaceholders.includes(placeholder);

                                if (!alreadyExists) {
                                    // Check if this is a default template - don't add new placeholders to default templates
                                    const existingTemplate = templates.find((t) => t.name === imp.name);
                                    const isDefaultTemplate = existingTemplate && existingTemplate.type === "pre-built";

                                    // Only add placeholder if:
                                    // 1. It's a new template (not existing)
                                    // 2. It's an existing custom template
                                    // 3. It's an existing default template that was renamed (becomes custom)
                                    if (!isDefaultTemplate) {
                                        if (!newPlaceholdersFound.includes(placeholder)) {
                                            newPlaceholdersFound.push(placeholder);
                                        }
                                    }
                                }
                            }
                        }
                    }

                    const existingIdx = templates.findIndex((t) => t.name === imp.name);
                    if (existingIdx !== -1) {
                        const existingTemplate = templates[existingIdx];
                        // Check if existing template is a default/pre-built template
                        if (existingTemplate.type === "pre-built") {
                            // Don't overwrite default templates, skip this import
                            skipped++;
                            skippedDefaultTemplates.push(imp.name);
                        } else {
                            // Safe to overwrite user-created templates
                            // Preserve important existing properties but allow content and metadata updates
                            const existingTemplate = templates[existingIdx];
                            templates[existingIdx] = {
                                ...existingTemplate, // Keep existing properties like index, createdAt
                                ...imp, // Apply imported changes
                                type: existingTemplate.type || "custom", // Preserve template type
                                index: existingTemplate.index, // Preserve original index
                                createdAt: existingTemplate.createdAt, // Preserve creation date
                                updatedAt: Date.now(), // Update modification time
                            };
                            overwritten++;

                            // Check if this is the currently loaded template
                            if (selectedTemplateName === imp.name) {
                                currentTemplateUpdated = true;
                            }
                        }
                    } else {
                        if (typeof imp.index !== "number") {
                            imp.index = templates.length ? Math.max(...templates.map((t) => t.index || 0)) + 1 : 0;
                        }
                        templates.push(imp);
                        added++;
                    }
                });

                // Add new placeholders to user placeholders and runtime allowed list
                if (newPlaceholdersFound.length > 0) {
                    const updatedUserPlaceholders = [...userPlaceholders, ...newPlaceholdersFound];
                    // Add to runtime allowed list
                    newPlaceholdersFound.forEach((ph) => {
                        if (!ALLOWED_PLACEHOLDERS.includes(ph)) {
                            ALLOWED_PLACEHOLDERS.push(ph);
                        }
                    });

                    chrome.storage.local.set(
                        {
                            templates,
                            userPlaceholders: updatedUserPlaceholders,
                        },
                        () => {
                            loadTemplates();
                            // Clear any session for affected templates so imports show exact content
                            try {
                                list.forEach((t) => clearSessionForTemplate(t.name));
                            } catch (_) {}

                            // If the currently loaded template was updated, refresh the UI
                            if (currentTemplateUpdated && selectedTemplateName) {
                                const updatedTemplate = templates.find((t) => t.name === selectedTemplateName);
                                if (updatedTemplate) {
                                    // Update the UI with the imported content
                                    elements.templateName.value = updatedTemplate.name;
                                    const tagsArray = Array.isArray(updatedTemplate.tags) ? updatedTemplate.tags : [];
                                    elements.templateTags.value = tagsArray.join(", ");
                                    tabsState.currentTemplate = updatedTemplate.content;
                                    elements.promptArea.textContent = updatedTemplate.content;

                                    // Clear placeholder values since this is imported content
                                    tabsState.placeholderValues = {};

                                    // Update existing tab placeholders and rebuild tabs
                                    const { placeholders } = parsePlaceholders(updatedTemplate.content, false);
                                    tabsState.existingTabPlaceholders = [...placeholders];
                                    buildTabsFromTemplate(updatedTemplate.content, true);
                                    renderPlaceholdersInTemplate();

                                    // Update tags display
                                    if (tagsArray.length > 0) {
                                        switchToTagsViewMode();
                                    } else {
                                        switchToTagsEditMode();
                                    }

                                    saveState();
                                }
                            }
                            const skippedMessage =
                                skipped > 0 ? ` ${skipped} skipped — default templates can't be overwritten.` : "";
                            const newText = added === 0 ? "none new" : added === 1 ? "1 new" : `${added} new`;
                            const overwrittenText =
                                overwritten === 0
                                    ? "none overwritten"
                                    : overwritten === 1
                                    ? "1 overwritten"
                                    : `${overwritten} overwritten`;
                            const toastType = skipped > 0 ? "warning" : "info";
                            showToast(
                                `Templates imported: ${newText}, ${overwrittenText}.${skippedMessage}`,
                                5000,
                                toastType
                            );
                        }
                    );
                } else {
                    // No new placeholders found, just save templates
                    chrome.storage.local.set({ templates }, () => {
                        loadTemplates();
                        // Clear any session for affected templates so imports show exact content
                        try {
                            list.forEach((t) => clearSessionForTemplate(t.name));
                        } catch (_) {}

                        // If the currently loaded template was updated, refresh the UI
                        if (currentTemplateUpdated && selectedTemplateName) {
                            const updatedTemplate = templates.find((t) => t.name === selectedTemplateName);
                            if (updatedTemplate) {
                                // Update the UI with the imported content
                                elements.templateName.value = updatedTemplate.name;
                                const tagsArray = Array.isArray(updatedTemplate.tags) ? updatedTemplate.tags : [];
                                elements.templateTags.value = tagsArray.join(", ");
                                tabsState.currentTemplate = updatedTemplate.content;
                                elements.promptArea.textContent = updatedTemplate.content;

                                // Clear placeholder values since this is imported content
                                tabsState.placeholderValues = {};

                                // Update existing tab placeholders and rebuild tabs
                                const { placeholders } = parsePlaceholders(updatedTemplate.content, false);
                                tabsState.existingTabPlaceholders = [...placeholders];
                                buildTabsFromTemplate(updatedTemplate.content, true);
                                renderPlaceholdersInTemplate();

                                // Update tags display
                                if (tagsArray.length > 0) {
                                    switchToTagsViewMode();
                                } else {
                                    switchToTagsEditMode();
                                }

                                saveState();
                            }
                        }
                        const skippedMessage =
                            skipped > 0 ? ` ${skipped} skipped — default templates can't be overwritten.` : "";
                        const newText = added === 0 ? "none new" : added === 1 ? "1 new" : `${added} new`;
                        const overwrittenText =
                            overwritten === 0
                                ? "none overwritten"
                                : overwritten === 1
                                ? "1 overwritten"
                                : `${overwritten} overwritten`;
                        const toastType = skipped > 0 ? "warning" : "info";
                        showToast(`Templates imported: ${newText}, ${overwrittenText}.${skippedMessage}`, 5000, toastType);
                    });
                }
            });
        } catch (err) {
            showToast(`Failed to import: ${err.message}`, 4000, "error");
        }
    };
    reader.readAsText(file);
    event.target.value = "";
    // Re-enable session save after this task queue
    setTimeout(() => {
        suppressSessionSave = false;
    }, 0);
}

function handleExportAll() {
    chrome.storage.local.get(["templates"], (result) => {
        const templates = result.templates || [];

        // Create clean template objects for export (exclude internal metadata)
        const exportTemplates = templates.map((t) => ({
            name: t.name,
            tags: Array.isArray(t.tags) ? t.tags : [],
            favorite: t.favorite || false,
            content: t.content,
        }));

        const yaml = jsyaml.dump(exportTemplates, {
            indent: 2,
            lineWidth: -1, // No line wrapping
            noRefs: true,
            sortKeys: false,
        });

        downloadFile(yaml, "promptstash_export_all.yaml", "text/yaml");
        showToast("All templates exported successfully.", 5000, "info", [], "exportAll");
    });
}

function handleExportSingle() {
    if (!selectedTemplateName) {
        showToast("No saved template selected to export.", 3000, "error", [], "exportSingle");
        return;
    }

    chrome.storage.local.get(["templates"], (result) => {
        const templates = result.templates || [];
        const template = templates.find((t) => t.name === selectedTemplateName);

        if (!template) {
            showToast("<strong>Template not found.</strong>", 3000, "error", [], "exportSingle");
            return;
        }

        // Create a clean template object for export
        const exportTemplate = {
            name: template.name,
            tags: Array.isArray(template.tags) ? template.tags : [],
            favorite: template.favorite || false,
            content: template.content,
        };

        const yamlString = jsyaml.dump([exportTemplate], {
            indent: 2,
            lineWidth: -1, // No line wrapping
            noRefs: true,
            sortKeys: false,
        });

        downloadFile(yamlString, `${template.name}.yaml`, "text/yaml");
        showToast(`Template '${template.name}' exported successfully.`, 5000, "success", [], "exportSingle");
    });
}

function handleGlobalClick(event) {
    if (
        !elements.searchBox.contains(event.target) &&
        !elements.dropdownResults.contains(event.target) &&
        !event.target.classList.contains("favorite-toggle")
    ) {
        elements.searchOverlay.style.display = "none";
        elements.dropdownResults.classList.remove("show");
    }
    if (event.target.classList.contains("favorite-toggle")) {
        const name = event.target.dataset.name;
        chrome.storage.local.get(["templates"], (result) => {
            const templates = result.templates || [];
            const template = templates.find((t) => t.name === name);
            if (template) {
                if (!template.favorite && templates.filter((t) => t.favorite).length >= 10) {
                    showToast("Maximum of 10 favorite templates allowed.", 3000, "warning", [], "favorite");
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
        // Close global search if it's open
        if (isGlobalSearchVisible) {
            hideGlobalSearch();
            return;
        }
        if (isToastShowing && elements.toast.className.includes("confirmation")) {
            const noButton = toastQueue[0].buttons.find((b) => b.text === "No");
            closeToast(noButton?.callback);
        } else {
            handleCloseWithUnsavedCheck();
        }
    } else if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === "f") {
        // Ctrl+Shift+F: Toggle global search
        event.preventDefault();
        toggleGlobalSearch();
        return;
    } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        const ae = document.activeElement;

        // While an undo-eligible toast is visible, UI-level undo takes precedence
        if (!event.shiftKey && isUndoToastVisible && lastState) {
            event.preventDefault();
            undoLastAction();
            return;
        }
        // Check if focus is in template name input field
        const inNameInput = ae === elements.templateName;
        if (inNameInput) {
            if (event.shiftKey) {
                // Ctrl+Shift+Z = Redo for template name
                if (nameRedoStack.length > 0) {
                    event.preventDefault();
                    nameRedo();
                    return;
                }
            } else {
                // Ctrl+Z = Undo for template name
                if (nameUndoStack.length > 0) {
                    event.preventDefault();
                    nameUndo();
                    return;
                }
            }
            // Focus is in name input but no history
            if (!event.shiftKey && isUndoToastVisible && lastState) {
                event.preventDefault();
                undoLastAction();
                return;
            }
            event.preventDefault();
            return;
        }

        // Check if focus is in tags input field
        const inTagsInput = ae === elements.templateTags;
        if (inTagsInput) {
            if (event.shiftKey) {
                // Ctrl+Shift+Z = Redo for tags
                if (tagsRedoStack.length > 0) {
                    event.preventDefault();
                    tagsRedo();
                    return;
                }
            } else {
                // Ctrl+Z = Undo for tags
                if (tagsUndoStack.length > 0) {
                    event.preventDefault();
                    tagsUndo();
                    return;
                }
            }
            // Focus is in tags input but no history
            if (!event.shiftKey && isUndoToastVisible && lastState) {
                event.preventDefault();
                undoLastAction();
                return;
            }
            event.preventDefault();
            return;
        }

        // If focus/cursor is inside the editor, route Ctrl+Z to the editor only
        const inEditor = ae === elements.promptArea;
        if (inEditor) {
            // If an undo-eligible toast is visible for the CURRENT template, prioritize UI-level undo
            if (!event.shiftKey && isUndoToastVisible && lastState && lastState.contextName === selectedTemplateName) {
                event.preventDefault();
                undoLastAction();
                return;
            }

            if (event.shiftKey) {
                // Ctrl+Shift+Z = Redo for editor
                if (editorRedoStack.length > 0) {
                    event.preventDefault();
                    editorRedo();
                    return;
                }
            } else {
                // Ctrl+Z = Undo for editor
                if (editorUndoStack.length > 0) {
                    event.preventDefault();
                    editorUndo();
                    return; // Handled by editor
                }
            }
            // No editor history and no UI undo to perform: keep focus and do nothing
            event.preventDefault();
            return;
        }

        // If not in our managed inputs and an undo-eligible toast belongs to current template, perform UI-level undo
        if (!event.shiftKey && isUndoToastVisible && lastState && lastState.contextName === selectedTemplateName) {
            event.preventDefault();
            undoLastAction();
            return;
        }

        // If active element is some other input/textarea/contenteditable, let the browser handle native undo
        const tag = ae && ae.tagName ? ae.tagName.toUpperCase() : "";
        if (ae && (tag === "INPUT" || tag === "TEXTAREA" || ae.isContentEditable)) {
            return; // allow native behavior
        }

        // If not in a supported input, do nothing for Ctrl+Z (no preventDefault)
        return;
    }
}

function closePopupAndClearState(clearState = false, options = {}) {
    const close = () =>
        chrome.runtime.sendMessage({ action: "closePopup", preservePosition: options.preservePosition === true });

    if (clearState) {
        chrome.storage.local.remove(["popupState", "placeholderValues"], close);
    } else {
        if (selectedTemplateName) {
            chrome.storage.local.get(["templates"], (result) => {
                const templates = result.templates || [];
                const currentTemplate = templates.find((t) => t.name === selectedTemplateName);
                if (currentTemplate && currentTemplate.type !== "pre-built") {
                    updateRecentIndices(currentTemplate.index);
                }
                saveState();
                close();
            });
        } else {
            saveState();
            close();
        }
    }
}

function undoLastAction() {
    if (!lastState) return;
    // Capture action type early so we can show the correct undo message
    const action = lastState.actionType || null;
    // If templates snapshot exists, restore it first (covers delete/save operations)
    const restoreUI = () => {
        elements.templateName.value = lastState.name || "";
        elements.templateTags.value = lastState.tags || "";
        selectedTemplateName = lastState.selectedName || null;
        originalTagsBeforeEdit = lastState.originalTags || null;

        // Restore content to editor
        const content = lastState.content || "";
        tabsState.currentTemplate = content;
        // Restore placeholder values so tabs reappear filled as before
        try {
            tabsState.placeholderValues = deepClone(lastState.placeholderValuesSnapshot || {});
        } catch (_) {
            tabsState.placeholderValues = lastState.placeholderValuesSnapshot || {};
        }
        elements.promptArea.textContent = content;
        destroyTabs();
        // For undo operations, restore the exact tabs that existed before
        const { placeholders: undoPlaceholders } = parsePlaceholders(content, false);
        tabsState.existingTabPlaceholders = [...undoPlaceholders];
        buildTabsFromTemplate(content, true);
        renderPlaceholdersInTemplate();
        // Ensure fetch hint and clear button reflect restored content
        elements.fetchBtn2.style.display = elements.promptArea.textContent.trim() ? "none" : "block";
        updateClearButtonState();

        // Reset editor undo/redo base snapshot to the restored content so Ctrl+Z doesn't jump to skeleton
        editorUndoStack = [];
        editorRedoStack = [];
        editorLastSnapshot = content || "";
        editorLastCaret = 0;

        // Restore tags edit/view mode
        if (lastState.isTagsInEditMode) {
            switchToTagsEditMode();
        } else {
            switchToTagsViewMode();
        }

        updateExportSingleBtnState();
        updateSaveButtonState();
        updateDeleteButtonState();
        saveState();
        loadTemplates();
        const msg =
            action === "clearPrompt"
                ? "Clear prompt undone."
                : action === "clearAll"
                ? "Clear all undone."
                : action === "saveUpdate"
                ? "Template update undone."
                : action === "saveNew"
                ? "Template save undone."
                : action === "saveAs"
                ? "Template save undone."
                : "Undone.";
        showToast(msg, 3000, "success", [], "undo");
        lastState = null;

        // Don't focus on any inputs after undo
        moveFocusOutOfEditor();
    };

    if (lastState.templates) {
        // Restore templates and recentIndices, then reload the restored template from storage to ensure full fidelity
        const payload = { templates: lastState.templates };
        if (lastState.recentIndicesSnapshot) payload.recentIndices = lastState.recentIndicesSnapshot;
        if (typeof lastState.nextIndexSnapshot === "number") payload.nextIndex = lastState.nextIndexSnapshot;

        chrome.storage.local.set(payload, () => {
            // Update global variables to match restored storage
            if (lastState.recentIndicesSnapshot) recentIndices = [...lastState.recentIndicesSnapshot];
            if (typeof lastState.nextIndexSnapshot === "number") nextIndex = lastState.nextIndexSnapshot;

            chrome.storage.local.get(["templates"], (result) => {
                const templates = result.templates || [];

                // For delete action, use the stored deleted template
                if (action === "delete" && lastState.deletedTemplate) {
                    updateRecentIndices(lastState.deletedTemplate.index);
                    loadTemplateFromSelection(lastState.deletedTemplate);
                } else if (action === "saveAs") {
                    // For Save As undo: softly restore pre-save UI (placeholders/tabs + values)
                    // without clearing editor undo/redo stacks
                    try {
                        isUpdatingContent = true;
                        // Restore inputs
                        elements.templateName.value = lastState.name || "";
                        elements.templateTags.value = lastState.tags || "";
                        selectedTemplateName = lastState.selectedName || null;
                        originalTagsBeforeEdit = lastState.originalTags || null;

                        // Restore content and placeholder values
                        const raw = lastState.rawTemplate || lastState.content || "";
                        tabsState.currentTemplate = raw;
                        try {
                            tabsState.placeholderValues = deepClone(lastState.placeholderValuesSnapshot || {});
                        } catch (_) {
                            tabsState.placeholderValues = lastState.placeholderValuesSnapshot || {};
                        }
                        elements.promptArea.textContent = raw;
                        destroyTabs();
                        // For redo operations, restore the exact tabs that existed
                        const { placeholders: redoPlaceholders } = parsePlaceholders(raw, false);
                        tabsState.existingTabPlaceholders = [...redoPlaceholders];
                        buildTabsFromTemplate(raw, true);
                        renderPlaceholdersInTemplate();
                        elements.fetchBtn2.style.display = elements.promptArea.textContent.trim() ? "none" : "block";
                        updateClearButtonState();

                        // Sync editor undo baseline to restored content (do not clear stacks)
                        try {
                            editorLastSnapshot = raw || "";
                            // keep editorUndoStack/editorRedoStack intact
                        } catch (_) {}

                        // Force a microtask refresh to ensure immediate UI update
                        setTimeout(() => {
                            // Re-render placeholders and tabs to be extra sure
                            try {
                                renderPlaceholdersInTemplate();
                            } catch (_) {}
                            // Run the same pipeline as user input to fully sync all dependent UI
                            try {
                                handlePromptInput();
                            } catch (_) {}
                        }, 0);

                        // Restore tags to appropriate mode based on content
                        if (elements.templateTags.value.trim()) {
                            switchToTagsViewMode();
                        } else {
                            switchToTagsEditMode();
                        }

                        updateExportSingleBtnState();
                        updateSaveButtonState();
                        updateDeleteButtonState();
                        saveState();
                        loadTemplates();

                        // Don't focus on any inputs after undo
                        moveFocusOutOfEditor();
                    } finally {
                        isUpdatingContent = false;
                    }
                } else if (action === "saveNew" || action === "saveUpdate") {
                    // For save/save as/update undo: only undo the storage action.
                    // Do NOT revert the current UI edits in promptArea, tabs, tags, or template name.
                    // Treat the current UI as an unsaved draft.
                    selectedTemplateName = null;
                    // Keep association with original template for validation
                    // For saveNew, keep the template name so save can detect it's missing and handle it
                    if (action === "saveNew") {
                        editingTargetName = elements.templateName.value || null;
                    } else {
                        editingTargetName = lastState.selectedName || editingTargetName || null;
                    }
                    updateExportSingleBtnState();
                    updateSaveButtonState();
                    updateDeleteButtonState();
                    // Keep tags in view mode if they have content, otherwise edit mode
                    if (elements.templateTags.value.trim()) {
                        switchToTagsViewMode();
                    } else {
                        switchToTagsEditMode();
                    }
                    // Revert allowed placeholders to the snapshot so newly added ones are removed
                    try {
                        const defaults = extractAllowedPlaceholdersFromDefaults();
                        // Replace ALLOWED_PLACEHOLDERS contents with snapshot
                        ALLOWED_PLACEHOLDERS.length = 0;
                        (lastState.allowedPlaceholdersSnapshot || defaults).forEach((ph) => ALLOWED_PLACEHOLDERS.push(ph));
                        // Recompute userPlaceholders as snapshot minus defaults
                        const snapshot = new Set(lastState.allowedPlaceholdersSnapshot || defaults);
                        const base = new Set(defaults);
                        const user = [...snapshot].filter((x) => !base.has(x));
                        chrome.storage.local.set({ userPlaceholders: user });
                    } catch (_) {}
                    // Rebuild tabs and rendering based on current content so unknown placeholders are plain text
                    try {
                        destroyTabs();
                        // For undo, preserve only existing tabs
                        buildTabsFromTemplate(tabsState.currentTemplate || elements.promptArea.textContent || "");
                        renderPlaceholdersInTemplate();
                    } catch (_) {}
                    // Persist current UI as-is; preserve name/tags undo stacks so Ctrl+Z works
                    saveState();

                    // Don't focus on any inputs after undo
                    moveFocusOutOfEditor();
                } else {
                    const tmpl = templates.find((t) => t.name === lastState.selectedName);
                    if (tmpl) {
                        updateRecentIndices(tmpl.index);
                        loadTemplateFromSelection(tmpl);
                    } else {
                        restoreUI();
                    }
                }

                // Keep current focus unchanged during undo
                loadTemplates();

                const msg =
                    action === "delete"
                        ? "Deletion undone."
                        : action === "saveUpdate"
                        ? "Template update undone."
                        : action === "saveNew"
                        ? "Template save undone."
                        : action === "saveAs"
                        ? "Template save undone."
                        : "Undone.";
                showToast(msg, 3000, "success", [], "undo");
                lastState = null;

                // Don't focus on any inputs after undo
                moveFocusOutOfEditor();
            });
        });
    } else {
        restoreUI();
    }
}

function handlePromptInput() {
    if (isUpdatingContent) return;

    // Compute cursor position within the editor's plain text
    let cursorOffset = getEditorCaretOffset();

    const templateContent = getContentWithPlaceholders();
    // Push snapshot to undo stack only on user edits
    if (templateContent !== editorLastSnapshot) {
        editorUndoStack.push({ content: editorLastSnapshot, caret: editorLastCaret });
        // Limit history length to avoid memory bloat
        if (editorUndoStack.length > 100) editorUndoStack.shift();
        editorLastSnapshot = templateContent;
        editorLastCaret = cursorOffset;
        editorRedoStack = [];
    }
    tabsState.currentTemplate = templateContent;

    // If the user is typing inside an unclosed token like "{{...",
    // skip re-rendering placeholders to prevent flicker and brace changes.
    if (isTypingInUnclosedToken(templateContent, cursorOffset)) {
        console.log(
            "Skipping re-render - typing in unclosed token:",
            templateContent.slice(Math.max(0, cursorOffset - 10), cursorOffset + 10)
        );
        elements.fetchBtn2.style.display = elements.promptArea.textContent.trim() ? "none" : "block";
        saveState();
        return;
    }

    buildTabsFromTemplate(templateContent); // Use existing tabs only during regular input

    elements.fetchBtn2.style.display = elements.promptArea.textContent.trim() ? "none" : "block";

    saveState();
}

function insertLineBreak() {
    const selection = window.getSelection();

    // Ensure there's a valid caret range inside the editor when focusing at the end
    if (!selection || selection.rangeCount === 0 || !elements.promptArea.contains(selection.anchorNode)) {
        const rangeInit = document.createRange();
        let lastNode = elements.promptArea.lastChild;
        if (!lastNode || lastNode.nodeType !== Node.TEXT_NODE) {
            lastNode = document.createTextNode("");
            elements.promptArea.appendChild(lastNode);
        }
        rangeInit.setStart(lastNode, lastNode.textContent.length);
        rangeInit.collapse(true);
        selection.removeAllRanges();
        selection.addRange(rangeInit);
    }

    // If caret is inside a placeholder, move it to after the placeholder element
    try {
        const focusNode = selection.focusNode;
        const placeholderRoot =
            focusNode && (focusNode.nodeType === Node.ELEMENT_NODE ? focusNode : focusNode.parentElement)
                ? (focusNode.nodeType === Node.ELEMENT_NODE ? focusNode : focusNode.parentElement).closest(
                      ".placeholder-marker, .placeholder-value"
                  )
                : null;
        if (placeholderRoot) {
            const afterRange = document.createRange();
            afterRange.setStartAfter(placeholderRoot);
            afterRange.collapse(true);
            selection.removeAllRanges();
            selection.addRange(afterRange);
        }
    } catch (_) {}

    const range = selection.getRangeAt(0);

    // Insert newline and a zero-width space to ensure caret has a visible position on the new line
    const newlineNode = document.createTextNode("\n");
    range.insertNode(newlineNode);
    const zwspNode = document.createTextNode("\u200B");
    range.setStartAfter(newlineNode);
    range.collapse(true);
    range.insertNode(zwspNode);

    // Move cursor after the ZWSP on the new line
    range.setStartAfter(zwspNode);
    range.setEndAfter(zwspNode);
    selection.removeAllRanges();
    selection.addRange(range);

    // Trigger input pipeline so tabs/preview update consistently
    try {
        elements.promptArea.dispatchEvent(new InputEvent("input", { bubbles: true }));
    } catch (_) {}

    scrollToCursor();

    // After any potential re-render, restore caret to the computed offset
    try {
        const sel2 = window.getSelection();
        if (sel2 && sel2.rangeCount) {
            const r = sel2.getRangeAt(0);
            const caretOffset = getCharOffset(elements.promptArea, r.startContainer, r.startOffset);
            setTimeout(() => {
                try {
                    setEditorCaretOffset(caretOffset);
                } catch (_) {}
            }, 0);
        }
    } catch (_) {}
}

function insertSpaces(count) {
    const selection = window.getSelection();
    if (selection.rangeCount === 0) return;

    const range = selection.getRangeAt(0);

    // Use regular spaces - they'll be preserved by CSS white-space: pre-wrap
    const spaces = " ".repeat(count);
    const textNode = document.createTextNode(spaces);
    range.insertNode(textNode);

    // Move cursor after the spaces
    range.setStartAfter(textNode);
    range.setEndAfter(textNode);
    selection.removeAllRanges();
    selection.addRange(range);

    scrollToCursor();
    // preserveFormatting() was called but not defined - removing for now
    // If formatting preservation is needed, implement the function
}

function scrollToCursor() {
    const selection = window.getSelection();
    if (selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        let rect = range.getBoundingClientRect();

        // If the caret rect is empty (common at line ends/newlines), use a temporary marker
        if (!rect || (!rect.height && !rect.width)) {
            const marker = document.createElement("span");
            marker.textContent = "\u200B"; // zero-width space
            marker.style.display = "inline-block";
            marker.style.width = "0px";
            marker.style.height = "1em";

            const cloned = range.cloneRange();
            cloned.collapse(true);
            cloned.insertNode(marker);
            rect = marker.getBoundingClientRect();

            // Restore caret after marker and remove marker
            const after = document.createRange();
            after.setStartAfter(marker);
            after.collapse(true);
            selection.removeAllRanges();
            selection.addRange(after);
            marker.remove();
        }

        const editorRect = elements.promptArea.getBoundingClientRect();

        // Scroll down if caret goes below the visible area
        if (rect.bottom > editorRect.bottom) {
            elements.promptArea.scrollTop += rect.bottom - editorRect.bottom + 10;
        }
        // Also scroll up if caret goes above the visible area
        if (rect.top < editorRect.top) {
            elements.promptArea.scrollTop -= editorRect.top - rect.top + 10;
        }
    }
}

// Ensure caret is not trapped inside trailing placeholder; move to a valid text position
function normalizeCaretAtEnd() {
    try {
        const sel = window.getSelection();
        if (!sel || sel.rangeCount === 0) return;
        const range = sel.getRangeAt(0);
        const isCollapsed = range.collapsed;
        if (!isCollapsed) return;

        // Only move caret if it's actually INSIDE a placeholder element
        const focusNode = sel.focusNode;
        const element = focusNode && (focusNode.nodeType === Node.TEXT_NODE ? focusNode.parentElement : focusNode);
        const placeholder = element && element.closest ? element.closest(".placeholder-marker, .placeholder-value") : null;

        // Check if the caret is actually inside the placeholder text, not just adjacent to it
        if (placeholder) {
            const placeholderRange = document.createRange();
            placeholderRange.selectNodeContents(placeholder);
            const isInsidePlaceholder =
                range.compareBoundaryPoints(Range.START_TO_START, placeholderRange) >= 0 &&
                range.compareBoundaryPoints(Range.START_TO_END, placeholderRange) <= 0;

            if (isInsidePlaceholder) {
                const after = document.createRange();
                after.setStartAfter(placeholder);
                after.collapse(true);
                sel.removeAllRanges();
                sel.addRange(after);
            }
        }

        // Only ensure text node at end if we're actually at the very end
        const endOffset = elements.promptArea.textContent.length;
        const currentOffset = getCharOffset(elements.promptArea, sel.anchorNode, sel.anchorOffset);
        if (currentOffset >= endOffset) {
            let last = elements.promptArea.lastChild;
            if (!last || last.nodeType !== Node.TEXT_NODE) {
                last = document.createTextNode("");
                elements.promptArea.appendChild(last);
            }
            const { node, offset } = findTextNodeAndOffset(elements.promptArea, endOffset);
            const r = document.createRange();
            r.setStart(node, offset);
            r.collapse(true);
            sel.removeAllRanges();
            sel.addRange(r);
        }
    } catch (_) {}
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
            const lineStart = fullText.lastIndexOf("\n", cursorOffset - 1) + 1;
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
            document.execCommand("insertText", false, "    ");
        }
        return;
    }

    // Case 2: Multiline selection.
    event.preventDefault();
    const startOffset = getCharOffset(elements.promptArea, range.startContainer, range.startOffset);
    const endOffset = getCharOffset(elements.promptArea, range.endContainer, range.endOffset);

    const fullText = elements.promptArea.textContent;
    const startOfLine = fullText.lastIndexOf("\n", startOffset - 1) + 1;
    const endOfLine = fullText.indexOf("\n", endOffset) === -1 ? fullText.length : fullText.indexOf("\n", endOffset);

    const beforeText = fullText.substring(0, startOfLine);
    const affectedText = fullText.substring(startOfLine, endOfLine);
    const afterText = fullText.substring(endOfLine);

    const lines = affectedText.split("\n");
    let processedLines = [];

    if (event.shiftKey) {
        // Un-indent
        processedLines = lines.map((line) => {
            const leadingSpaces = line.match(/^ {1,4}/);
            return leadingSpaces ? line.substring(leadingSpaces[0].length) : line;
        });
    } else {
        // Indent
        processedLines = lines.map((line) => "    " + line);
    }

    const processedText = processedLines.join("\n");
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
    let lineStart = text.lastIndexOf("\n", cursorOffset - 1) + 1;

    // Check if line starts with spaces/non-breaking spaces
    let spacesToRemove = 0;
    for (let i = lineStart; i < Math.min(lineStart + 4, text.length); i++) {
        if (text[i] === " " || text[i] === "\u00A0") {
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
        handleTabKey(event);
        return;
    }

    // Handle Enter key for line breaks
    console.log("4651");
    if (event.key === "Enter") {
        event.preventDefault();
        // Ensure editor has focus and a proper caret before inserting newline
        if (document.activeElement !== elements.promptArea) {
            try {
                elements.promptArea.focus();
            } catch (_) {}
        }
        // If selection is missing, restore to last known caret
        try {
            const sel = window.getSelection();
            if (!sel || sel.rangeCount === 0) {
                setEditorCaretOffset(getEditorCaretOffset());
            }
        } catch (_) {}
        insertLineBreak();
        return;
    }

    // Only handle placeholder switching if the caret is actually INSIDE a placeholder
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
        const range = sel.getRangeAt(0);
        const focusNode = sel.focusNode;
        const element = focusNode && (focusNode.nodeType === Node.TEXT_NODE ? focusNode.parentElement : focusNode);
        const placeholderElement = element && element.closest ? element.closest(".placeholder-marker") : null;

        if (placeholderElement) {
            // Check if the caret is actually inside the placeholder text, not just adjacent to it
            const placeholderRange = document.createRange();
            placeholderRange.selectNodeContents(placeholderElement);
            const isInsidePlaceholder =
                range.compareBoundaryPoints(Range.START_TO_START, placeholderRange) >= 0 &&
                range.compareBoundaryPoints(Range.START_TO_END, placeholderRange) <= 0;

            if (isInsidePlaceholder) {
                event.preventDefault();
                switchToPlaceholderTab(placeholderElement.getAttribute("data-type"));
            }
        }
    }
}

function handlePaste(event) {
    if (isWithinPlaceholder(window.getSelection().focusNode)) {
        event.preventDefault();
        return;
    }

    // Get plain text from clipboard and normalize it for the editor
    event.preventDefault();
    let text = event.clipboardData.getData("text/plain") || "";
    // Normalize newlines to \n and tabs to 4 spaces to preserve alignment
    text = text.replace(/\r\n?|\u2028|\u2029/g, "\n").replace(/\t/g, "    ");

    const selection = window.getSelection();
    if (selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        // Replace selection with the normalized text
        range.deleteContents();
        const textNode = document.createTextNode(text);
        range.insertNode(textNode);

        // Move cursor after inserted text
        range.setStartAfter(textNode);
        range.setEndAfter(textNode);
        selection.removeAllRanges();
        selection.addRange(range);
    }

    // Defer to allow DOM to update, then process placeholders/render
    setTimeout(() => {
        const content = elements.promptArea.textContent || "";
        const sanitizedContent = sanitizeTemplateInput(content);
        if (sanitizedContent !== content) {
            elements.promptArea.textContent = sanitizedContent;
            showToast("Pasted content had invalid placeholders.", 3000, "warning", [], "paste-restriction");
        }
        handlePromptInput();
    }, 0);
}

async function handleCloseWithUnsavedCheck() {
    const unsaved = await hasUnsavedChanges();
    if (unsaved) {
        // When user explicitly clicks X, show warning but KEEP unsaved changes in session
        showModal(
            "You have unsaved changes. Confirm closing without saving.",
            [
                { text: "Cancel", callback: () => {} },
                {
                    text: "Close Without Saving",
                    callback: () => {
                        // Don't clear session data - just mark that we closed with X
                        // This will show new template on reopen but keep the unsaved changes
                        chrome.storage.session.set({ closedWithX: true });
                        closePopupAndClearState(true); // Clear localStorage state to show new template
                    },
                },
            ],
            "warning"
        );
    } else {
        // Even without unsaved changes, mark that we closed with X to show new template
        chrome.storage.session.set({ closedWithX: true });
        closePopupAndClearState(true);
    }
}

// --- Helper Functions for Code Reuse ---

function getContentWithPlaceholders() {
    const tempDiv = document.createElement("div");
    tempDiv.innerHTML = elements.promptArea.innerHTML;

    // Normalize HTML line breaks into actual newline characters
    tempDiv.querySelectorAll("br").forEach((br) => br.replaceWith(document.createTextNode("\n")));
    tempDiv.querySelectorAll("div, p").forEach((el) => {
        // ensure block separation contributes a newline in text output
        if (!el.lastChild || el.lastChild.nodeType !== Node.TEXT_NODE || !/\n$/.test(el.lastChild.textContent)) {
            el.appendChild(document.createTextNode("\n"));
        }
    });

    tempDiv.querySelectorAll(".placeholder-marker").forEach((span) => {
        const placeholderType = span.getAttribute("data-type");
        if (placeholderType) {
            const textNode = document.createTextNode(`{{${placeholderType}}}`);
            span.parentNode.replaceChild(textNode, span);
        }
    });
    return tempDiv.textContent;
}

// Detect if the cursor is currently inside an unclosed "{{ ..." token
function isTypingInUnclosedToken(content, cursorOffset) {
    try {
        const upto = content.slice(0, Math.max(0, cursorOffset));
        const opens = (upto.match(/\{\{/g) || []).length;
        const closes = (upto.match(/\}\}/g) || []).length;
        const result = opens > closes;
        console.log("isTypingInUnclosedToken:", { content: upto, opens, closes, result, cursorOffset });
        return result; // more opens than closes means within an unclosed token
    } catch (_) {
        return false;
    }
}

function isWithinPlaceholder(node) {
    // Ensure we have an element node, not a text node
    // Text nodes don't have the closest() method
    if (!node) return false;

    // If it's a text node, get its parent element
    const element = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;

    // Now safely use closest() on the element
    return element && (element.closest(".placeholder-marker") || element.closest(".placeholder-value"));
}

function sanitizeTemplateInput(content) {
    // Do NOT strip unknown placeholders anymore; keep them as literal text until save.
    // We simply return content unchanged here to avoid altering user-typed tokens.
    return content;
}

function saveNextIndex() {
    chrome.storage.local.set({ nextIndex });
}

function initializeTooltips() {
    document.querySelectorAll('[data-bs-toggle="tooltip"]').forEach((el) => new bootstrap.Tooltip(el));
}

// Ensures subsequent Ctrl+Z targets UI undo, not the editor's contenteditable
function moveFocusOutOfEditor() {
    try {
        const sel = window.getSelection();
        if (sel && sel.rangeCount && elements.promptArea && elements.promptArea.contains(sel.anchorNode)) {
            sel.removeAllRanges();
        }
        // Blur all input fields
        if (elements.promptArea && elements.promptArea.blur) elements.promptArea.blur();
        if (elements.templateName && elements.templateName.blur) elements.templateName.blur();
        if (elements.templateTags && elements.templateTags.blur) elements.templateTags.blur();

        // Focus on a button instead
        if (elements.saveBtn && elements.saveBtn.focus) {
            elements.saveBtn.focus();
        } else if (document && document.body && document.body.focus) {
            document.body.focus();
        }
    } catch (_) {}
}

// --- Contenteditable Editor Undo/Redo Helpers ---
function editorUndo() {
    if (!editorUndoStack.length) return;
    const prev = editorUndoStack.pop();
    const prevContent = typeof prev === "string" ? prev : prev.content || "";
    const prevCaret = typeof prev === "string" ? 0 : prev.caret ?? 0;
    const currentCaret = getEditorCaretOffset();
    const current = editorLastSnapshot;
    editorRedoStack.push({ content: current, caret: currentCaret });
    editorLastSnapshot = prevContent;
    editorLastCaret = prevCaret;
    tabsState.currentTemplate = prevContent;
    elements.promptArea.textContent = prevContent;
    destroyTabs();
    // For editor undo, preserve the tabs that existed at that point
    const { placeholders: prevPlaceholders } = parsePlaceholders(prevContent, false);
    tabsState.existingTabPlaceholders = [...prevPlaceholders];
    buildTabsFromTemplate(prevContent, true);
    renderPlaceholdersInTemplate();
    // Update fetch hint / clear button based on content
    elements.fetchBtn2.style.display = elements.promptArea.textContent.trim() ? "none" : "block";
    updateClearButtonState();
    setEditorCaretOffset(prevCaret);
    saveState();
}

function editorRedo() {
    if (!editorRedoStack.length) return;
    const next = editorRedoStack.pop();
    const nextContent = typeof next === "string" ? next : next.content || "";
    const nextCaret = typeof next === "string" ? 0 : next.caret ?? 0;
    const currentCaret = getEditorCaretOffset();
    editorUndoStack.push({ content: editorLastSnapshot, caret: currentCaret });
    editorLastSnapshot = nextContent;
    editorLastCaret = nextCaret;
    tabsState.currentTemplate = nextContent;
    elements.promptArea.textContent = nextContent;
    destroyTabs();
    // For editor redo, preserve the tabs that existed at that point
    const { placeholders: nextPlaceholders } = parsePlaceholders(nextContent, false);
    tabsState.existingTabPlaceholders = [...nextPlaceholders];
    buildTabsFromTemplate(nextContent, true);
    renderPlaceholdersInTemplate();
    elements.fetchBtn2.style.display = elements.promptArea.textContent.trim() ? "none" : "block"; // Update fetch hint
    updateClearButtonState();
    setEditorCaretOffset(nextCaret);
    saveState();
}

// Get caret offset within the contenteditable by counting characters from start
function getEditorCaretOffset() {
    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0) {
        try {
            const range = selection.getRangeAt(0);
            const preCaretRange = range.cloneRange();
            preCaretRange.selectNodeContents(elements.promptArea);
            preCaretRange.setEnd(range.endContainer, range.endOffset);
            return preCaretRange.toString().length;
        } catch (e) {
            return editorLastCaret || 0;
        }
    }
    return editorLastCaret || 0;
}

// Restore caret to a character offset inside the contenteditable
function setEditorCaretOffset(offset) {
    try {
        const len = elements.promptArea.textContent.length;
        const safeOffset = Math.max(0, Math.min(offset || 0, len));
        const { node, offset: nodeOffset } = findTextNodeAndOffset(elements.promptArea, safeOffset);
        const range = document.createRange();
        const sel = window.getSelection();
        range.setStart(node, nodeOffset);
        range.setEnd(node, nodeOffset);
        sel.removeAllRanges();
        sel.addRange(range);
        elements.promptArea.focus();
    } catch (_) {
        /* ignore cursor errors */
    }
}
