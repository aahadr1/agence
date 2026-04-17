/**
 * Todo tools — Claude-Code-style structured task list, persisted per session.
 *
 * todo_write  : replace the full list with a new one (most common op).
 * todo_update : change status of a single todo by id.
 * todo_read   : return current list.
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
      "Replace the full todo list for the current session. Use BEFORE executing any task with 3+ discrete steps. Keep exactly one todo in_progress at a time. Pass the FULL list (not a delta).",
    parameters: {
      items: {
        type: "array",
        items: { type: "string" },
        description:
          "Ordered list of todo descriptions (one sentence each). Status is inferred as 'pending' for new items. Use todo_update to change statuses.",
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

  // 2) Pure integer → interpret as 1-based index (position)
  if (/^\d+$/.test(key)) {
    const pos = parseInt(key, 10);
    for (const p of [pos, pos - 1]) {
      const { data } = await db
        .from("agent_todos")
        .select("id, content, status, position")
        .eq("session_id", sessionId)
        .eq("position", p)
        .maybeSingle();
      if (data) return data as never;
    }
  }

  // 3) Case-insensitive content substring
  const { data: matches } = await db
    .from("agent_todos")
    .select("id, content, status, position")
    .eq("session_id", sessionId)
    .ilike("content", `%${key.slice(0, 120)}%`)
    .order("position", { ascending: true });
  if (matches && matches.length === 1) return matches[0] as never;
  if (matches && matches.length > 1) {
    // prefer non-completed matches
    const open = matches.find(
      (m) => m.status !== "completed" && m.status !== "cancelled",
    );
    if (open) return open as never;
    return matches[0] as never;
  }

  return null;
}

registerTool(
  {
    name: "todo_update",
    description:
      "Update the status of a single todo. `id` accepts (in order of preference): the UUID returned by todo_write/todo_read, a 1-based index (\"1\", \"2\", …), or a substring of the todo content. Use when transitioning pending → in_progress → completed.",
    parameters: {
      id: {
        type: "string",
        description:
          "Todo identifier — UUID, 1-based index, or substring of the content.",
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

    const target = await resolveTodoId(db, context.sessionId, raw);
    if (!target) {
      // Give the model a useful recovery path
      const { data: all } = await db
        .from("agent_todos")
        .select("id, content, status, position")
        .eq("session_id", context.sessionId)
        .order("position", { ascending: true });
      throw new Error(
        `todo_update: no todo matches "${raw}". Current todos: ${JSON.stringify(
          all || [],
        )}`,
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
