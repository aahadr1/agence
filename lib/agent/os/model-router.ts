import type { AgentModel } from "../types";

/**
 * Heuristic model routing: cheap for classification/extraction, strong for synthesis.
 * Wire this where you create sessions or re-run ticks based on user goal keywords.
 */
export function suggestAgentModelForPrompt(
  userPrompt: string,
  defaultModel: AgentModel = "gemini-2.5-pro",
): AgentModel {
  const p = userPrompt.toLowerCase();
  const short = userPrompt.trim().length < 400;
  const trivial =
    short &&
    !/\b(code|debug|refactor|architecture|contrat|legal|synthèse\s+longue|rapport\s+détaillé)\b/i.test(
      p,
    );
  if (trivial) return "gemini-2.5-flash";
  if (/\b(plan|stratégie|architecture|audit\s+complet)\b/i.test(p))
    return "gemini-2.5-pro";
  return defaultModel;
}
