/**
 * Runtime loader for user-defined custom tools.
 *
 * Custom tools are rows in `agent_custom_tools` with a JS async-function body.
 * They are compiled once (per Node process) and cached. Each invocation is
 * executed inside a Node `vm` context with a TIGHT set of globals:
 *   - fetch, URL, URLSearchParams, Headers, Request, Response, Blob
 *   - console (wired to server console)
 *   - setTimeout, clearTimeout (capped via deadline)
 *   - JSON, Math, Date, Array, Object, String, Number, Boolean, Map, Set
 *
 * Forbidden: require, process, module, global fs/net/child_process.
 *
 * Tools MUST be approved (is_approved = true) before they can be executed.
 * Unapproved rows are invisible to the agent.
 */

import vm from "node:vm";
import { registerTool } from "@/lib/agent/tool-registry";
import type {
  AgentContext,
  ToolDefinition,
  ToolParameter,
} from "@/lib/agent/types";
import { getAgentDb } from "@/lib/agent/tools/_db";

interface CustomToolRow {
  id: string;
  org_id: string;
  name: string;
  description: string;
  parameters: Record<string, ToolParameter>;
  required: string[];
  code: string;
  is_approved: boolean;
  is_disabled: boolean;
  version: number;
}

interface CompiledTool {
  row: CustomToolRow;
  invoke: (args: unknown, ctx: unknown) => Promise<unknown>;
}

/** Global process-wide cache of compiled tools keyed by `${orgId}:${name}` */
const compiledCache = new Map<string, CompiledTool>();

/** Orgs whose tools we've registered in the shared registry this process */
const registeredOrgs = new Set<string>();

/** Max wall-clock a single custom tool invocation may take */
const CUSTOM_TOOL_TIMEOUT_MS = 30_000;

/** Max output size (bytes of JSON) a tool may return */
const CUSTOM_TOOL_MAX_OUTPUT_BYTES = 256_000;

/**
 * Load + compile + register all approved, enabled custom tools for the given
 * org. Returns the list of tool names that were registered (or were already
 * present and validated).
 *
 * Re-registration is idempotent. If the row `version` changed since last
 * registration we recompile.
 */
export async function registerCustomToolsForOrg(
  orgId: string,
): Promise<string[]> {
  try {
    const db = getAgentDb();
    const { data, error } = await db
      .from("agent_custom_tools")
      .select(
        "id, org_id, name, description, parameters, required, code, is_approved, is_disabled, version",
      )
      .eq("org_id", orgId)
      .eq("is_approved", true)
      .eq("is_disabled", false);
    if (error) {
      console.warn("[custom-tools] load error:", error);
      return [];
    }
    const rows = (data || []) as CustomToolRow[];
    const names: string[] = [];
    for (const row of rows) {
      try {
        const cacheKey = `${row.org_id}:${row.name}:${row.version}`;
        let compiled = compiledCache.get(cacheKey);
        if (!compiled) {
          // Invalidate older versions
          for (const k of Array.from(compiledCache.keys())) {
            if (k.startsWith(`${row.org_id}:${row.name}:`)) {
              compiledCache.delete(k);
            }
          }
          compiled = compileCustomTool(row);
          compiledCache.set(cacheKey, compiled);
        }
        // Always (re)register the global registry entry so org-aware dispatch
        // picks up the latest version. The registry is module-scoped; we
        // gate execution per-org at call-time.
        registerDefinition(compiled);
        names.push(row.name);
      } catch (e) {
        console.error(
          `[custom-tools] compile failed for ${row.name}:`,
          e instanceof Error ? e.message : e,
        );
      }
    }
    registeredOrgs.add(orgId);
    return names;
  } catch (e) {
    console.warn("[custom-tools] registerCustomToolsForOrg failed:", e);
    return [];
  }
}

function registerDefinition(compiled: CompiledTool) {
  const row = compiled.row;

  const definition: ToolDefinition = {
    name: row.name,
    description: `[custom] ${row.description}`,
    parameters: row.parameters || {},
    required: row.required || [],
    costEstimateCents: 0,
  };

  registerTool(definition, async (args, context) => {
    // Re-check org permission: only the org that owns the tool can run it
    if (context.orgId !== row.org_id) {
      throw new Error(
        `custom tool '${row.name}' is not available in this org`,
      );
    }
    // Also re-check approval + enabled flags live (operator may have just
    // disabled it between registration and call).
    const db = getAgentDb();
    const { data: live } = await db
      .from("agent_custom_tools")
      .select("is_approved, is_disabled")
      .eq("id", row.id)
      .maybeSingle();
    if (!live || live.is_approved === false || live.is_disabled === true) {
      throw new Error(
        `custom tool '${row.name}' is disabled or awaiting approval`,
      );
    }
    return invokeCompiled(compiled, args, context);
  });
}

function compileCustomTool(row: CustomToolRow): CompiledTool {
  // The user provides either:
  //   (a) a full function body: `async (args, ctx) => { ... }` (single expr)
  //   (b) a statement body that returns: `return await ...;`
  // We detect (a) if the trimmed code starts with `async` or `(`. Else we
  // wrap as (b).
  const raw = row.code.trim();
  const isFn = /^(async\s*)?\(/.test(raw) || /^async\s+function/.test(raw);

  const source = isFn
    ? `module.exports = (${raw});`
    : `module.exports = async function(args, ctx) { ${raw} };`;

  const sandbox: Record<string, unknown> = makeSandbox();
  const script = new vm.Script(source, {
    filename: `custom-tool:${row.name}`,
  });
  const context = vm.createContext(sandbox, {
    name: `custom-tool:${row.name}`,
  });
  const module_ = { exports: null as unknown };
  (context as unknown as { module: unknown }).module = module_;
  script.runInContext(context, { timeout: 1000 });

  const fn = module_.exports as (
    args: unknown,
    ctx: unknown,
  ) => unknown;
  if (typeof fn !== "function") {
    throw new Error("custom tool did not export a function");
  }

  return {
    row,
    invoke: async (args: unknown, ctx: unknown) => {
      const maybe = fn.call(null, args, ctx);
      if (maybe && typeof (maybe as Promise<unknown>).then === "function") {
        return await maybe;
      }
      return maybe;
    },
  };
}

async function invokeCompiled(
  compiled: CompiledTool,
  args: Record<string, unknown>,
  context: AgentContext,
): Promise<unknown> {
  // Provide a minimal, READ-ONLY context projection to the tool
  const safeCtx = {
    sessionId: context.sessionId,
    orgId: context.orgId,
    userId: context.userId,
    capabilityPacks: context.capabilityPacks,
    iterationCount: context.iterationCount,
  };

  const race = Promise.race([
    compiled.invoke(args, safeCtx),
    new Promise((_, reject) =>
      setTimeout(
        () =>
          reject(
            new Error(
              `custom tool '${compiled.row.name}' exceeded ${CUSTOM_TOOL_TIMEOUT_MS}ms`,
            ),
          ),
        CUSTOM_TOOL_TIMEOUT_MS,
      ).unref?.(),
    ),
  ]);

  const result = await race;
  // Guard output size
  try {
    const s = JSON.stringify(result);
    if (s && s.length > CUSTOM_TOOL_MAX_OUTPUT_BYTES) {
      return {
        truncated: true,
        preview: s.slice(0, CUSTOM_TOOL_MAX_OUTPUT_BYTES),
      };
    }
  } catch {
    /* non-serializable output; return as-is */
  }
  return result;
}

function makeSandbox(): Record<string, unknown> {
  const safeConsole = {
    log: (...args: unknown[]) =>
      console.log("[custom-tool]", ...args),
    warn: (...args: unknown[]) =>
      console.warn("[custom-tool]", ...args),
    error: (...args: unknown[]) =>
      console.error("[custom-tool]", ...args),
    info: (...args: unknown[]) =>
      console.info("[custom-tool]", ...args),
  };

  const sandbox: Record<string, unknown> = {
    // Network
    fetch: (input: unknown, init?: unknown) =>
      fetch(input as string | URL, init as RequestInit),
    URL,
    URLSearchParams,
    Headers,
    Request,
    Response,
    Blob,
    AbortController,
    AbortSignal,
    // Stdlib essentials
    console: safeConsole,
    JSON,
    Math,
    Date,
    Array,
    Object,
    String,
    Number,
    Boolean,
    Map,
    Set,
    WeakMap,
    WeakSet,
    Promise,
    Error,
    RangeError,
    TypeError,
    SyntaxError,
    // Timers (capped via outer deadline)
    setTimeout: (fn: (...a: unknown[]) => void, ms: number, ...args: unknown[]) =>
      setTimeout(fn, Math.min(ms, CUSTOM_TOOL_TIMEOUT_MS), ...args),
    clearTimeout,
    // Base globals
    globalThis: null as unknown, // filled below
  };
  // Ensure module.exports surface exists
  (sandbox as Record<string, unknown>).globalThis = sandbox;
  return sandbox;
}
