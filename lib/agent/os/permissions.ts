import type { ToolDefinition } from "../types";

export type ToolRiskClass = "green" | "yellow" | "red";

/** Blocked unless AGENT_ALLOW_RED_TOOLS=1 (dangerous or unimplemented server-side). */
const RED_BLOCKED_UNLESS_ENV = new Set(["mcp_invoke", "workspace_run_command"]);

const YELLOW_NAMES = new Set([
  "workspace_apply_patch",
  "os_save_artifact",
  "repo_read",
  "repo_list",
  "repo_search",
  "repo_lint",
  "calendar_create_event",
  "save_lead",
  "batch_save_leads",
  "tool_create",
  "memory_write",
  "scratchpad_write",
  "plan_create",
  "plan_revise",
  "learn_record",
]);

export function getToolRiskClass(
  name: string,
  def?: ToolDefinition,
): ToolRiskClass {
  if (def?.riskLevel) return def.riskLevel;
  if (def?.destructive) return "red";
  if (RED_BLOCKED_UNLESS_ENV.has(name)) return "red";
  if (YELLOW_NAMES.has(name)) return "yellow";
  return "green";
}

export function isRedToolAllowedFromEnv(): boolean {
  return String(process.env.AGENT_ALLOW_RED_TOOLS || "")
    .trim()
    .toLowerCase() === "1";
}

export function isHardBlockedRedTool(name: string): boolean {
  return RED_BLOCKED_UNLESS_ENV.has(name);
}
