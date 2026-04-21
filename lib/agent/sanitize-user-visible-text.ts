import { getAllToolNames } from "./tool-registry";

/**
 * Strip pseudo-tool noise from assistant text before persisting/showing to users.
 * Does not alter substantive prose — removes bare tool-name lines common when
 * models emit pseudo-code instead of real FC invocations.
 */
export function sanitizeAssistantUserText(text: string | null | undefined): string {
  if (!text?.trim()) return "";
  let names: string[];
  try {
    names = getAllToolNames();
  } catch {
    names = [];
  }
  const nameSet = new Set(names);

  const lines = text.split("\n");
  const out: string[] = [];
  for (const line of lines) {
    const t = line.trim();
    const strippedTicks = t.replace(/^[`"'«»]+|[`"'«»]+$/g, "").trim();
    const bare = strippedTicks.replace(/\([^)]*\)\s*$/, "").trim();
    if (
      nameSet.has(bare) &&
      strippedTicks.length < 80 &&
      !t.includes(":") &&
      !t.includes("«")
    ) {
      continue;
    }
    if (/^(Réflexion|Observation|Strategy revision|iter\s+\d+)/i.test(t))
      continue;
    out.push(line);
  }
  const joined = out.join("\n").replace(/\n{4,}/g, "\n\n\n").trim();
  return joined.length > 0 ? joined : text.trim();
}
