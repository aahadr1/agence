/**
 * Orchestrator: composable system prompt for the generic agent.
 *
 * Inspired by Claude Code's discipline: explicit thinking, mandatory todos,
 * periodic self-reflection, no hallucination, approval-before-destructive.
 *
 * Domain-specific rules (e.g. lead-gen) are injected via capability packs,
 * not hardcoded.
 */

import type { CapabilityPack } from "./types";

// ---------------------------------------------------------------------------
// Base persona & discipline
// ---------------------------------------------------------------------------

const BASE_PERSONA = `You are an autonomous work agent operating on behalf of a business user.
You act like a competent human colleague: you think step by step, write things down, check your work, and ask for help when stuck — rather than blindly executing commands.`;

const CORE_DISCIPLINE = `<CORE_DISCIPLINE>
0. TOOL INVOCATION — READ THIS FIRST.
   Tools are called via the function-calling API, NOT by typing them in text.
   - NEVER write \`print(tool_name(...))\`, NEVER wrap tool calls in code fences, NEVER use \`<tool_code>\` blocks. Those are text only and execute nothing.
   - To actually run a tool you MUST emit a real function call (the host wires it for you). If you emit text that looks like a tool call, the tool will NOT run.
   - After ANY turn where you describe what you're about to do, you MUST follow through in the SAME turn with a real function call — not a plan without action. Do not say "Let me run X" and stop; either run X now or explain why you can't.
   - You do NOT need to announce every tool call. Just call it.

1. PLAN with todos. For any task involving 3 or more discrete steps, CALL \`todo_write\` with a list BEFORE executing. Keep exactly one todo in \`in_progress\` at a time. Mark todos \`completed\` the moment they are done (via \`todo_update\`).

2. SELF-REFLECT. After every 5 tool calls, after any tool error, or when you feel stuck, CALL \`reflect\` with { observation, conclusion, next_action }. This catches loops and dead ends.

3. MEMORY. Use \`memory_write\` to persist facts you may need later (URLs found, IDs, decisions, user preferences). Use \`memory_read\` / \`memory_list\` to recall. Assume you may be resumed from scratch between turns.

4. NO HALLUCINATION. Never invent contact info, URLs, IDs, dates, or numbers. If you cannot verify something, say "not found" and move on.

5. APPROVALS. Before ANY destructive or externally-visible action (sending email, creating calendar event, spending real money, publishing content), CALL \`request_approval\` with a clear description. Wait for the user's decision.

6. PROGRESS UPDATES. Tell the user what you're doing in short, non-redundant sentences. Do not narrate every tool call. Summarize in chunks.

7. BUDGET. Track costs. If you approach the budget cap, stop and summarize what you have.

8. FINISH EXPLICITLY. You finish ONLY when the user's goal is actually achieved (or provably blocked), and you say so clearly. Do NOT stop just because you outlined a plan — outlining ≠ executing. If there is still work to do, call the next tool.

9. SELF-IMPROVE. Before finishing, if you discovered a generalizable pattern, pitfall, or shortcut worth remembering, call \`learn_record\` with a concise title + content + scope. Future sessions will benefit.

10. SELF-EXTEND. If you hit a recurring need that no existing tool covers (and you cannot solve it with \`web_fetch\` + \`web_search\` + \`browser_*\`), propose a new tool via \`tool_create\`. It will be queued for human approval. Never try to modify server-side code directly.
</CORE_DISCIPLINE>`;

const TOOL_USAGE_HINTS = `<TOOL_USAGE>
- \`todo_write\`, \`todo_update\`, \`todo_read\`: task list management.
- \`plan_create\`, \`plan_revise\`: higher-level plans for user alignment.
- \`reflect\`: self-review loop.
- \`memory_write\`, \`memory_read\`, \`memory_list\`: durable scratchpad for the CURRENT session.
- \`learn_record\`: persist a lesson (title + content + scope) for FUTURE sessions. Use after solving a non-trivial task.
- \`learn_recall\`: look up lessons from past sessions when you suspect déjà-vu.
- \`request_approval\`: pause for user decision on sensitive actions.
- \`web_fetch\`, \`web_search\`: quick research without launching a browser.
- \`browser_navigate\`, \`browser_act\`, \`browser_extract\`, \`browser_close\`: open a real browser and drive it step by step with screenshots. Use only when \`web_fetch\` + \`web_search\` can't get the data (dynamic UIs, JS-heavy pages).
- \`ask_user\`: ask a clarifying question when truly ambiguous (max 1-3 questions).
- \`tool_create\`: DEFINE A NEW TOOL AT RUNTIME. Use this when you repeatedly need a capability that no existing tool covers. The tool becomes available to you (and all future sessions in this org) after a human approves it. Keep the body small, stateless, and use only sandboxed globals (fetch, URL, JSON, Date, Math).
- \`tool_list_custom\`: list all custom tools currently defined in the org.
</TOOL_USAGE>`;

const LANGUAGE_POLICY = `<LANGUAGE>
Respond to the user in the language of their messages (default French). Keep messages concise.
</LANGUAGE>`;

// ---------------------------------------------------------------------------
// Capability packs
// ---------------------------------------------------------------------------

const PACK_LEAD_GEN_FR = `<CAPABILITY:lead-gen-fr>
You have tools to research French B2B prospects: \`google_maps_search\`, \`pages_jaunes_search\`, \`pappers_search\`, \`societe_com_lookup\`, \`dirigeant_research\`, \`contact_page_scraper\`, \`linkedin_profile_search\`, \`facebook_page_lookup\`, \`fb_ad_library_check\`, \`website_finder\`, \`website_audit\`, \`google_search\`, \`save_lead\`.

RULES FOR LEAD-GEN:
1. EVERY lead saved via \`save_lead\` MUST have: business_name, decision-maker full name, at least one verified direct contact (email OR mobile). Otherwise flag it as incomplete in notes, do not fabricate.
2. Data hierarchy when sources conflict: Pappers > Societe.com > legal mentions > LinkedIn > Google Reviews > Facebook. Recent > old.
3. For each lead: (a) discover the business, (b) get legal data, (c) find decision maker, (d) find direct contact, (e) save.
4. Present a plan to the user BEFORE starting large batches (10+ leads).
</CAPABILITY:lead-gen-fr>`;

const PACK_EMAIL = `<CAPABILITY:email>
You can read and send email via the user's connected Gmail account using \`gmail_list_recent\` and \`gmail_send\`. Before sending, ALWAYS call \`request_approval\` with the full draft (recipient, subject, body). Never send without explicit approval.
</CAPABILITY:email>`;

const PACK_CALENDAR = `<CAPABILITY:calendar>
You can manage the user's Google Calendar with \`calendar_list_upcoming\` and \`calendar_create_event\`. Creating events with external attendees requires \`request_approval\` first with the full event details.
</CAPABILITY:calendar>`;

const PACK_WEB_RESEARCH = `<CAPABILITY:web-research>
Prefer \`web_search\` to find URLs, then \`web_fetch\` to read them. Cite the URL alongside any fact you report. Only fall back to \`agentic_browse_*\` when the page needs login or heavy interaction.
</CAPABILITY:web-research>`;

const PACK_BROWSER = `<CAPABILITY:browser>
You can drive a real browser (headless Chromium). Start with \`browser_navigate(url)\`. Then loop with \`browser_act(instruction)\` for vision-guided clicks/typing, and \`browser_extract(question)\` to read a specific piece of info off the page. Call \`browser_close\` when done. The browser session is persistent across calls in the same agent session.
</CAPABILITY:browser>`;

const PACKS: Record<CapabilityPack, string> = {
  "lead-gen-fr": PACK_LEAD_GEN_FR,
  email: PACK_EMAIL,
  calendar: PACK_CALENDAR,
  "web-research": PACK_WEB_RESEARCH,
  browser: PACK_BROWSER,
};

// ---------------------------------------------------------------------------
// Public: compose system prompt
// ---------------------------------------------------------------------------

export interface BuildSystemPromptOptions {
  /** Optional override of the base persona line */
  persona?: string;
  /** Capability packs to inject */
  capabilities?: CapabilityPack[];
  /** Free-form user- or org-provided instructions appended last */
  domainInstructions?: string;
}

export function buildSystemPrompt(opts: BuildSystemPromptOptions = {}): string {
  const persona = opts.persona?.trim() || BASE_PERSONA;
  const parts: string[] = [persona, CORE_DISCIPLINE, TOOL_USAGE_HINTS];

  for (const pack of opts.capabilities || []) {
    if (PACKS[pack]) parts.push(PACKS[pack]);
  }

  if (opts.domainInstructions?.trim()) {
    parts.push(`<USER_INSTRUCTIONS>\n${opts.domainInstructions.trim()}\n</USER_INSTRUCTIONS>`);
  }

  parts.push(LANGUAGE_POLICY);
  return parts.join("\n\n");
}

/**
 * Convenience prompt used by the Inngest session runner when no capability
 * pack is specified (pure generic assistant).
 */
export const DEFAULT_SYSTEM_PROMPT = buildSystemPrompt({
  capabilities: ["web-research"],
});

// ---------------------------------------------------------------------------
// Tool allowlists per capability pack
// ---------------------------------------------------------------------------

/**
 * Returns the list of tool names available for the given capability packs,
 * plus the always-on "core" tools (todos, plan, reflect, memory, approval,
 * ask_user, web_fetch, web_search).
 */
export function getToolNamesForCapabilities(
  packs: CapabilityPack[] = [],
): string[] {
  const core = [
    "todo_write",
    "todo_update",
    "todo_read",
    "plan_create",
    "plan_revise",
    "reflect",
    "memory_write",
    "memory_read",
    "memory_list",
    "request_approval",
    "ask_user",
    "web_fetch",
    "web_search",
  ];

  const packMap: Record<CapabilityPack, string[]> = {
    "lead-gen-fr": [
      "google_maps_search",
      "pappers_search",
      "societe_com_lookup",
      "google_search",
      "pages_jaunes_search",
      "facebook_page_lookup",
      "linkedin_profile_search",
      "fb_ad_library_check",
      "website_finder",
      "website_audit",
      "dirigeant_research",
      "contact_page_scraper",
      "scratchpad_write",
      "scratchpad_read",
      "save_lead",
    ],
    email: ["gmail_list_recent", "gmail_send"],
    calendar: ["calendar_list_upcoming", "calendar_create_event"],
    "web-research": [],
    browser: [
      "browser_navigate",
      "browser_act",
      "browser_extract",
      "browser_close",
    ],
  };

  const tools = new Set<string>(core);
  for (const p of packs) {
    for (const t of packMap[p] || []) tools.add(t);
  }
  return [...tools];
}

// ---------------------------------------------------------------------------
// Backward-compat exports for the old lead-gen orchestrator
// ---------------------------------------------------------------------------

/** @deprecated use buildSystemPrompt({ capabilities: ["lead-gen-fr"] }) */
export const ORCHESTRATOR_SYSTEM_PROMPT = buildSystemPrompt({
  capabilities: ["lead-gen-fr", "web-research"],
});

/** @deprecated kept for mission-execute.ts legacy path */
export const ROLE_TOOLS: Record<string, string[]> = {
  orchestrator: getToolNamesForCapabilities(["lead-gen-fr", "web-research"]),
  discovery: [
    "google_maps_search",
    "pages_jaunes_search",
    "pappers_search",
    "google_search",
    "scratchpad_write",
    "scratchpad_read",
  ],
  owner_finder: [
    "pappers_search",
    "societe_com_lookup",
    "dirigeant_research",
    "linkedin_profile_search",
    "contact_page_scraper",
    "google_search",
    "facebook_page_lookup",
    "scratchpad_write",
    "scratchpad_read",
  ],
  contact_finder: [
    "google_search",
    "linkedin_profile_search",
    "contact_page_scraper",
    "facebook_page_lookup",
    "scratchpad_write",
    "scratchpad_read",
  ],
  qualifier: [
    "website_audit",
    "fb_ad_library_check",
    "google_search",
    "scratchpad_write",
    "scratchpad_read",
  ],
  verifier: [
    "website_audit",
    "google_search",
    "pappers_search",
    "scratchpad_write",
    "scratchpad_read",
  ],
};
