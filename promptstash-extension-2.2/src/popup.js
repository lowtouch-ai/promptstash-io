const defaultTemplates = [
  {
    name: "Business Analyst Report",
    tags: "analysis, report, business",
    content:`Your Role: Business Analyst
Your Task: Analyze the provided data and generate a concise report.
Relevant Background Information: Use formal tone, focus on key metrics.
Output Format: Executive summary (200 words), followed by bullet points.`,
    type: "pre-built"
  },
  {
    name: "Code Debugging Assistant",
    tags: "coding, debug, tech",
    content: `Your Role: Senior Developer
Your Task: Identify and fix bugs in the provided code snippet.
Relevant Background Information: Code is in Python, prioritize efficiency.
Output Format: Explanation of issue, corrected code block.`,
    type: "pre-built"
  },
  {
    name: "Content Generator",
    tags: "marketing, content, quick",
    content: `Your Role: Content Writer
Your Task: Write a 500-word blog post on the given topic.
Relevant Background Information: Casual tone, SEO-friendly.
Output Format: Title, intro, 3 sections, conclusion.`,
    type: "pre-built"
  }
];

document.addEventListener("DOMContentLoaded", () => {
  const templateSelect = document.getElementById("templateSelect");
  const promptArea = document.getElementById("promptArea");
  const templateName = document.getElementById("templateName");
  const templateTags = document.getElementById("templateTags");
  const searchBox = document.getElementById("searchBox");
  const dropdownResults = document.getElementById("dropdownResults");
  const filterSelect = document.getElementById("filterSelect");
  const fetchBtn = document.getElementById("fetchBtn"); // Get fetch button
  const saveBtn = document.getElementById("saveBtn"); // Get save button
  const saveAsBtn = document.getElementById("saveAsBtn"); // Get save as button
  const sendBtn = document.getElementById("sendBtn"); // Get send button

  templateSelect.parentNode.insertBefore(filterSelect, templateSelect);

  function loadTemplates(filter) {
    chrome.storage.sync.get(["templates"], (result) => {
      const templates = result.templates || defaultTemplates;
      templateSelect.innerHTML = "<option value=''>Select a template</option>";
      templates.forEach((tmpl, index) => {
        if (filter === "all" || tmpl.type === filter) {
          const option = document.createElement("option");
          option.value = index;
          option.text = `${tmpl.name} (${tmpl.tags})`;
          templateSelect.appendChild(option);
        }
      });
    });
  }

  loadTemplates("all");

  filterSelect.addEventListener("change", () => {
    loadTemplates(filterSelect.value);
  });

  templateSelect.addEventListener("change", () => {
    chrome.storage.sync.get(["templates"], (result) => {
      const templates = result.templates || defaultTemplates;
      const selected = templates[templateSelect.value];
      if (selected) {
        templateName.value = selected.name;
        templateTags.value = selected.tags;
        promptArea.value = selected.content;
      }
    });
  });

  function saveChanges() {
    const selectedIndex = templateSelect.value;
    if (selectedIndex === "") {
      alert("Please select a template to save changes.");
      return;
    }
    const confirmSave = confirm("Are you sure you want to overwrite the existing template?");
    if (!confirmSave) return;

    chrome.storage.sync.get(["templates"], (result) => {
      const templates = result.templates || defaultTemplates;
      templates[selectedIndex] = {
        name: templateName.value,
        tags: templateTags.value,
        content: promptArea.value,
        type: "custom"   // Original line -> type: templates[selectedIndex].type || "custom"
      };
      chrome.storage.sync.set({ templates }, () => {
        alert("Template saved successfully.");
      });
    });
  }

  saveBtn.addEventListener("click", saveChanges);

  saveAsBtn.addEventListener("click", () => {
    chrome.storage.sync.get(["templates"], (result) => {
      const templates = result.templates || defaultTemplates;
      templates.push({
        name: templateName.value,
        tags: templateTags.value,
        content: promptArea.value,
        type: "custom"
      });
      chrome.storage.sync.set({ templates }, () => {
        location.reload(); // Refresh template list
      });
    });
  });


  fetchBtn.addEventListener("click", () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      chrome.tabs.sendMessage(tabs[0].id, { action: "getPrompt" }, (response) => {
        if (response && response.prompt) {
          promptArea.value = response.prompt;
        }
      });
    });
  });

  searchBox.addEventListener("input", () => {
    const query = searchBox.value.toLowerCase();
    chrome.storage.sync.get(["templates"], (result) => {
      const templates = result.templates || defaultTemplates;
      dropdownResults.innerHTML = "";
      const matches = templates.filter(t =>
        t.name.toLowerCase().includes(query) || t.tags.toLowerCase().includes(query)
      );
      matches.forEach((tmpl) => {
        const div = document.createElement("div");
        div.textContent = `${tmpl.name} (${tmpl.tags})`;
        div.addEventListener("click", () => {
          templateName.value = tmpl.name;
          templateTags.value = tmpl.tags;
          promptArea.value = tmpl.content;
          dropdownResults.innerHTML = "";
        });
        dropdownResults.appendChild(div);
      });
    });
  });
  
  // Send function: send prompt to active tab's input field
  sendBtn.addEventListener("click", () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      chrome.tabs.sendMessage(tabs[0].id, {
        action: "sendPrompt",
        prompt: promptArea.value
      });
    });
  });
});

  