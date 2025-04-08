const defaultTemplates = [
  {
    name: "Business Analyst Report",
    tags: "analysis, report, business",
    type: "pre-built",
    content: `# Your Role\nBusiness Analyst\n\n# Your Task\nAnalyze the provided data and generate a concise report.\n\n# Relevant Background Information\nUse formal tone, focus on key metrics.\n\n# Output Format\nExecutive summary (200 words), followed by bullet points.`
  },
  {
    name: "Code Debugging Assistant",
    tags: "coding, debug, tech",
    type: "pre-built",
    content: `# Your Role\nSenior Developer\n\n# Your Task\nIdentify and fix bugs in the provided code snippet.\n\n# Relevant Background Information\nCode is in Python, prioritize efficiency.\n\n# Output Format\nExplanation of issue, corrected code block.`
  },
  {
    name: "Content Generator",
    tags: "marketing, content, quick",
    type: "pre-built",
    content: `# Your Role\nContent Writer\n\n# Your Task\nWrite a 500-word blog post on the given topic.\n\n# Relevant Background Information\nCasual tone, SEO-friendly.\n\n# Output Format\nTitle, intro, 3 sections, conclusion.`
  }
];

// DOM elements
document.addEventListener("DOMContentLoaded", () => {
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

  let selectedTemplateIndex = null;

  // Load templates into the search dropdown
  function loadTemplates(filter, query = "") {
    chrome.storage.sync.get(["templates"], (result) => {
      const templates = result.templates || defaultTemplates;
      dropdownResults.innerHTML = "";
      let filteredTemplates = templates.filter(tmpl => filter === "all" || tmpl.type === filter);

      // Filter by query if provided
      if (query) {
        filteredTemplates = filteredTemplates.filter(t =>
          t.name.toLowerCase().includes(query) || t.tags.toLowerCase().includes(query)
        );
        // Sort by position of query in name/tags, then alphabetically
        filteredTemplates.sort((a, b) => {
          const aMatch = a.name.toLowerCase().indexOf(query) + a.tags.toLowerCase().indexOf(query);
          const bMatch = b.name.toLowerCase().indexOf(query) + b.tags.toLowerCase().indexOf(query);
          if (aMatch !== bMatch) return aMatch - bMatch;
          return a.name.localeCompare(b.name);
        });
      }

      filteredTemplates.forEach((tmpl, index) => {
        const div = document.createElement("div");
        div.textContent = `${tmpl.name} (${tmpl.tags})`;
        div.addEventListener("click", () => {
          selectedTemplateIndex = templates.indexOf(tmpl);
          templateName.value = tmpl.name;
          templateTags.value = tmpl.tags;
          promptArea.value = tmpl.content;
          searchBox.value = tmpl.name;
          dropdownResults.innerHTML = "";
        });
        dropdownResults.appendChild(div);
      });
    });
  }

  // Show dropdown when search box is clicked, even if not empty
  searchBox.addEventListener("click", () => {
    const query = searchBox.value.toLowerCase();
    loadTemplates(typeSelect.value, query);
  });

  // Search as user types
  searchBox.addEventListener("input", () => {
    const query = searchBox.value.toLowerCase();
    loadTemplates(typeSelect.value, query);
  });

  // Filter templates by type
  typeSelect.addEventListener("change", () => {
    loadTemplates(typeSelect.value, searchBox.value.toLowerCase());
  });

  // Close dropdown when clicking outside
  document.addEventListener("click", (event) => {
    if (!searchBox.contains(event.target) && !dropdownResults.contains(event.target)) {
      dropdownResults.innerHTML = "";
    }
  });

  // // Auto-add commas to tags and handle "Tags: " prefix
  // templateTags.addEventListener("input", () => {
  //   let value = templateTags.value.replace(/,\s*/g, ", ");
  //   if (value.endsWith(", ")) value = value.slice(0, -2);
  //   templateTags.value = value;
  // });

  // Save changes to existing template
  saveBtn.addEventListener("click", () => {
    if (selectedTemplateIndex === null) {
      alert("Please select a template to save changes.");
      return;
    }
    const confirmSave = confirm("Are you sure you want to overwrite the existing template?");
    if (!confirmSave) return;

    chrome.storage.sync.get(["templates"], (result) => {
      const templates = result.templates || defaultTemplates;
      templates[selectedTemplateIndex] = {
        name: templateName.value,
        tags: templateTags.value,
        content: promptArea.value,
        type: templates[selectedTemplateIndex].type || "custom"
      };
      chrome.storage.sync.set({ templates }, () => {
        alert("Template saved successfully.");
        loadTemplates(typeSelect.value);
      });
    });
  });

  // Save as new template
  saveAsBtn.addEventListener("click", () => {
    let name = templateName.value.trim();
    let tags = templateTags.value.trim();

    // Check for missing name or tags
    if (!name || !tags) {
      if (!name) name = prompt("Please provide a template name:");
      if (!tags) tags = prompt("Please provide tags (comma-separated):") || "";
      if (!name) return; // Cancel if no name provided
      templateName.value = name;
      templateTags.value = tags;
    }

    // Check for duplicate name
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
      });
    });
  });

  // Fetch prompt from website
  fetchBtn.addEventListener("click", () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      chrome.tabs.sendMessage(tabs[0].id, { action: "getPrompt" }, (response) => {
        if (response && response.prompt) {
          promptArea.value = response.prompt;
        }
      });
    });
  });

  // Send prompt to website
  sendBtn.addEventListener("click", () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      chrome.tabs.sendMessage(tabs[0].id, {
        action: "sendPrompt",
        prompt: promptArea.value
      });
    });
  });

  // Delete selected template
  deleteBtn.addEventListener("click", () => {
    if (selectedTemplateIndex === null) {
      alert("Please select a template to delete.");
      return;
    }
    const confirmDelete = confirm("Are you sure you want to delete this template?");
    if (!confirmDelete) return;

    chrome.storage.sync.get(["templates"], (result) => {
      const templates = result.templates || defaultTemplates;
      templates.splice(selectedTemplateIndex, 1);
      chrome.storage.sync.set({ templates }, () => {
        alert("Template deleted successfully.");
        selectedTemplateIndex = null;
        templateName.value = "";
        templateTags.value = "";
        promptArea.value = "";
        searchBox.value = "";
        loadTemplates(typeSelect.value);
      });
    });
  });

  // Clear prompt area
  clearBtn.addEventListener("click", () => {
    promptArea.value = "";
  });

  // Initialize Bootstrap tooltips
  const tooltipTriggerList = document.querySelectorAll('[data-bs-toggle="tooltip"]');
  const tooltipList = [...tooltipTriggerList].map(tooltipTriggerEl => new bootstrap.Tooltip(tooltipTriggerEl, {
    delay: { show: 500, hide: 100 }
  }));
});