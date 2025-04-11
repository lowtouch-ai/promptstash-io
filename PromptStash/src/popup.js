// Default templates for initial setup
const defaultTemplates = [
  {
    name: "Business Analyst Report",
    tags: "analysis, report, business",
    type: "pre-built",
    content: 
`# Your Role
Business Analyst

# Your Task
Analyze the provided data and generate a concise report.

# Relevant Background Information
Use formal tone, focus on key metrics.

# Output Format
Executive summary (200 words), followed by bullet points.`
  },
  {
    name: "Code Debugging Assistant",
    tags: "coding, debug, tech",
    type: "pre-built",
    content: 
`# Your Role
Senior Developer

# Your Task
Identify and fix bugs in the provided code snippet.

# Relevant Background Information
Code is in Python, prioritize efficiency.

# Output Format
Explanation of issue, corrected code block.`
  },
  {
    name: "Content Generator",
    tags: "marketing, content, quick",
    type: "pre-built",
    content:
`# Your Role
Content Writer

# Your Task
Write a 500-word blog post on the given topic.

# Relevant Background Information
Casual tone, SEO-friendly.

# Output Format
Title, intro, 3 sections, conclusion.`
  }
];

// DOM initialization
document.addEventListener("DOMContentLoaded", () => {
  // DOM elements
  const searchBox = document.getElementById("searchBox");
  const typeSelect = document.getElementById("typeSelect");
  const dropdownResults = document.getElementById("dropdownResults");
  const templateName = document.getElementById("templateName");
  const templateTags = document.getElementById("templateTags");
  const promptArea = document.getElementById("promptArea");
  const fetchBtn = document.getElementById("fetchBtn");
  const saveBtn = document.getElementById("saveBtn");
  const saveAsBtn = document.getElementById("saveAsBtn");
  const deleteBtn = document.getElementById("deleteBtn");
  const clearBtn = document.getElementById("clearBtn");
  const sendBtn = document.getElementById("sendBtn");

  let selectedTemplateName = null; // Track selected template by name

  // Load sidebar state from storage
  chrome.storage.local.get(["sidebarState"], (result) => {
    const state = result.sidebarState || {};
    templateName.value = state.name || "";
    templateTags.value = state.tags || "";
    promptArea.value = state.content || "";
    selectedTemplateName = state.selectedName || null;
  });

  // Save sidebar state to storage
  function saveState() {
    chrome.storage.local.set({
      sidebarState: {
        name: templateName.value,
        tags: templateTags.value,
        content: promptArea.value,
        selectedName: selectedTemplateName
      }
    });
  }

  // Add input listeners to save state
  [templateName, templateTags, promptArea].forEach(el => {
    el.addEventListener("input", saveState);
  });

  // Load and filter templates into dropdown
  function loadTemplates(filter, query = "") {
    chrome.storage.sync.get(["templates"], (result) => {
      const templates = result.templates || defaultTemplates;
      dropdownResults.innerHTML = "";
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

      filteredTemplates.forEach((tmpl) => {
        const div = document.createElement("div");
        div.textContent = `${tmpl.name} (${tmpl.tags})`;
        div.addEventListener("click", () => {
          selectedTemplateName = tmpl.name;
          templateName.value = tmpl.name;
          templateTags.value = tmpl.tags;
          promptArea.value = tmpl.content;
          searchBox.value = tmpl.name;
          dropdownResults.innerHTML = "";
          saveState();
        });
        dropdownResults.appendChild(div);
      });
    });
  }

  // Show dropdown on search box click
  searchBox.addEventListener("click", (event) => {
    event.stopPropagation();
    const query = searchBox.value.toLowerCase();
    loadTemplates(typeSelect.value, query);
  });

  // Search as user types
  searchBox.addEventListener("input", () => {
    const query = searchBox.value.toLowerCase();
    loadTemplates(typeSelect.value, query);
  });

  // Filter by type
  typeSelect.addEventListener("change", () => {
    loadTemplates(typeSelect.value, searchBox.value.toLowerCase());
  });

  // Close dropdown when clicking outside
  document.addEventListener("click", (event) => {
    if (!searchBox.contains(event.target) && !dropdownResults.contains(event.target)) {
      dropdownResults.innerHTML = "";
    }
  });

  // Save changes to existing template
  saveBtn.addEventListener("click", () => {
    if (!selectedTemplateName) {
      alert("Please select a template to save changes.");
      return;
    }
    const confirmSave = confirm("Are you sure you want to overwrite the existing template?");
    if (!confirmSave) return;

    chrome.storage.sync.get(["templates"], (result) => {
      const templates = result.templates || defaultTemplates;
      const templateIndex = templates.findIndex(t => t.name === selectedTemplateName);
      if (templateIndex !== -1) {
        templates[templateIndex] = {
          name: templateName.value,
          tags: templateTags.value,
          content: promptArea.value,
          type: templates[templateIndex].type || "custom"
        };
        chrome.storage.sync.set({ templates }, () => {
          alert("Template saved successfully.");
          loadTemplates(typeSelect.value);
          saveState();
        });
      } else {
        alert("Selected template not found.");
      }
    });
  });

  // Save as new template
  saveAsBtn.addEventListener("click", () => {
    let name = templateName.value.trim();
    let tags = templateTags.value.trim();

    if (!name || !tags) {
      if (!name) name = prompt("Please provide a template name:");
      if (!tags) tags = prompt("Please provide tags (comma-separated):") || "";
      if (!name) return;
      templateName.value = name;
      templateTags.value = tags;
    }

    chrome.storage.sync.get(["templates"], (result) => {
      const templates = result.templates || defaultTemplates;
      if (templates.some(tmpl => tmpl.name === name)) {
        name = prompt("Template name already exists. Please provide a new name:");
        if (!name) return;
        templateName.value = name;
      }

      const confirmSave = confirm(`Save as new template "${name}"?`);
      if (!confirmSave) return;

      templates.push({
        name,
        tags,
        content: promptArea.value,
        type: "custom"
      });
      chrome.storage.sync.set({ templates }, () => {
        alert("Template saved successfully.");
        loadTemplates(typeSelect.value);
        saveState();
      });
    });
  });

  // Fetch prompt from website
  fetchBtn.addEventListener("click", () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      chrome.tabs.sendMessage(tabs[0].id, { action: "getPrompt" }, (response) => {
        if (response && response.prompt) {
          promptArea.value = response.prompt;
          saveState();
        }
      });
    });
  });

  // Send prompt to website and close sidebar
  sendBtn.addEventListener("click", () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      chrome.tabs.sendMessage(tabs[0].id, {
        action: "sendPrompt",
        prompt: promptArea.value
      }, () => {
        // Close sidebar by messaging the parent window
        window.parent.postMessage({ action: "closeSidebar" }, "*");
      });
    });
  });

  // Delete selected template
  deleteBtn.addEventListener("click", () => {
    if (!selectedTemplateName) {
      alert("Please select a template to delete.");
      return;
    }
    const confirmDelete = confirm("Are you sure you want to delete this template?");
    if (!confirmDelete) return;

    chrome.storage.sync.get(["templates"], (result) => {
      const templates = result.templates || defaultTemplates;
      const templateIndex = templates.findIndex(t => t.name === selectedTemplateName);
      if (templateIndex !== -1) {
        templates.splice(templateIndex, 1);
        chrome.storage.sync.set({ templates }, () => {
          alert("Template deleted successfully.");
          selectedTemplateName = null;
          templateName.value = "";
          templateTags.value = "";
          promptArea.value = "";
          searchBox.value = "";
          loadTemplates(typeSelect.value);
          saveState();
        });
      } else {
        alert("Selected template not found.");
      }
    });
  });

  // Clear prompt area
  clearBtn.addEventListener("click", () => {
    promptArea.value = "";
    saveState();
  });

  // Initialize Bootstrap tooltips
  const tooltipTriggerList = document.querySelectorAll('[data-bs-toggle="tooltip"]');
  const tooltipList = [...tooltipTriggerList].map(tooltipTriggerEl => new bootstrap.Tooltip(tooltipTriggerEl, {
    delay: { show: 500, hide: 100 }
  }));
});