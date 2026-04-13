/**
 * Tool registry: maps tool names to definitions + execute functions.
 * Agents receive a subset of tools based on their role.
 */

import type { AgentContext, ToolDefinition, ToolResult } from "./types";

export type ToolExecuteFn = (
  args: Record<string, unknown>,
  context: AgentContext
) => Promise<unknown>;

interface RegisteredTool {
  definition: ToolDefinition;
  execute: ToolExecuteFn;
}

const registry = new Map<string, RegisteredTool>();

export function registerTool(
  definition: ToolDefinition,
  execute: ToolExecuteFn
) {
  registry.set(definition.name, { definition, execute });
}

export function getTool(name: string): RegisteredTool | undefined {
  return registry.get(name);
}

export function getToolDefinitions(names?: string[]): ToolDefinition[] {
  if (!names) return [...registry.values()].map((t) => t.definition);
  return names
    .map((n) => registry.get(n))
    .filter(Boolean)
    .map((t) => t!.definition);
}

export function getAllToolNames(): string[] {
  return [...registry.keys()];
}

/**
 * Execute a named tool, returning a ToolResult with timing and error handling.
 */
export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  context: AgentContext
): Promise<ToolResult> {
  const tool = registry.get(name);
  if (!tool) {
    return {
      name,
      result: null,
      error: `Unknown tool: ${name}`,
      durationMs: 0,
      costCents: 0,
    };
  }

  const start = Date.now();
  try {
    const result = await tool.execute(args, context);
    return {
      name,
      result,
      durationMs: Date.now() - start,
      costCents: tool.definition.costEstimateCents || 0,
    };
  } catch (e) {
    return {
      name,
      result: null,
      error: e instanceof Error ? e.message : String(e),
      durationMs: Date.now() - start,
      costCents: 0,
    };
  }
}
