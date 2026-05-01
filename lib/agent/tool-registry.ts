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
import {
  blockSessionTool,
  errorShouldBlockFurtherCalls,
  isSessionToolBlocked,
  sessionToolBlockKey,
} from "./session-tool-blocks";
import { classifyToolFailure } from "./tool-failure-policy";
import { updateWorksetItem } from "./workset-state";

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

const LOOP_SENSITIVE_TOOLS = new Set<string>([
  "google_maps_search",
  "google_search",
  "web_search",
  "web_fetch",
  "website_finder",
  "website_audit",
  "contact_page_scraper",
  "pages_jaunes_search",
  "dirigeant_research",
  "linkedin_profile_search",
  "facebook_page_lookup",
  "fb_ad_library_check",
  "browser_suite",
  "research_suite",
  "pappers_search",
  "societe_com_lookup",
]);

const exactToolCallsBySession = new Map<string, Map<string, number>>();

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return `{${Object.keys(obj)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function repeatedCallCount(
  sessionKey: string | undefined,
  toolName: string,
  args: Record<string, unknown>,
): number {
  if (!sessionKey || !LOOP_SENSITIVE_TOOLS.has(toolName)) return 1;
  let byCall = exactToolCallsBySession.get(sessionKey);
  if (!byCall) {
    byCall = new Map();
    exactToolCallsBySession.set(sessionKey, byCall);
  }
  const key = `${toolName}:${stableStringify(args)}`;
  const count = (byCall.get(key) || 0) + 1;
  byCall.set(key, count);
  return count;
}

function itemTitleFromArgs(args: Record<string, unknown>): string | null {
  return typeof args.business_name === "string"
    ? args.business_name
    : typeof args.title === "string"
      ? args.title
      : typeof args.name === "string"
        ? args.name
        : null;
}

function asResultRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function statusFromResult(result: unknown): string | null {
  const r = asResultRecord(result);
  if (!r) return null;
  if (r.lead_id || r.action === "created" || r.action === "updated") {
    return "saved";
  }
  if (r.owner_name || r.siren || r.siret || r.company_type) {
    return "legal_found";
  }
  if (r.phone || r.email || r.owner_phone || r.owner_email) {
    return "contact_found";
  }
  if (r.has_website || r.website_url) {
    return "active";
  }
  return null;
}

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
  const policy = classifyToolFailure(message, toolName);
  if (policy.retryableSameArgs && !/\[NON_RETRYABLE\]/i.test(message)) {
    return policy.category === "unknown"
      ? message
      : `${message}\n\n[RECOVERY:${policy.category}] ${policy.hintFr}`;
  }
  const tag = /\[NON_RETRYABLE\]/i.test(message) ? "" : "\n\n[NON_RETRYABLE]";
  return `${message}${tag}\n\n[RECOVERY:${policy.category}] ${policy.hintFr}`;
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
          failure_category: tr.error
            ? classifyToolFailure(tr.error, name).category
            : null,
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

  const circuitKey =
    context.orgId && context.sessionId
      ? sessionToolBlockKey(context.orgId, context.sessionId)
      : undefined;
  if (
    circuitKey &&
    isSessionToolBlocked(circuitKey, name)
  ) {
    return finalize({
      name,
      result: null,
      error:
        `Outil « ${name} » court-circuité pour cette session : erreur NON_RETRYABLE déjà rencontrée. ` +
        `Choisis une autre source ou une autre stratégie sans rappeler cet outil.`,
      durationMs: Date.now() - start,
      costCents: 0,
    });
  }

  const repeatCount = repeatedCallCount(circuitKey, name, args);
  if (repeatCount > 2) {
    const message =
      `Outil « ${name} » appelé ${repeatCount} fois avec exactement les mêmes paramètres. ` +
      `[REPEATED_IDENTICAL_CALL] Ne relance pas identiquement : lis le workset/scratchpad, change les paramètres, ou passe à une autre stratégie.`;
    return finalize({
      name,
      result: null,
      error: appendNonRetryHint(message, name),
      durationMs: Date.now() - start,
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
    const itemTitle = itemTitleFromArgs(args);
    const resultRecord = asResultRecord(result);
    if (context.sessionId && itemTitle && resultRecord) {
      try {
        await updateWorksetItem(context.sessionId, {
          title: itemTitle,
          status: statusFromResult(result) || undefined,
          facts: resultRecord,
          source: name,
        });
      } catch {
        /* workset enrichment is best-effort */
      }
    }
    return finalize({
      name,
      result,
      durationMs: Date.now() - start,
      costCents: tool.definition.costEstimateCents || 0,
    });
  } catch (e) {
    const raw = e instanceof Error ? e.message : String(e);
    const hinted = appendNonRetryHint(raw, name);
    const policy = classifyToolFailure(hinted, name);
    const itemTitle = itemTitleFromArgs(args);
    if (context.sessionId && itemTitle) {
      try {
        await updateWorksetItem(context.sessionId, {
          title: itemTitle,
          attempt: {
            tool: name,
            outcome: policy.category,
            summary: hinted.slice(0, 1000),
            retryable: policy.retryableSameArgs,
          },
          blocker: policy.retryableSameArgs ? undefined : policy.hintFr,
          source: name,
        });
      } catch {
        /* workset error tracking is best-effort */
      }
    }
    if (circuitKey && errorShouldBlockFurtherCalls(hinted, name)) {
      blockSessionTool(circuitKey, name);
    }
    return finalize({
      name,
      result: null,
      error: hinted,
      durationMs: Date.now() - start,
      costCents: 0,
    });
  }
}
