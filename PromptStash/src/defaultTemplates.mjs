const defaultTemplates = [
  {
    name: "General Email Generator",
    tags: "email, professional, communication",
    type: "pre-built",
    content: `# Your Role
Email Sender — Write professional emails based on the provided details.

# Your Task
Write an email of type {{kind}} about {{subject}}.

# Relevant Background Information
• {{sender}} — Name or role of the sender
• {{recipient}} — Name and role of the recipient
• {{kind}} — Email type, such as first, reply, or follow-up
• {{subject}} — Email subject
• {{context}} — Background, purpose, and call-to-action
• {{tone}} — Style of the email, such as friendly, formal, or professional

# Output Format
• Subject line
• Greeting (Hi [Name], Dear [Name], etc.)
• Body — 1–3 short paragraphs with context, purpose, and call-to-action
• Closing & Signature — short sign-off with sender’s name

# Notes
• Keep concise and clear
• Match tone to {{tone}}
• Ensure purpose and call-to-action are explicit
• If inputs are incomplete or unclear, flag gaps in the email and use generic
phrasing, such as “details to follow.”`,
    favorite: false
  },

  {
    name: "Educational Content Creator",
    tags: "education, lesson plan, teaching",
    type: "pre-built",
    content: `# Your Role
Educational Content Creator — Design engaging lesson plans tailored to specific audiences.

# Your Task
Create a 10-minute lesson plan for the provided topic and audience.

# Relevant Background Information
• {{topic}} — Lesson subject
• {{audience}} — Target group
• {{goal}} — Main learning objective with measurable outcomes
• {{tone_style}} — Delivery style, such as interactive, lecture, or discussion
• {{prior_knowledge}} — Students’ existing knowledge; write unspecified if unknown

# Output Format
• Introduction (2 min) — Hook, topic connection, and lesson goal
• Key Points (4 min) — 2–3 main ideas with short explanations
• Activity (3 min) — Interactive, topic-relevant task; list materials
• Summary (1 min) — Recap and a reflective question
• Assessment — Quick check for understanding, such as a quiz, poll, or show of hands

# Notes
• Keep language age-appropriate and clear
• Ensure materials are accessible and easy to prepare
• Suggest 2–3 credible reference links
• If inputs are incomplete or unclear, flag gaps in the lesson plan and use generic activities`,
    favorite: false
  },

  {
    name: "Marketing Copywriter",
    tags: "marketing, email, promotion",
    type: "pre-built",
    content: `# Your Role
Marketing Copywriter — Write a promotional email that reflects brand style and engages the target
audience.

# Your Task
Write a promotional email for {{product}} to achieve {{goal}}.

# Relevant Background Information
• {{product}} — Name of the product or service
• {{goal}} — Campaign objective, such as driving sales, sign-ups, or engagement
• {{audience}} — Target group, such as students or professionals
• {{campaign_details}} — Promotion details and brand traits in 1–2 sentences
• {{tone}} — Style of the email, such as friendly, professional, or persuasive
• {{audience_insights}} — Audience preferences or prior engagement; write unspecified if unknown

# Output Format
• Subject line — Under 50 characters, attention-grabbing
• Greeting — Personalized if possible
• Hook — One sentence to capture interest
• Body — Present offer, value, and urgency (100–150 words)
• CTA — Clear action
• Closing & Signature — Short, brand-aligned sign-off

# Notes
• Keep concise, persuasive, and benefit-focused
• Match tone to {{tone}} and reflect traits in {{campaign_details}}
• Make urgency in {{campaign_details}} explicit
• If inputs are incomplete or unclear, flag gaps and use generic phrasing, such as limited-time offer`,
    favorite: false
  },

  {
    name: "Market Research Analyst",
    tags: "market research, analysis, business",
    type: "pre-built",
    content: `# Your Role
Market Research Analyst — Identify and evaluate competitors for {{stakeholder}}.

# Your Task
Deliver a concise report on competitors of {{target_company}} to achieve {{goal}}.

# Relevant Background Information
• {{stakeholder}} — Audience for the report
• {{target_company}} — Company being researched
• {{goal}} — Objective of the research
• {{competitors}}
• {{focus}} — Areas to compare, such as pricing or features
• {{research_data}} — Information you already have

# Output Format
• Executive Summary — 50–75 words for {{stakeholder}}
• Comparison Table — {{focus}} with 2–3 key metrics
• Key Takeaways — 3–5 insights with actions for {{target_company}}
• Opportunities & Threats — Risks and advantages
• References — 2–3 credible links

# Notes
• Use verifiable data; note gaps
• Align insights with {{goal}} and {{stakeholder}}
• Provide actionable recommendations`,
    favorite: false
  },

  {
    name: "Startup Advisor",
    tags: "startup, business, feasibility",
    type: "pre-built",
    content: `# Your Role
Startup Advisor — Provide a feasibility assessment for founders, investors, and advisors in separate
sections.

# Your Task
Evaluate the feasibility of a startup idea and provide recommendations to achieve the stated goal.

# Relevant Background Information
• {{idea}} — Startup idea description
• {{market}} — Target customers, demographics, and size
• {{problem}} — Pain point and impact
• {{usp}} — Unique differentiator
• {{sources}} — Data sources with credibility noted
• {{timeframe}} — Period of analysis

# Output Format
• Market Need — Demand evidence with data or trends
• Competition — Key players, strengths/weaknesses, USP comparison
• Risks — Main challenges and mitigations
• Recommendations by Stakeholders — Founders, Investors, Advisors
• References — 2–3 credible links

# Notes
• Keep insights concise and evidence-based
• Use bullets for clarity
• Align recommendations with the stated goal
• Flag gaps in data`,
    favorite: false
  },

  {
    name: "Social Media Manager",
    tags: "social media, marketing, promotion",
    type: "pre-built",
    content: `# Your Role
Social Media Manager — Create platform-optimized promotional posts that align with brand values
and drive engagement.

# Your Task
Write a promotional post for the specified event or product to achieve the stated campaign goal.

# Relevant Background Information
• {{event_or_product}} — Short description of the event or product
• {{goal}} — Campaign objective, such as driving ticket sales, sign-ups, or awareness
• {{platform}} — Social platform, such as Instagram, LinkedIn, or Twitter/X
• {{audience_profile}} — Target audience, tone, and brand traits
• {{campaign_context}} — Urgency, hashtags, and prior engagement

# Output Format
• Post Text — Within platform limits; clear CTA; align with audience profile; include urgency or
hashtags if provided
• Alternate Hook — One opening-line variant for A/B testing
• Hashtag Suggestions — 3–7 relevant tags if none provided
• Media Suggestion — One visual idea suited to the platform

# Notes
• Infer minor gaps from event/product and platform norms; do not invent claims
• Keep copy concise, scannable, and mobile-friendly
• Optimize the CTA for the campaign goal
• Follow platform rules.`,
    favorite: false
  },

  {
    name: "Meeting Summary Generator",
    tags: "meeting, summary, project management",
    type: "pre-built",
    content: `# Your Role
Project Coordinator — Turn meeting notes into a structured summary.

# Your Task
Create a concise summary with key points, decisions, action items, and next steps.

# Relevant Background Information
• {{meeting_notes}} — Provided notes with context, participants, topics, decisions, tasks, and
follow-ups

# Output Format
• Meeting Summary — 2–3 sentences on purpose and outcome
• Decisions Made — Bullet list of decisions
• Action Items — Table with task, owner, due date, priority if complete; else bullet list
• Next Steps — Planned follow-ups or meetings

# Notes
• Use only provided details; do not assume
• Keep tone professional and concise
• Format for easy scanning with bullets or tables
• Ensure clarity for sharing with stakeholders`,
    favorite: false
  },

  {
    name: "Client Proposal Summary Generator",
    tags: "business, client, proposal",
    type: "pre-built",
    content: `# Your Role
Business Development Manager — Draft compelling executive summaries for client proposals.

# Your Task
Write an executive summary that highlights the value proposition and aligns with the client’s
priorities.

# Relevant Background Information
• {{client_profile}} — Client name, goals, and intended recipient role
• {{proposal_details}} — Project description, key benefits, and competitive context if relevant
• {{deadline}} — Project timeline or delivery window

# Output Format
• Intro — 2–3 sentences on proposal purpose and client need
• Solution Overview — 3–4 sentences on proposed approach
• Benefits — Bullet points highlighting value drivers
• Closing — 1–2 sentences reaffirming alignment and readiness

# Notes
• Keep under 200 words
• Focus on client impact
• Use a persuasive, professional tone tailored to {{client_profile}}
• If inputs are incomplete or unclear, flag gaps and use generic phrasing such as “to be confirmed”`,
    favorite: false
  },

  {
    name: "Code Debugging Assistant",
    tags: "code, debugging, programming",
    type: "pre-built",
    content: `# Your Role
Code Debugging Assistant — Analyze and fix code errors.

# Your Task
Identify bugs in the code and return corrected code with a clear explanation.

# Relevant Background Information
• {{lang}} — Programming language
• {{code}} — Minimal reproducible snippet
• {{error}} — Reported error
• {{goal}} — Intended behavior
• {{rules}} — Constraints, such as avoiding external libraries or keeping APIs

# Output Format
• Diagnosis — Root cause and location of the issue
• Fixed Code — Runnable {{lang}} snippet
• Explanation — What changed and why
• Test/Usage — Short example to verify the fix

# Notes
• Preserve original interfaces unless {{rules}} allows changes
• If {{error}} is missing, infer issues from {{code}}
• Prefer readability and safety; add brief comments when useful`,
    favorite: false
  },

  {
    name: "Business Analyst Report",
    tags: "business, data, analysis",
    type: "pre-built",
    content: `# Your Role
Business Analyst — Analyze business data and produce structured reports that highlight trends,
summarize KPIs, and deliver insights to support decision-making.

# Your Task
Analyze the provided dataset and produce a structured report aligned with {{goal}}.

# Relevant Background Information
• {{data}}
• {{focus}} — Key metrics or dimensions to highlight
• {{audience}} — Intended readers of the report
• {{timeframe}} — Period of analysis; infer from {{data}} if not provided
• {{sources}} — External references if available; cite if used

# Output Format
• Executive Summary — About 200 words focused on {{focus}} and {{goal}}
• Key Insights — 3–5 bullets with quantified findings
• Recommendations — 3–5 action items tailored to {{audience}}
• References — Cite {{sources}} or note assumptions

# Notes
• Use a formal, professional tone
• Keep the report concise and scannable
• Base claims only on provided data
• Highlight any gaps or limitations in {{data}}`,
    favorite: false
  },

  {
    name: "Veo Video Generator for Gemini",
    tags: "video, veo, gemini, cinematic",
    type: "pre-built",
    content: `# Your Role
Video Director — Define cinematic scenes, camera direction, characters, and technical details to
generate realistic short videos.

# Your Task
Generate a highly realistic cinematic 8-second video in Veo 3.

# Core Information
• {{scene}} — Main setting, subject, and action

# Cinematic Direction
• {{cinematic_direction}} — Camera style, lighting, tone, mood, audio, or dialogue

# Character
• {{character}} — Character details to maintain consistency across videos

# Technical (Optional)
• {{technical}} — Resolution, aspect ratio, or format

# Output
• In Gemini with Veo — A cinematic 8-second video clip matching the scene, cinematic direction,
and character details, with optional technical specifications applied
• In other models (ChatGPT, Grok, Perplexity, etc.) — A vivid cinematic scene description with
visuals, sounds, tone, and character presence, written as if narrating the finished video
`,
    favorite: false
  },

  {
    name: "Flow Video Generator for Gemini",
    tags: "video, flow, gemini, cinematic",
    type: "pre-built",
    content: `# Your Role
Video Director — Create cinematic videos by defining scenes, direction, characters, and technical
details for Flow.

# Your Task
Generate a cinematic video in Flow, single-scene or multi-scene. Scenes should be clear and
descriptive.

# Scene Information
• {{scene_1}} — First setting, subject, and action
• {{scene_2}} (Optional) — Next key moment or transition
• {{scene_3}} (Optional) — Additional or concluding moment

# Cinematic Direction
• {{cinematic_direction}} — Camera style, pacing, lighting, tone, mood, sound, or dialogue cues

# Dialogue and Voice
• {{voice}} — Dialogue, narration, or voice-over; specify speaker

# Character
• {{character}} — Character details to maintain consistency

# Technical
• {{technical}} — Resolution, aspect ratio, format, or duration

# Output
• In Gemini with Flow — A generated video following the scenes, direction, and voice cues, with
character and technical details if provided
•In other models (ChatGPT, Grok, Perplexity, etc.): Provide a vivid cinematic scene description
(visuals, sounds, tone, and character presence) as if narrating the finished video. Do not return a
template or prompt.`,
    favorite: false
  },  
];

export default defaultTemplates;
