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
        description:
          "Ordered list of todos. Each item: { content: string, status: pending|in_progress|completed|cancelled }",
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

    type Item = { content: string; status?: Status };
    const items = rawItems as Item[];

    // Replace strategy: delete existing + insert fresh with positions
    await db.from("agent_todos").delete().eq("session_id", context.sessionId);

    const rows = items.map((it, idx) => ({
      session_id: context.sessionId,
      content: String(it.content || "").slice(0, 500),
      status:
        it.status && VALID_STATUS.has(it.status)
          ? it.status
          : ("pending" as Status),
      position: idx,
    }));

    const { data, error } = await db
      .from("agent_todos")
      .insert(rows)
      .select("id, content, status, position");
    if (error) throw new Error(`todo_write failed: ${error.message}`);
    return { count: data?.length || 0, todos: data || [] };
  },
);

registerTool(
  {
    name: "todo_update",
    description:
      "Update the status of a single todo by its id. Use when transitioning pending → in_progress → completed. Do not call todo_write for simple status changes.",
    parameters: {
      id: { type: "string", description: "Todo id" },
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
    const id = String(args.id);
    const status = String(args.status) as Status;
    if (!VALID_STATUS.has(status)) {
      throw new Error(`Invalid status: ${status}`);
    }
    const { data, error } = await db
      .from("agent_todos")
      .update({ status, updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("session_id", context.sessionId)
      .select("id, content, status, position")
      .single();
    if (error) throw new Error(`todo_update failed: ${error.message}`);
    return data;
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
