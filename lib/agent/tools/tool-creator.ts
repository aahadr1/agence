/**
 * Self-extension tools: let the agent define new tools at runtime.
 *
 * Flow:
 *  1. Agent calls `tool_create({ name, description, parameters, required,
 *     code, scope })`. The tool is persisted as UNAPPROVED.
 *  2. The engine issues a `request_approval` call so a human green-lights it.
 *     (We could auto-approve for trusted orgs later.)
 *  3. Once approved (via the UI or `/api/agent/tools/[id]/approve`), the next
 *     tick picks it up and exposes it as a regular tool.
 *
 * Safety:
 *   - Code is stored but never executed until `is_approved=true`.
 *   - When executed, it runs in a Node `vm` sandbox (see custom-tools.ts).
 *   - We reject names that conflict with built-in tools.
 *   - Length and charset are capped.
 */

import { registerTool, getTool } from "../tool-registry";
import { getAgentDb } from "./_db";

const MAX_CODE_BYTES = 20_000;
const NAME_REGEX = /^[a-z][a-z0-9_]{2,48}$/;

registerTool(
  {
    name: "tool_create",
    description:
      "Define a NEW tool at runtime to extend your own capabilities. The tool is persisted in the database and becomes available in subsequent ticks — but only AFTER a human approves it (safety gate). Use this when you hit a repeated task that no existing tool handles.\n\nThe `code` must be an async JavaScript function body or expression. Examples:\n  code: \"async (args, ctx) => { const r = await fetch(args.url); return await r.text(); }\"\n  code: \"const r = await fetch(args.url); return await r.text();\" (we auto-wrap)\n\nAvailable in sandbox: fetch, URL, URLSearchParams, Headers, JSON, Math, Date, Array, Object, setTimeout, console. NO file system, NO process, NO require. The ctx param gives you { sessionId, orgId, userId }.",
    parameters: {
      name: {
        type: "string",
        description:
          "Lowercase snake_case tool name (3-49 chars, [a-z0-9_]). Must be unique in the org.",
      },
      description: {
        type: "string",
        description:
          "What the tool does. Future you will pick it by name + this description, so be clear.",
      },
      parameters: {
        type: "object",
        description:
          "JSON-schema-like map of parameter name → { type, description, enum?, items? }.",
      },
      required: {
        type: "array",
        items: { type: "string" },
        description: "List of required parameter names.",
      },
      code: {
        type: "string",
        description:
          "Async function code. See tool description for format and sandbox limits.",
      },
      scope: {
        type: "string",
        description:
          "Optional short tag (e.g. 'scraping', 'crm', 'general'). Used for organization.",
      },
    },
    required: ["name", "description", "code"],
    costEstimateCents: 0,
  },
  async (args, context) => {
    const name = String(args.name).toLowerCase().trim();
    if (!NAME_REGEX.test(name)) {
      throw new Error(
        "Invalid tool name. Use lowercase snake_case, 3-49 chars, [a-z0-9_].",
      );
    }
    // Don't allow collisions with builtin tools
    if (getTool(name)) {
      throw new Error(
        `A tool named '${name}' already exists. Choose a different name or call tool_update (not implemented yet).`,
      );
    }
    const code = String(args.code);
    if (!code.trim()) throw new Error("code is required");
    if (code.length > MAX_CODE_BYTES) {
      throw new Error(
        `code too large (${code.length} > ${MAX_CODE_BYTES} bytes)`,
      );
    }

    // Basic banned-patterns check — not exhaustive, the vm sandbox is the
    // real defence in depth.
    const lower = code.toLowerCase();
    for (const banned of [
      "require(",
      "import(",
      "process.",
      "global.",
      "globalthis.",
      "eval(",
      "function constructor",
      "child_process",
      "node:fs",
      "'fs'",
      "\"fs\"",
    ]) {
      if (lower.includes(banned)) {
        throw new Error(
          `Forbidden reference in code: \`${banned}\`. Use the sandboxed globals (fetch, URL, JSON, Date, Math, setTimeout, console) only.`,
        );
      }
    }

    const parameters = isRecord(args.parameters) ? args.parameters : {};
    const required = Array.isArray(args.required)
      ? (args.required as unknown[]).map((r) => String(r))
      : [];
    const scope = String(args.scope || "general").slice(0, 40);
    const description = String(args.description).slice(0, 2000);

    const db = getAgentDb();
    const { data, error } = await db
      .from("agent_custom_tools")
      .insert({
        org_id: context.orgId,
        created_by: context.userId,
        session_id: context.sessionId,
        name,
        description,
        parameters,
        required,
        code,
        scope,
        is_approved: false, // MUST be approved by human
        version: 1,
      })
      .select("id")
      .single();

    if (error) throw new Error(`tool_create failed: ${error.message}`);

    // Also file an approval request so the UI shows a prompt.
    await db.from("agent_approvals").insert({
      session_id: context.sessionId,
      action: `define_custom_tool:${name}`,
      details: `Create new tool '${name}' with description: "${description}". Code size: ${code.length} bytes. The tool will only be callable after you approve it.`,
      risk: "high",
      status: "awaiting",
    });

    return {
      tool_id: data.id,
      name,
      status: "awaiting_approval",
      message:
        "Tool saved. It will be available once a human approves it (an approval request has been filed).",
    };
  },
);

registerTool(
  {
    name: "tool_list_custom",
    description:
      "List all custom tools currently defined in this org (approved, pending, or disabled).",
    parameters: {},
    required: [],
    costEstimateCents: 0,
  },
  async (_args, context) => {
    const db = getAgentDb();
    const { data } = await db
      .from("agent_custom_tools")
      .select(
        "id, name, description, scope, is_approved, is_disabled, version, created_at, updated_at",
      )
      .eq("org_id", context.orgId)
      .order("created_at", { ascending: false })
      .limit(100);
    return { tools: data || [] };
  },
);

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}
