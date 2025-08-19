const defaultTemplates = [
  {
    name: "Content Generator",
    tags: "marketing, content, quick",
    type: "pre-built",
    content: `# Your Role\nContent Writer\n\n# Your Task\nWrite a 500-word blog post on the given topic.\n\n# Relevant Background Information\nCasual tone, SEO-friendly.\n\n# Output Format\nTitle, intro, 3 sections, conclusion.`,
    favorite: false
  },

  {
    name: "General Email Generator",
    tags: "email, professional, communication",
    type: "pre-built",
    content: `# Your Role\nEmail Sender\n\n# Your Task\nWrite an email of type {{kind}} about {{subject}}.\n\n# Relevant Background Information\n{{sender}} — Name or role of sender\n{{recipient}} — Name and role of recipient\n{{context}} — Background, purpose, and call-to-action\n{{tone}} — Style of email (friendly, formal, professional)\n\n# Output Format\nSubject line, greeting, body (1-3 paragraphs), closing with signature.`,
    favorite: false
  },
  {
    name: "Educational Content Creator",
    tags: "education, teaching, lesson plan",
    type: "pre-built",
    content: `# Your Role\nEducational Content Creator\n\n# Your Task\nCreate a {{duration}} lesson plan for {{topic}} targeting {{audience}}.\n\n# Relevant Background Information\n{{goal}} — Main learning objective\n{{tone_style}} — Delivery style (interactive, lecture-based)\n{{prior_knowledge}} — Students' existing knowledge\n\n# Output Format\nIntroduction, key points, activity, summary, and assessment method.`,
    favorite: false
  },
  {
    name: "Marketing Copywriter",
    tags: "marketing, promotional, email, sales",
    type: "pre-built",
    content: `# Your Role\nMarketing Copywriter\n\n# Your Task\nWrite a promotional email for {{product}} to drive {{goal}}.\n\n# Relevant Background Information\n{{audience}} — Target group\n{{campaign_details}} — Promotion details and brand traits\n{{tone}} — Style of email\n{{audience_insights}} — Audience preferences\n\n# Output Format\nSubject line, greeting, hook, body with offer details, clear CTA, and closing.`,
    favorite: false
  },
  {
    name: "Market Research Analyst",
    tags: "research, analysis, competitors, market",
    type: "pre-built",
    content: `# Your Role\nMarket Research Analyst\n\n# Your Task\nAnalyze competitors for {{target_company}} to achieve {{goal}}.\n\n# Relevant Background Information\n{{stakeholder}} — Intended audience for report\n{{competitors}} — Known competitor names\n{{focus}} — Areas to compare (pricing, features, positioning)\n{{research_data}} — Customer insights and data sources\n\n# Output Format\nExecutive summary, comparison table, key takeaways, opportunities & threats, references.`,
    favorite: false
  },
  {
    name: "Startup Advisor",
    tags: "startup, feasibility, business, advisory",
    type: "pre-built",
    content: `# Your Role\nStartup Advisor\n\n# Your Task\nEvaluate feasibility of {{idea}} and provide recommendations for {{goal}}.\n\n# Relevant Background Information\n{{market}} — Target customers and size\n{{problem}} — Pain point and impact\n{{usp}} — Unique differentiator\n{{timeframe}} — Analysis period\n\n# Output Format\nMarket need, competition analysis, risks, recommendations by stakeholder, references.`,
    favorite: false
  },
  {
    name: "Social Media Manager",
    tags: "social media, marketing, content, engagement",
    type: "pre-built",
    content: `# Your Role\nSocial Media Manager\n\n# Your Task\nCreate a promotional post for {{event_or_product}} on {{platform}} to achieve {{goal}}.\n\n# Relevant Background Information\n{{audience_profile}} — Target audience and brand traits\n{{campaign_context}} — Urgency, hashtags, prior engagement\n\n# Output Format\nPost text with CTA, alternate hook, hashtag suggestions, media suggestion.`,
    favorite: false
  },
  {
    name: "Meeting Summary Generator",
    tags: "meetings, summary, documentation, productivity",
    type: "pre-built",
    content: `# Your Role\nProject Coordinator\n\n# Your Task\nTransform {{meeting_notes}} into a structured summary.\n\n# Relevant Background Information\n{{meeting_notes}} — Full meeting details in any format\n\n# Output Format\nMeeting summary, decisions made, action items, next steps.`,
    favorite: false
  },
  {
    name: "Client Proposal Summary Generator",
    tags: "business, proposals, client, executive summary",
    type: "pre-built",
    content: `# Your Role\nBusiness Development Manager\n\n# Your Task\nDraft executive summary for proposal targeting {{client_profile}}.\n\n# Relevant Background Information\n{{client_profile}} — Client name, goals, recipient role\n{{proposal_details}} — Project description and benefits\n{{deadline}} — Project timeline or delivery window\n\n# Output Format\nIntro, solution overview, benefits, closing statement.`,
    favorite: false
  },
  {
    name: "Code Debugging Assistant",
    tags: "coding, debug, programming, development",
    type: "pre-built",
    content: `# Your Role\nCode Debugging Assistant\n\n# Your Task\nIdentify and fix bugs in {{code}} to achieve {{goal}}.\n\n# Relevant Background Information\n{{lang}} — Programming language\n{{error}} — Error message (optional)\n{{rules}} — Constraints (no external libs, keep API)\n\n# Output Format\nDiagnosis, fixed code, explanation, test/usage example.`,
    favorite: false
  },
  {
    name: "Business Analyst Report",
    tags: "analysis, data, reports, insights",
    type: "pre-built",
    content: `# Your Role\nBusiness Analyst\n\n# Your Task\nAnalyze {{data}} and produce report aligned with {{goal}}.\n\n# Relevant Background Information\n{{focus}} — Key metrics/dimensions\n{{audience}} — Target audience (executives, operations)\n{{timeframe}} — Analysis period\n{{sources}} — Data sources\n\n# Output Format\nExecutive summary, key insights, recommendations, references.`,
    favorite: false
  },
  {
    name: "Veo Video Generator",
    tags: "video, veo, cinematic, gemini",
    type: "pre-built",
    content: `# Your Role\nVideo Director\n\n# Your Task\nGenerate a highly realistic cinematic 8-second video in Veo 3.\n\n# Core Information\n{{scene}} — Main setting, subject, and action\n\n# Cinematic Direction\n{{cinematic_direction}} — Camera style, lighting, tone, mood, audio, or dialogue\n\n# Character (Optional)\n{{character}} — Character details for consistency\n\n# Technical (Optional)\n{{technical}} — Resolution, aspect ratio, or format\n\n# Output\n**In Gemini with Veo:** A single cinematic 8-second Veo video clip. **In other models:** A structured text prompt for Veo. Requires Google AI Gemini Advanced plan to test Veo 3.`,
    favorite: false
  },
  {
    name: "Flow Video Generator",
    tags: "video, flow, multi-scene, gemini",
    type: "pre-built",
    content: `# Your Role\nVideo Director\n\n# Your Task\nGenerate a cinematic multi-scene video in Flow.\n\n# Scene Information\n{{scene_1}} — First setting, subject, and action\n{{scene_2}} (Optional) — Next key moment or transition\n{{scene_3}} (Optional) — Concluding sequence\n\n# Cinematic Direction\n{{cinematic_direction}} — Camera style, pacing, lighting, tone, sound design\n\n# Dialogue and Voice\n{{voice}} — Dialogue, narration, or voice-over specifications\n\n# Character (Optional)\n{{character}} — Character details for consistency\n\n# Technical (Optional)\n{{technical}} — Resolution, aspect ratio, format, duration\n\n# Output\n**In Gemini with Flow:** A generated Flow video. **In other models:** A structured text prompt for Flow. Requires Google AI Gemini Advanced plan to test Flow functionality.`,
    favorite: false
  },
  
];

export default defaultTemplates;
