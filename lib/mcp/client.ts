import type { McpAdapter, McpToolCall, McpToolResult } from "./types";

/**
 * Registry of MCP servers. Populate from env / DB in production.
 */
const adapters = new Map<string, McpAdapter>();

export function registerMcpAdapter(adapter: McpAdapter) {
  adapters.set(adapter.id, adapter);
}

export async function invokeMcpTool(call: McpToolCall): Promise<McpToolResult> {
  const a = adapters.get(call.serverId);
  if (!a) {
    return {
      ok: false,
      error: `No MCP adapter registered for server_id=${call.serverId}`,
    };
  }
  return a.invoke(call);
}
