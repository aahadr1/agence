import { getAgentDb } from "./tools/_db";
import { parseLeadTargetFromUserPrompt } from "./lead-target";
import type { AgentMessage } from "@/lib/ai/llm-router";
import type { CapabilityPack } from "./types";

export async function countLeadsForAgentSession(
  orgId: string,
  sessionId: string,
): Promise<number> {
  const db = getAgentDb();
  const { count, error } = await db
    .from("leads")
    .select("id", { count: "exact", head: true })
    .eq("org_id", orgId)
    .contains("enrichment_data", { agent_session_id: sessionId });
  if (error) {
    console.warn("[mission-prompt] countLeadsForAgentSession:", error.message);
    return 0;
  }
  return count ?? 0;
}

export async function buildLeadGenMissionContextAppendix(
  orgId: string,
  sessionId: string,
  packs: CapabilityPack[],
  userPrompt: string,
): Promise<string | null> {
  if (!packs.includes("lead-gen-fr")) return null;
  const prompt = userPrompt || "";
  const target = parseLeadTargetFromUserPrompt(prompt);
  const saved = await countLeadsForAgentSession(orgId, sessionId);
  const maxPool = target != null ? Math.min(60, Math.max(30, target * 3)) : 36;
  const lines: string[] = [
    "<MISSION_CONTEXT>",
    `Brief (extrait) : ${prompt.slice(0, 500)}${prompt.length > 500 ? "…" : ""}`,
    `Prospects déjà sauvegardés (CRM, cette session) : ${saved}.`,
  ];
  if (target != null) {
    lines.push(
      `Objectif chiffré : ${target} fiches sauvegardées — prioritaire. Moins seulement si tu documentes précisément les blocages ou homonymes impossibles.`,
      `Découverte Maps : google_maps_search avec max_results=${maxPool} et target_pool_size=${target} pour un vivier suffisant avant enrichissement.`,
    );
  } else {
    lines.push(
      "OBJECTIF par défaut : au moins 1 lead sauvegardé vérifiable, ou clarification honnête.",
      "Découverte : max_results ≥ 30 pour éviter des listes trop courtes.",
    );
  }
  lines.push("</MISSION_CONTEXT>");
  return lines.join("\n");
}

/** Injected each tick — not persisted (rebuilt next tick). */
export function buildContinuationUserMessage(
  prior: AgentMessage[],
  stepNum: number,
): AgentMessage | null {
  if (prior.length < 3 && stepNum <= 1) return null;
  return {
    role: "user",
    parts: [
      {
        type: "text",
        text:
          "[Reprise de session — priorité absolue]\n" +
          `Tick ${stepNum} : tu es au milieu d’une mission. Pas de nouveau « Bonjour », pas de re-lancement du plan en 3 phases depuis zéro. Continue, mets à jour les todos avec todo_update. ` +
          "Remplace la liste de todos (todo_write) uniquement si l’utilisateur a changé la mission / la zone : utilise replace_existing:true + reset_reason qui cite son message.",
      },
    ],
  };
}
