/**
 * MCP adapter boundary — implement `McpAdapter` with your transport (stdio, SSE, HTTP).
 * @see https://modelcontextprotocol.io
 */

export interface McpToolCall {
  serverId: string;
  toolName: string;
  arguments: Record<string, unknown>;
}

export interface McpToolResult {
  ok: boolean;
  content?: unknown;
  error?: string;
}

export interface McpAdapter {
  readonly id: string;
  listTools(): Promise<Array<{ name: string; description?: string }>>;
  invoke(call: McpToolCall): Promise<McpToolResult>;
}
