/**
 * Tool registry: maps tool names to definitions + execute functions.
 * Agents receive a subset of tools based on their role.
 */

import type { AgentContext, ToolDefinition, ToolResult } from "./types";
import { emitToolEval } from "./os/eval-hooks";
import {
  getToolRiskClass,
  isHardBlockedRedTool,
  isRedToolAllowedFromEnv,
} from "./os/permissions";
import { insertAgentAuditLog } from "./os/store";

async function hasConnection(
  userId: string,
  provider: string,
): Promise<boolean> {
  try {
    const { createClient } = await import("@supabase/supabase-js");
    const db = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } },
    );
    const { data } = await db
      .from("user_connections")
      .select("id")
      .eq("user_id", userId)
      .eq("provider", provider)
      .limit(1)
      .maybeSingle();
    return !!data?.id;
  } catch {
    return false;
  }
}

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
function appendNonRetryHint(message: string, toolName: string): string {
  if (/\[NON_RETRYABLE\]/i.test(message)) return message;
  const m = message.toLowerCase();
  const disk =
    m.includes("64mb") ||
    m.includes("free space") ||
    m.includes("enospc") ||
    m.includes("no space left") ||
    m.includes("sigtrap");
  const schema =
    m.includes("schema cache") ||
    m.includes("42703") ||
    (m.includes("column") && m.includes("does not exist"));
  const nullSearch =
    m.includes("search_id") ||
    (m.includes("23502") && m.includes("null"));
  if (
    disk ||
    schema ||
    nullSearch ||
    (toolName === "pappers_search" && m.includes("401"))
  ) {
    return (
      message +
      "\n\n[NE_PAS_RÉESSAYER avec les mêmes paramètres : corrige la cause (config, disque /tmp, schéma DB, zone) ou change d’outil.]"
    );
  }
  return message;
}

export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  context: AgentContext
): Promise<ToolResult> {
  const start = Date.now();
  const tool = registry.get(name);
  const risk = tool
    ? getToolRiskClass(name, tool.definition)
    : ("green" as const);

  const finalize = async (tr: ToolResult): Promise<ToolResult> => {
    try {
      await insertAgentAuditLog({
        orgId: context.orgId,
        userId: context.userId,
        sessionId: context.sessionId || null,
        toolName: name,
        riskClass: risk,
        ok: !tr.error,
        errorExcerpt: tr.error?.slice(0, 500) ?? null,
        metadata: {
          duration_ms: tr.durationMs,
          cost_cents: tr.costCents,
        },
      });
    } catch {
      /* */
    }
    emitToolEval({
      toolName: name,
      ok: !tr.error,
      durationMs: tr.durationMs,
      sessionId: context.sessionId,
    });
    return tr;
  };

  if (!tool) {
    return finalize({
      name,
      result: null,
      error: `Unknown tool: ${name}`,
      durationMs: 0,
      costCents: 0,
    });
  }

  if (isHardBlockedRedTool(name) && !isRedToolAllowedFromEnv()) {
    return finalize({
      name,
      result: null,
      error:
        `L’outil « ${name} » est classé **red** et désactivé sur cet hôte. ` +
        `Définissez AGENT_ALLOW_RED_TOOLS=1 uniquement si vous acceptez l’exécution (MCP / shell).`,
      durationMs: Date.now() - start,
      costCents: 0,
    });
  }

  try {
    if (tool.definition.requiredConnection) {
      const ok = await hasConnection(
        context.userId,
        tool.definition.requiredConnection,
      );
      if (!ok) {
        return finalize({
          name,
          result: null,
          error: `Missing connection: ${tool.definition.requiredConnection}. Ask the user to connect in Settings → Connections.`,
          durationMs: Date.now() - start,
          costCents: 0,
        });
      }
    }
    const result = await tool.execute(args, context);
    return finalize({
      name,
      result,
      durationMs: Date.now() - start,
      costCents: tool.definition.costEstimateCents || 0,
    });
  } catch (e) {
    const raw = e instanceof Error ? e.message : String(e);
    return finalize({
      name,
      result: null,
      error: appendNonRetryHint(raw, name),
      durationMs: Date.now() - start,
      costCents: 0,
    });
  }
}
