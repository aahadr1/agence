/**
 * Todo tools — Claude-Code-style structured task list, persisted per session.
 *
 * todo_write         : replace the full list with a new one (most common op).
 * todo_update        : change status of a single todo by id (fuzzy matcher).
 * todo_update_batch  : change status of several todos in one call.
 * todo_finalize      : mark all remaining open todos completed.
 * todo_read          : return current list.
 *
 * The matcher behind todo_update accepts (in order of preference):
 *   1. UUID
 *   2. 1-based index ("1", "2", "#3", "todo 2")
 *   3. Alias: "current" / "active" / "in_progress" / "next"
 *   4. Normalized content substring (punctuation/accent-insensitive)
 *   5. Token-overlap Jaccard ≥ 0.5 fuzzy match
 *
 * The fuzzy matcher exists because models routinely send trimmed, slightly
 * reworded, or differently-punctuated copies of a todo's content (see the
 * Nancy lead-gen incident: "…points faibles." vs DB "…points faibles (site
 * web, réservation, etc.).").
 */

import { registerTool } from "../tool-registry";
import { getAgentDb } from "./_db";

type Status = "pending" | "in_progress" | "completed" | "cancelled";

const VALID_STATUS = new Set<Status>([
  "pending",
  "in_progress",
  "completed",
  "cancelled",
]);

registerTool(
  {
    name: "todo_write",
    description:
      "Create or replace the full todo list for the current session. Use ONCE at the start of multi-step work (or after every item is completed/cancelled and you begin a genuinely new phase). While ANY todo is still pending or in_progress, do NOT call this again — use todo_read + todo_update / todo_update_batch instead (see CORE rule 12). If the USER explicitly asked in chat to discard progress and restart, pass replace_existing + reset_reason.",
    parameters: {
      items: {
        type: "array",
        items: { type: "string" },
        description:
          "Ordered list of todo descriptions (one sentence each). Status is inferred as 'pending' for new items. Use todo_update to change statuses.",
      },
      replace_existing: {
        type: "boolean",
        description:
          "Set true ONLY when the user explicitly asked to throw away the current plan/todos and start over. Must be paired with reset_reason.",
      },
      reset_reason: {
        type: "string",
        description:
          "When replace_existing is true: short verbatim-style summary of why the user requested a full reset (min ~20 chars). Otherwise omit.",
      },
    },
    required: ["items"],
    costEstimateCents: 0,
  },
  async (args, context) => {
    const db = getAgentDb();
    const rawItems = args.items as unknown;
    if (!Array.isArray(rawItems)) {
      throw new Error("items must be an array");
    }
    if (!context.sessionId) {
      throw new Error("todo_write requires an active session");
    }

    const replace =
      args.replace_existing === true &&
      typeof args.reset_reason === "string" &&
      String(args.reset_reason).trim().length >= 20;

    const { data: openRows } = await db
      .from("agent_todos")
      .select("id")
      .eq("session_id", context.sessionId)
      .in("status", ["pending", "in_progress"])
      .limit(1);

    if (openRows && openRows.length > 0 && !replace) {
      throw new Error(
        "todo_write blocked: there are still open todos (pending or in_progress). Replacing the whole list mid-run destroys progress and causes restart loops. Call todo_read, then todo_update / todo_update_batch to adjust statuses, or todo_finalize when everything is truly done. Only if the USER explicitly asked to abandon the current work and replan from scratch, call todo_write again with replace_existing: true and reset_reason quoting their request.",
      );
    }

    type Item = string | { content?: string; status?: Status };
    const items = rawItems as Item[];

    // Replace strategy: delete existing + insert fresh with positions
    await db.from("agent_todos").delete().eq("session_id", context.sessionId);

    const rows = items.map((it, idx) => {
      if (typeof it === "string") {
        return {
          session_id: context.sessionId,
          content: it.slice(0, 500),
          status: "pending" as Status,
          position: idx,
        };
      }
      return {
        session_id: context.sessionId,
        content: String(it.content || "").slice(0, 500),
        status:
          it.status && VALID_STATUS.has(it.status)
            ? it.status
            : ("pending" as Status),
        position: idx,
      };
    });

    const { data, error } = await db
      .from("agent_todos")
      .insert(rows)
      .select("id, content, status, position");
    if (error) throw new Error(`todo_write failed: ${error.message}`);
    return { count: data?.length || 0, todos: data || [] };
  },
);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Normalize a todo content string for fuzzy matching.
 *  - lowercased
 *  - NFD + strip combining accents
 *  - punctuation collapsed to space
 *  - whitespace collapsed
 *
 * The goal is to make "Analyser ... des points faibles." match
 * "Analyser ... des points faibles (site web, réservation, etc.)." even
 * when trailing punctuation, parenthesised extras, or accent variants differ.
 */
function normalizeContent(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function tokenize(s: string): string[] {
  return normalizeContent(s).split(" ").filter((t) => t.length >= 2);
}

function jaccard(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const sa = new Set(a);
  const sb = new Set(b);
  let inter = 0;
  for (const t of sa) if (sb.has(t)) inter++;
  const union = sa.size + sb.size - inter;
  return union === 0 ? 0 : inter / union;
}

async function resolveTodoId(
  db: ReturnType<typeof getAgentDb>,
  sessionId: string,
  idOrMatch: string,
): Promise<{
  id: string;
  content: string;
  position: number;
  status: Status;
} | null> {
  const key = idOrMatch.trim();
  if (!key) return null;

  // 1) Proper UUID — direct lookup
  if (UUID_RE.test(key)) {
    const { data } = await db
      .from("agent_todos")
      .select("id, content, status, position")
      .eq("session_id", sessionId)
      .eq("id", key)
      .maybeSingle();
    if (data) return data as never;
  }

  // 2) Pure integer → interpret as 1-based index (position). Also handle
  //    prefixes like "#3" or "todo 2". Positions in DB are 0-based, so
  //    user's "1" → position 0. Try (pos-1) first (1-based→0-based),
  //    then raw pos as fallback for legacy 0-based callers.
  const intMatch = key.match(/^#?\s*(?:todo\s*)?(\d{1,3})$/i);
  if (intMatch) {
    const pos = parseInt(intMatch[1], 10);
    for (const p of [pos - 1, pos]) {
      const { data } = await db
        .from("agent_todos")
        .select("id, content, status, position")
        .eq("session_id", sessionId)
        .eq("position", p)
        .maybeSingle();
      if (data) return data as never;
    }
  }

  // 3) Fetch all todos for this session so we can do fuzzy matching
  const { data: allTodos } = await db
    .from("agent_todos")
    .select("id, content, status, position")
    .eq("session_id", sessionId)
    .order("position", { ascending: true });
  if (!allTodos || allTodos.length === 0) return null;

  // Exact (case-insensitive, normalized) match wins first.
  const keyNorm = normalizeContent(key);
  for (const t of allTodos) {
    if (normalizeContent(t.content) === keyNorm) return t as never;
  }

  // Prefix match on normalized content — very common: the model sends the
  // first sentence while the DB has the full content with parenthesised notes.
  const prefixMatches = allTodos.filter((t) => {
    const n = normalizeContent(t.content);
    return n.startsWith(keyNorm) || keyNorm.startsWith(n);
  });
  if (prefixMatches.length === 1) return prefixMatches[0] as never;
  if (prefixMatches.length > 1) {
    const open = prefixMatches.find(
      (m) => m.status !== "completed" && m.status !== "cancelled",
    );
    return (open || prefixMatches[0]) as never;
  }

  // Raw substring match (either direction) on normalized content.
  const substrMatches = allTodos.filter((t) => {
    const n = normalizeContent(t.content);
    return n.includes(keyNorm) || keyNorm.includes(n);
  });
  if (substrMatches.length === 1) return substrMatches[0] as never;
  if (substrMatches.length > 1) {
    const open = substrMatches.find(
      (m) => m.status !== "completed" && m.status !== "cancelled",
    );
    return (open || substrMatches[0]) as never;
  }

  // Token-overlap fuzzy match (Jaccard ≥ 0.5). Handles reordered or slightly
  // edited todo text ("find points faibles" vs "trouver des points faibles").
  const keyTokens = tokenize(key);
  if (keyTokens.length >= 2) {
    const scored = allTodos
      .map((t) => ({ todo: t, score: jaccard(keyTokens, tokenize(t.content)) }))
      .filter((x) => x.score >= 0.5)
      .sort((a, b) => b.score - a.score);
    if (scored.length > 0) {
      // prefer non-completed matches at the top score tier
      const top = scored[0].score;
      const bucket = scored.filter((x) => x.score >= top - 0.001);
      const open = bucket.find(
        (x) => x.todo.status !== "completed" && x.todo.status !== "cancelled",
      );
      return ((open?.todo) || bucket[0].todo) as never;
    }
  }

  return null;
}

registerTool(
  {
    name: "todo_update",
    description:
      "Update the status of a single todo. `id` accepts (in order of preference): the UUID returned by todo_write/todo_read, a 1-based index (\"1\", \"2\", …), a substring of the todo content (punctuation-insensitive, fuzzy), or the alias \"current\" / \"in_progress\" / \"next\" to target the currently-active todo. Use when transitioning pending → in_progress → completed. Prefer 1-based indices — they are the least ambiguous.",
    parameters: {
      id: {
        type: "string",
        description:
          "Todo identifier — UUID, 1-based index (recommended), content substring, or alias (\"current\", \"next\").",
      },
      status: {
        type: "string",
        description: "New status",
        enum: ["pending", "in_progress", "completed", "cancelled"],
      },
    },
    required: ["id", "status"],
    costEstimateCents: 0,
  },
  async (args, context) => {
    const db = getAgentDb();
    const raw = String(args.id || "").trim();
    const status = String(args.status) as Status;
    if (!raw) throw new Error("todo_update: missing id");
    if (!VALID_STATUS.has(status)) {
      throw new Error(`Invalid status: ${status}`);
    }
    if (!context.sessionId) {
      throw new Error("todo_update requires an active session");
    }

    // Convenience aliases: accept "current", "active", "in_progress", "next"
    // to target the currently-active todo without needing its id.
    const aliases = new Set(["current", "active", "in_progress", "in-progress", "next"]);
    let target = null as Awaited<ReturnType<typeof resolveTodoId>>;
    if (aliases.has(raw.toLowerCase())) {
      const { data: openRow } = await db
        .from("agent_todos")
        .select("id, content, status, position")
        .eq("session_id", context.sessionId)
        .in("status", ["in_progress", "pending"])
        .order("status", { ascending: true }) // in_progress first (alphabetical coincidence OK)
        .order("position", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (openRow) target = openRow as never;
    }
    if (!target) target = await resolveTodoId(db, context.sessionId, raw);
    if (!target) {
      // Give the model a useful recovery path. We return short, focused
      // hints (id + position + content preview) rather than the full rows
      // so the model can easily copy the right identifier.
      const { data: all } = await db
        .from("agent_todos")
        .select("id, content, status, position")
        .eq("session_id", context.sessionId)
        .order("position", { ascending: true });
      const hints = (all || []).map((t) => ({
        index: t.position + 1,
        id: t.id,
        status: t.status,
        content:
          t.content.length > 80 ? t.content.slice(0, 77) + "…" : t.content,
      }));
      throw new Error(
        `todo_update: no todo matches "${raw}". ` +
          `Retry with one of: a 1-based index (e.g. "1"), the UUID, ` +
          `or the alias "current" / "in_progress" to target the active todo. ` +
          `Current todos: ${JSON.stringify(hints)}`,
      );
    }

    const { data, error } = await db
      .from("agent_todos")
      .update({ status, updated_at: new Date().toISOString() })
      .eq("id", target.id)
      .eq("session_id", context.sessionId)
      .select("id, content, status, position")
      .single();
    if (error) throw new Error(`todo_update failed: ${error.message}`);
    return data;
  },
);

registerTool(
  {
    name: "todo_update_batch",
    description:
      "Update the status of multiple todos in a single call. Use when transitioning phases (e.g. close several completed todos and open the next one). Each update is resolved with the same matcher as todo_update — prefer 1-based indices.",
    parameters: {
      updates: {
        type: "array",
        description:
          "List of updates, each { id, status }. `id` accepts a UUID, 1-based index, content substring, or alias.",
        items: { type: "object" },
      },
    },
    required: ["updates"],
    costEstimateCents: 0,
  },
  async (args, context) => {
    const db = getAgentDb();
    if (!context.sessionId) {
      throw new Error("todo_update_batch requires an active session");
    }
    const updates = args.updates as Array<{ id?: string; status?: string }>;
    if (!Array.isArray(updates) || updates.length === 0) {
      throw new Error("todo_update_batch: updates must be a non-empty array");
    }

    const out: Array<{ id?: string; status?: string; ok: boolean; error?: string }> = [];
    for (const u of updates) {
      const raw = String(u?.id || "").trim();
      const status = String(u?.status || "") as Status;
      if (!raw || !VALID_STATUS.has(status)) {
        out.push({ id: raw, status, ok: false, error: "invalid id or status" });
        continue;
      }
      const target = await resolveTodoId(db, context.sessionId, raw);
      if (!target) {
        out.push({ id: raw, status, ok: false, error: "no matching todo" });
        continue;
      }
      const { data, error } = await db
        .from("agent_todos")
        .update({ status, updated_at: new Date().toISOString() })
        .eq("id", target.id)
        .eq("session_id", context.sessionId)
        .select("id, content, status, position")
        .single();
      if (error) {
        out.push({ id: raw, status, ok: false, error: error.message });
      } else {
        out.push({ id: data.id, status: data.status, ok: true });
      }
    }
    return { updates: out };
  },
);

registerTool(
  {
    name: "todo_finalize",
    description:
      "Mark every non-cancelled pending/in_progress todo as completed in one call. Use at the END when the overall task is truly delivered so the session can close cleanly.",
    parameters: {
      note: {
        type: "string",
        description: "Optional one-line summary of why it's all done.",
      },
    },
    required: [],
    costEstimateCents: 0,
  },
  async (_args, context) => {
    const db = getAgentDb();
    if (!context.sessionId) {
      throw new Error("todo_finalize requires an active session");
    }
    if (context.leadGenFinalizeGate) {
      const gate = await context.leadGenFinalizeGate();
      if (!gate.ok) {
        throw new Error(
          gate.message ||
            "todo_finalize refusé : livrable CRM non atteint pour cette session.",
        );
      }
    }
    const { data, error } = await db
      .from("agent_todos")
      .update({ status: "completed", updated_at: new Date().toISOString() })
      .eq("session_id", context.sessionId)
      .in("status", ["pending", "in_progress"])
      .select("id, content, status");
    if (error) throw new Error(`todo_finalize failed: ${error.message}`);
    return { completed: data?.length || 0, todos: data || [] };
  },
);

registerTool(
  {
    name: "todo_read",
    description:
      "Return the current todo list for this session, ordered by position.",
    parameters: {},
    required: [],
    costEstimateCents: 0,
  },
  async (_args, context) => {
    const db = getAgentDb();
    const { data, error } = await db
      .from("agent_todos")
      .select("id, content, status, position")
      .eq("session_id", context.sessionId)
      .order("position", { ascending: true });
    if (error) throw new Error(`todo_read failed: ${error.message}`);
    return { todos: data || [] };
  },
);
