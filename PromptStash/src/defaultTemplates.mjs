const defaultTemplates = [
  {
    name: "Business Analyst Report",
    tags: "analysis, report, business",
    type: "pre-built",
    content: `# Your Role\nBusiness Analyst\n\n# Your Task\nAnalyze the provided data and generate a concise report.\n\n# Relevant Background Information\nUse formal tone, focus on key metrics.\n\n# Output Format\nExecutive summary (200 words), followed by bullet points.`,
    favorite: false
  },
  {
    name: "Code Debugging Assistant",
    tags: "coding, debug, tech",
    type: "pre-built",
    content: `# Your Role\nSenior Developer\n\n# Your Task\nIdentify and fix bugs in the provided code snippet.\n\n# Relevant Background Information\nCode is in Python, prioritize efficiency.\n\n# Output Format\nExplanation of issue, corrected code block.`,
    favorite: false
  },
  {
    name: "Content Generator",
    tags: "marketing, content, quick",
    type: "pre-built",
    content: `# Your Role\nContent Writer\n\n# Your Task\nWrite a 500-word blog post on the given topic.\n\n# Relevant Background Information\nCasual tone, SEO-friendly.\n\n# Output Format\nTitle, intro, 3 sections, conclusion.`,
    favorite: false
  }
];

export default defaultTemplates;