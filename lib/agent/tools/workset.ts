import { registerTool } from "../tool-registry";
import {
  readWorksetState,
  summarizeWorkset,
  updateWorksetItem,
  upsertWorksetItems,
  type RawWorksetItem,
} from "../workset-state";

function requireSession(sessionId: string | undefined): string {
  if (!sessionId) throw new Error("workset tools require an active session");
  return sessionId;
}

registerTool(
  {
    name: "workset_upsert",
    description:
      "Maintain the canonical mission workset: a persistent, structured list of items/candidates being processed. Use for ANY multi-item mission, not only leads. Upsert discoveries or enriched rows with status, facts, missing fields, next_action, and sources so future ticks resume from state instead of restarting.",
    parameters: {
      items: {
        type: "array",
        items: { type: "object" },
        description:
          "Items to add/merge. Each item may include id/item_id, title/name/business_name, status, facts, missing[], next_action, sources[], confidence_score, priority, plus arbitrary fact fields.",
      },
      mode: {
        type: "string",
        enum: ["merge", "replace"],
        description:
          "merge by default. Use replace only when the user changed the mission/scope or you intentionally rebuilt the whole pool.",
        required: false,
      },
      source: {
        type: "string",
        description: "Source label for this batch, e.g. google_maps_search, user_upload, crm_export.",
        required: false,
      },
      goal: {
        type: "string",
        description: "Optional one-sentence mission goal this workset serves.",
        required: false,
      },
      target_count: {
        type: "number",
        description: "Optional target count for saved/delivered items.",
        required: false,
      },
    },
    required: ["items"],
    costEstimateCents: 0,
  },
  async (args, context) => {
    const sessionId = requireSession(context.sessionId);
    const raw = args.items as unknown;
    if (!Array.isArray(raw)) throw new Error("workset_upsert: items must be an array");
    const state = await upsertWorksetItems(
      sessionId,
      raw.slice(0, 100) as RawWorksetItem[],
      {
        mode: args.mode === "replace" ? "replace" : "merge",
        source: typeof args.source === "string" ? args.source : null,
        goal: typeof args.goal === "string" ? args.goal : undefined,
        target_count:
          typeof args.target_count === "number"
            ? args.target_count
            : undefined,
      },
    );
    return {
      ok: true,
      summary: summarizeWorkset(state),
      items: state.items.slice(0, 40).map((item) => ({
        id: item.id,
        title: item.title,
        status: item.status,
        missing: item.missing,
        next_action: item.next_action,
        sources: item.sources,
        confidence_score: item.confidence_score,
      })),
    };
  },
);

registerTool(
  {
    name: "workset_update",
    description:
      "Update one item in the canonical workset: mark status, merge facts, record missing fields, next action, blocker, source, confidence, or a tool attempt. Prefer this after every meaningful tool result or decision.",
    parameters: {
      item_id: {
        type: "string",
        description: "Stable item id from workset_read/upsert. Preferred.",
        required: false,
      },
      title: {
        type: "string",
        description: "Exact item title if item_id is not available.",
        required: false,
      },
      status: {
        type: "string",
        description:
          "Recommended statuses: new, active, contact_found, legal_found, ready, saved, blocked, discarded. Other concise statuses are accepted.",
        required: false,
      },
      facts: {
        type: "object",
        description: "Facts to merge into this item.",
        required: false,
      },
      missing: {
        type: "array",
        items: { type: "string" },
        description: "Current missing fields/questions for this item.",
        required: false,
      },
      next_action: {
        type: "string",
        description: "Next concrete action for this item, or null/empty when none.",
        required: false,
      },
      source: {
        type: "string",
        description: "Source label to add to the item.",
        required: false,
      },
      attempt: {
        type: "object",
        description:
          "Optional attempt log, e.g. { tool, outcome, summary, retryable }. Use after errors or dead ends.",
        required: false,
      },
      blocker: {
        type: "string",
        description: "Optional concise reason this item is blocked/discarded.",
        required: false,
      },
      confidence_score: {
        type: "number",
        description: "Optional confidence score 0-100.",
        required: false,
      },
      priority: {
        type: "number",
        description: "Optional lower number = higher priority.",
        required: false,
      },
    },
    required: [],
    costEstimateCents: 0,
  },
  async (args, context) => {
    const sessionId = requireSession(context.sessionId);
    const state = await updateWorksetItem(sessionId, args);
    return { ok: true, summary: summarizeWorkset(state) };
  },
);

registerTool(
  {
    name: "workset_read",
    description:
      "Read the canonical mission workset. Use when resuming, before changing strategy, before asking the user, or when you feel you lost the candidate/item list.",
    parameters: {
      status: {
        type: "string",
        description: "Optional status filter, e.g. new, active, blocked, ready.",
        required: false,
      },
      limit: {
        type: "number",
        description: "Max items to return (default 30, max 100).",
        required: false,
      },
      include_facts: {
        type: "boolean",
        description: "Return facts payloads. Defaults false for compactness.",
        required: false,
      },
    },
    required: [],
    costEstimateCents: 0,
  },
  async (args, context) => {
    const sessionId = requireSession(context.sessionId);
    const state = await readWorksetState(sessionId);
    const status = typeof args.status === "string" ? args.status : null;
    const limit = Math.min(Math.max(Number(args.limit) || 30, 1), 100);
    const includeFacts = args.include_facts === true;
    const items = state.items
      .filter((item) => !status || item.status === status)
      .slice(0, limit)
      .map((item) => ({
        id: item.id,
        title: item.title,
        status: item.status,
        missing: item.missing,
        next_action: item.next_action,
        sources: item.sources,
        blockers: item.blockers,
        attempts: item.attempts.slice(-5),
        confidence_score: item.confidence_score,
        priority: item.priority,
        ...(includeFacts ? { facts: item.facts } : {}),
      }));
    return {
      ok: true,
      goal: state.goal,
      summary: summarizeWorkset(state),
      items,
    };
  },
);

