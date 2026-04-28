import type { ToolResult } from "@/lib/agent/types";

function truncate(text: string, max = 420): string {
  const compact = text.replace(/\s+/g, " ").trim();
  if (compact.length <= max) return compact;
  return `${compact.slice(0, max - 1).trim()}…`;
}

function summarizeObject(value: Record<string, unknown>): string {
  const candidates = value.candidates;
  if (Array.isArray(candidates)) {
    return `${candidates.length} candidat(s) retourné(s).`;
  }

  const results = value.results;
  if (Array.isArray(results)) {
    return `${results.length} résultat(s) retourné(s).`;
  }

  const leads = value.leads;
  if (Array.isArray(leads)) {
    return `${leads.length} prospect(s) traité(s).`;
  }

  const message = value.message || value.summary || value.status;
  if (typeof message === "string" && message.trim()) {
    return truncate(message);
  }

  const keys = Object.keys(value).slice(0, 8);
  if (keys.length > 0) {
    return `Réponse structurée avec ${keys.join(", ")}.`;
  }

  return "Action terminée.";
}

export function summarizeToolResultForTimeline(toolResult: ToolResult): string {
  if (toolResult.error) return truncate(`Échec : ${toolResult.error}`);

  const value = toolResult.result;
  if (value == null) return "Action terminée sans données supplémentaires.";
  if (typeof value === "string") return truncate(value);
  if (typeof value === "number" || typeof value === "boolean") {
    return `Résultat : ${String(value)}.`;
  }
  if (Array.isArray(value)) return `${value.length} élément(s) retourné(s).`;
  if (typeof value === "object") {
    return summarizeObject(value as Record<string, unknown>);
  }

  return "Action terminée.";
}
