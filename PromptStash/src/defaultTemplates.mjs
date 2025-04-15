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

export default defaultTemplates;