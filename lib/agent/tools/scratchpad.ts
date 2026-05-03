/**
 * Session-scratchpad stored in `agent_memory` under keys `scratchpad:*`.
 * Survives between ticks (unlike the in-process `context.scratchpad` map).
 */

import { registerTool } from "../tool-registry";
import { getAgentDb } from "./_db";
import { scratchpadStorageKey } from "../scratchpad-storage";

export { scratchpadStorageKey, writeScratchpadText } from "../scratchpad-storage";

registerTool(
  {
    name: "scratchpad_write",
    description:
      "Write a string value under a key in the session scratchpad (persisted in DB — survives ticks). Use for batch candidate tables, tier lists, JSON working sets.",
    parameters: {
      key: { type: "string", description: "Key to store under (short, unique)" },
      value: { type: "string", description: "Value (often JSON.stringify of a table)" },
    },
    required: ["key", "value"],
    costEstimateCents: 0,
  },
  async (args, context) => {
    const db = getAgentDb();
    if (!context.sessionId) throw new Error("scratchpad_write requires a session");
    const key = scratchpadStorageKey(String(args.key));
    const text = String(args.value ?? "");
    const { error } = await db.from("agent_memory").upsert(
      {
        session_id: context.sessionId,
        key,
        value: { text },
        updated_at: new Date().toISOString(),
      },
      { onConflict: "session_id,key" },
    );
    if (error) throw new Error(`scratchpad_write failed: ${error.message}`);
    context.scratchpad.set(String(args.key), text);
    return { stored: true, key: args.key };
  },
);

registerTool(
  {
    name: "scratchpad_read",
    description: "Read a scratchpad value by key. Returns null if missing.",
    parameters: {
      key: { type: "string", description: "Key to read" },
    },
    required: ["key"],
    costEstimateCents: 0,
  },
  async (args, context) => {
    const db = getAgentDb();
    if (!context.sessionId) throw new Error("scratchpad_read requires a session");
    const key = scratchpadStorageKey(String(args.key));
    const { data } = await db
      .from("agent_memory")
      .select("value")
      .eq("session_id", context.sessionId)
      .eq("key", key)
      .maybeSingle();
    let text: string | null = null;
    const raw = data?.value as unknown;
    if (typeof raw === "string") text = raw;
    else if (raw && typeof raw === "object" && "text" in raw) {
      text = String((raw as { text?: unknown }).text ?? "");
    }
    if (text != null) context.scratchpad.set(String(args.key), text);
    return { key: args.key, value: text };
  },
);
