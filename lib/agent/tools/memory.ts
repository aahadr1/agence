/**
 * Memory tools — durable JSON key/value per session (`agent_memory`).
 * For large string working sets (candidate tables), prefer `scratchpad_*`
 * (same table, `scratchpad:` key prefix). The in-process `context.scratchpad`
 * map is only a same-tick cache mirror.
 */

import { registerTool } from "../tool-registry";
import { getAgentDb } from "./_db";

registerTool(
  {
    name: "memory_write",
    description:
      "Write a value under a key. Overwrites any previous value. Use for facts you'll need later (URLs, IDs, user preferences, decisions).",
    parameters: {
      key: { type: "string", description: "Memory key (short, snake_case)" },
      value: {
        type: "object",
        description:
          "Any JSON-serializable value. Wrap plain strings in { text: '...' }.",
      },
    },
    required: ["key", "value"],
    costEstimateCents: 0,
  },
  async (args, context) => {
    const db = getAgentDb();
    if (!context.sessionId) throw new Error("memory_write requires a session");
    const key = String(args.key).slice(0, 200);
    const value = args.value ?? null;
    const { error } = await db.from("agent_memory").upsert(
      {
        session_id: context.sessionId,
        key,
        value,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "session_id,key" },
    );
    if (error) throw new Error(`memory_write failed: ${error.message}`);
    return { key, ok: true };
  },
);

registerTool(
  {
    name: "memory_read",
    description: "Read a value by key. Returns null if not found.",
    parameters: {
      key: { type: "string", description: "Memory key to read" },
    },
    required: ["key"],
    costEstimateCents: 0,
  },
  async (args, context) => {
    const db = getAgentDb();
    if (!context.sessionId) throw new Error("memory_read requires a session");
    const { data } = await db
      .from("agent_memory")
      .select("key, value, updated_at")
      .eq("session_id", context.sessionId)
      .eq("key", String(args.key))
      .maybeSingle();
    return data || { key: String(args.key), value: null };
  },
);

registerTool(
  {
    name: "memory_list",
    description:
      "List all keys stored in memory for this session, newest first. Values are NOT returned (use memory_read for that).",
    parameters: {},
    required: [],
    costEstimateCents: 0,
  },
  async (_args, context) => {
    const db = getAgentDb();
    if (!context.sessionId) throw new Error("memory_list requires a session");
    const { data } = await db
      .from("agent_memory")
      .select("key, updated_at")
      .eq("session_id", context.sessionId)
      .order("updated_at", { ascending: false })
      .limit(100);
    return { keys: data || [] };
  },
);
