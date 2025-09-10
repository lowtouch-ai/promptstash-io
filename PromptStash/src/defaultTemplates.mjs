const defaultTemplates = [
  {
    name: "General Email Generator",
    tags: "email, professional, communication",
    type: "pre-built",
    content: `# Your Role
Email Sender — Write professional emails based on provided details.

# Your Task
Write an email of type {{kind}} about {{subject}}.

# Relevant Background Information
- {{sender}} — Name or role of the sender
- {{recipient}} — Name and role of the recipient
- {{kind}} — Email type
- {{subject}} — Short topic
- {{context}} — Background, purpose, and call-to-action, max 3 sentences
- {{tone}} — Style of the email

# Output Format
1. Subject line
2. Greeting
3. Body — 1–3 short paragraphs with context, purpose, and call-to-action
4. Closing & Signature — short sign-off with sender’s name

# Notes
- Keep concise, clear, and under 150 words unless specified
- Match tone to {{tone}}
- Ensure purpose and call-to-action are explicit
- If inputs are incomplete or unclear, flag gaps in the email and use generic phrasing
- Assume no attachments unless specified in {{purpose}}`,
    favorite: false
  },

  {
    name: "Educational Content Creator",
    tags: "education, lesson plan, teaching",
    type: "pre-built",
    content: `# Your Role
Educational Content Creator — Design engaging lesson plans tailored to the specified audience.

# Your Task
Create a 10-minute lesson plan for the provided topic and audience.

#  Relevant Background Information
- {{topic}} — Lesson subject
- {{audience}} — Specific group
- {{goal}} — Main learning objective with 2–3 measurable outcomes
- {{tone_style}} — Tone and delivery style
- {{prior_knowledge}} — Students’ existing knowledge or context; if unknown, note as "unspecified"

# Output Format
1. Introduction (2 min) — Hook, topic connection, and lesson goal
2. Key Points (4 min) — 2–3 main ideas with short explanations
3. Activity (3 min) — Interactive, topic-relevant task; list materials
4. Summary (1 min) — Recap and a reflective question
5. Assessment — Quick check for understanding

# Notes
- Suggest adaptations for both in-person and online delivery
- Keep language age-appropriate and clear
- Ensure materials are accessible and easy to prepare
- Suggest 2–3 credible reference links
- If inputs are incomplete or unclear, flag gaps in the lesson plan and use generic examples`,
    favorite: false
  },

  {
    name: "Marketing Copywriter",
    tags: "marketing, email, promotion",
    type: "pre-built",
    content: `# Your Role
Marketing Copywriter — Craft a promotional email that aligns with the brand’s style and engages the target audience.

# Your Task
Write a promotional email for {{product}} to drive {{goal}}.

#  Relevant Background Information
- {{product}} — Name of the product or service
- {{goal}} — Campaign objective
- {{audience}} — Target group
- {{campaign_details}} — Promotion details and brand traits to reflect, max 2 sentences
- {{tone}} — Style of the email
- {{audience_insights}} — Audience preferences or prior engagement; if unknown, note as "unspecified"

# Output Format
1. Subject Line — Under 50 characters, attention-grabbing
2. Greeting — Personalized if possible
3. Hook — One sentence to capture interest
4. Body — Present offer, value to audience, and urgency (100–150 words)
5. CTA — Clear action
6. Closing & Signature — Short, brand-aligned sign-off

# Notes
- Keep sentences concise, persuasive, and benefit-focused
- Match tone to {{tone}} and reflect brand traits in {{campaign_details}}
- Make urgency in {{campaign_details}} explicit
- If inputs are incomplete or unclear, flag gaps in the email and use generic phrasing`,
    favorite: false
  },

  {
    name: "Market Research Analyst",
    tags: "market research, analysis, business",
    type: "pre-built",
    content: `# Your Role
Market Research Analyst — Identify and evaluate competitors, tailoring the report to {{stakeholder}}.

# Your Task
Analyze competitors and deliver a concise, decision-ready report for {{target_company}} to achieve {{goal}}.

#  Relevant Background Information
- {{stakeholder}} — Intended audience for the report
- {{target_company}} — Company for which the research is being conducted
- {{goal}} — Main business objective of the research
- {{competitors}} — Known competitor names; leave blank to auto-identify 3–5 likely competitors with rationale
- {{focus}} — Areas to compare
- {{research_data}} — Customer insights and data sources with credibility noted

# Output Format
1. Executive Summary — 50–75 words tailored to {{stakeholder}}
2. Comparison Table — Competitors vs. {{focus}}, 2–3 key metrics
3. Key Takeaways — 3–5 strategic insights for {{target_company}} with recommended actions and timelines
4. Opportunities & Threats — Risks and advantages for {{target_company}}
5. References — 2–3 credible links

# Notes
- Use verifiable, relevant data; note gaps
- Make tables scannable and mobile-friendly
- Align insights with {{goal}} and {{stakeholder}} priorities
- Provide actionable recommendations`,
    favorite: false
  },

  {
    name: "Startup Advisor",
    tags: "startup, business, feasibility",
    type: "pre-built",
    content: `# Your Role
Startup Advisor — Provide a feasibility assessment for founders, investors, and advisors in separate sections.

# Your Task
Evaluate the feasibility of a startup idea and provide actionable recommendations to achieve the stated goal.

#  Relevant Background Information
- {{idea}} — Short description of the startup idea
- {{market}} — Target customers, demographics, and size
- {{problem}} — Pain point and its impact
- {{usp}} — Unique differentiator
- {{sources}} — Data sources; note credibility
- {{timeframe}} — Analysis period

# Output Format
1. Market Need — Demand evidence with data/trends
2. Competition — Key players, strengths/weaknesses, USP comparison
3. Risks — Main challenges and mitigations
4. Recommendations by Stakeholder — Founders, Investors, Advisors
5. References — 2–3 credible links

# Notes
- Keep insights concise and evidence-based
- Make it scannable with bullets
- Align recommendations with the goal
- Flag data gaps`,
    favorite: false
  },

  {
    name: "Social Media Manager",
    tags: "social media, marketing, promotion",
    type: "pre-built",
    content: `# Your Role
Social Media Manager — Create platform-optimized promotional posts that align with brand values and drive engagement.

# Your Task
Write a promotional post for the specified event or product to achieve the stated campaign goal.

#  Relevant Background Information
- {{event_or_product}} — Name and one-sentence description
- {{goal}} — Campaign objective
- {{platform}} — Social platform
- {{audience_profile}} — Target audience, tone style, and brand traits
- {{campaign_context}} — Urgency, hashtags, and prior engagement

# Output Format
1. Post Text — Within platform limits; clear CTA aligned to the goal; reflect the audience profile; include urgency/hashtags if provided
2. Alternate Hook — One opening-line variant for A/B testing
3. Hashtag Suggestions — 3–7 relevant tags if none were provided
4. Media Suggestion — One visual idea suited to the platform

# Notes
- Infer minor gaps from the event/product and platform norms; do not invent claims
- Keep copy concise, scannable, and mobile-friendly
- Optimize the CTA for the goal
- Follow platform rules`,
    favorite: false
  },

  {
    name: "Meeting Summary Generator",
    tags: "meeting, summary, project management",
    type: "pre-built",
    content: `# Your Role
Project Coordinator — Turn provided meeting notes into a polished, structured summary.

# Your Task
Use the meeting details provided in conversational English to create a concise, professional summary with decisions, action items, and next steps.

#  Relevant Background Information
- {{meeting_notes}} — Full meeting details in any format (can include context, participants, purpose, topics discussed, decisions made, action items with owners/dates/priorities, and next steps).

# Output Format
1. Meeting Summary — 2–3 sentences summarizing the meeting’s purpose, key points, and outcome
2. Decisions Made — Bulleted list with brief explanations
3. Action Items —
- If details include task, owner, due date, and priority → format as a table with these columns.
- If details are incomplete → list as bullet points with available information.
4. Next Steps — Planned follow-up actions or meetings

# Notes
- Use only the information provided; do not add or assume details
- Keep tone professional and concise
- Format for easy scanning with bullets, tables, and short paragraphs
- Ensure clarity so the summary is ready to share with the intended audience`,
    favorite: false
  },

  {
    name: "Client Proposal Summary Generator",
    tags: "business, client, proposal",
    type: "pre-built",
    content: `# Your Role
Business Development Manager — Draft compelling executive summaries for client proposals.

# Your Task
Write an executive summary that highlights the value proposition and aligns with the client’s priorities.

#  Relevant Background Information
- {{client_profile}} — Client name, main goals, and intended recipient role
- {{proposal_details}} — Project description, top 3–5 benefits, and competitive context if relevant
- {{deadline}} — Project timeline or delivery window

# Output Format
1. Intro — 2–3 sentences describing the proposal purpose and client need
2. Solution Overview — 3–4 sentences describing the proposed approach
3. Benefits — Bullet points highlighting key value drivers
4. Closing — 1–2 sentences reaffirming alignment and readiness

# Notes
- Keep under 200 words
- Focus on client impact
- Use a persuasive, professional tone tailored to the recipient in {{client_profile}}
- If inputs are incomplete or unclear, flag gaps in the summary and use generic phrasing`,
    favorite: false
  },

  {
    name: "Code Debugging Assistant",
    tags: "code, debugging, programming",
    type: "pre-built",
    content: `# Your Role
Code Debugging Assistant — analyze and fix code errors.

# Your Task
Identify bugs in the code and return corrected code with a clear explanation.

#  Relevant Background Information
- Language: {{lang}}
- Code: {{code}}
- Error: {{error}} (optional)
- Goal: {{goal}}
- Constraints: {{rules}} (optional)

# Output Format
1. Diagnosis — root cause and where it occurs.
2. Fixed Code — runnable {{lang}} snippet.
3. Explanation — what changed and why.
4. Test/Usage — brief example to verify the fix.

# Notes
- Preserve original interfaces unless {{rules}} allows changes.
- If {{error}} is missing, infer issues from {{code}}.
- Prefer readability and safety; add brief comments where helpful.`,
    favorite: false
  },

  {
    name: "Business Analyst Report",
    tags: "business, data, analysis",
    type: "pre-built",
    content: `# Your Role
Business Analyst — generate concise, data-driven reports.

# Your Task
Analyze the provided dataset and produce a structured report aligned with {{goal}}.

#  Relevant Background Information
- Data: {{data}} — raw table, CSV, or pasted figures
- Focus: {{focus}} — key metrics/dimensions
- Audience: {{audience}}
- Time Frame: {{timeframe}} — optional; infer from {{data}} if empty
- Sources: {{sources}} — optional; cite if used

# Output Format
1. Executive Summary — ~200 words focused on {{focus}} and {{goal}}
2. Key Insights — 3–5 bullets with quantified findings
3. Recommendations — 3–5 action items tailored to {{audience}}
4. References — list {{sources}} or note assumptions

# Notes
- Use a formal tone; keep copy scannable (short paragraphs, bullets)
- Base claims on the provided data; highlight any gaps or limitations`,
    favorite: false
  },

  {
    name: "Veo Video Generator for Gemini",
    tags: "video, veo, gemini, cinematic",
    type: "pre-built",
    content: `# Your Role
Video Director

# Your Task
Generate a highly realistic cinematic 8-second video in Veo 3.

# Core Information
{{scene}} — The main setting, subject, and action.

# Cinematic Direction
{{cinematic_direction}} — Camera style, lighting, tone, mood, audio, or dialogue.

# Character
{{character}} — Character details if you want consistency across videos.

# Technical (Optional)
{{technical}} — Resolution, aspect ratio, or format.

# Output
- In Gemini with Veo: A single cinematic 8-second Veo video clip matching the scene and cinematic direction, with character and optional technical details applied.
- In other models (ChatGPT, Grok, Perplexity, etc.): A structured text prompt prepared for Veo, not a video. The output will be a ready-to-use script you can copy into Veo for video generation.`,
    favorite: false
  },

  {
    name: "Flow Video Generator for Gemini",
    tags: "video, flow, gemini, cinematic",
    type: "pre-built",
    content: `# Your Role
Video Director

# Your Task
Generate a cinematic multi-scene (or single-scene) video in Flow. Each scene should be clear and descriptive. Multiple scenes are optional — you may write the entire video in one scene if desired.

# Scene Information
{{scene_1}} — The first setting, subject, and action.
{{scene_2}} (Optional) — The next key moment, transition, or action.
{{scene_3}} (Optional) — Another moment that continues or concludes the sequence.

# Cinematic Direction
{{cinematic_direction}} — Camera style, pacing, lighting, tone, mood, sound design, or dialogue cues.

# Dialogue and Voice
{{voice}} — Specify any dialogue, narration, or voice-over. Write clearly who is speaking.
- To include dialogue: wrap spoken text in quotes and indicate the speaker.
- To add narration/voice-over: state it explicitly.
- To add ambient shouts or crowd voices: state it explicitly.

# Character
{{character}} — Details to maintain consistency across scenes.

# Technical (Optional)
{{technical}} — Resolution, aspect ratio, format, or duration.

# Output
- In Gemini with Flow: A generated Flow video composed of one or more scenes that follow the scene information, cinematic direction, and dialogue/voice cues. Character and technical details are applied if provided.
- In other models (ChatGPT, Grok, Perplexity, etc.): A structured text prompt prepared for Flow, not a video. The output will be a ready-to-use script you can copy into Flow for video generation.`,
    favorite: false
  },  
];

export default defaultTemplates;
