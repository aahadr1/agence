import { getAgentDb } from "./tools/_db";
import {
  fetchLeadTargetForSession,
  parseLeadTargetFromText,
} from "@/lib/agent/lead-target";
import { fetchActiveUserBrief } from "@/lib/agent/active-intent";
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

/**
 * @param explicitUserPrompt — pass a string (possibly empty) for legacy `missions`
 *   runs; omit the argument to load the brief from `agent_messages` for this
 *   **agent** session id.
 */
export async function buildLeadGenMissionContextAppendix(
  orgId: string,
  sessionId: string,
  packs: CapabilityPack[],
  explicitUserPrompt?: string | null,
): Promise<string | null> {
  if (!packs.includes("lead-gen-fr")) return null;
  const useInlineMissionPrompt = explicitUserPrompt !== undefined;
  const prompt = useInlineMissionPrompt
    ? (explicitUserPrompt || "").trim() ||
      "(aucun texte de mission — compléter le brief)"
    : await fetchActiveUserBrief(sessionId);
  const target = useInlineMissionPrompt
    ? parseLeadTargetFromText(explicitUserPrompt || "")
    : await fetchLeadTargetForSession(sessionId);
  const saved = await countLeadsForAgentSession(orgId, sessionId);
  const maxPool =
    target != null ? Math.min(60, Math.max(30, target * 3)) : 36;
  const lines: string[] = [
    "<MISSION_CONTEXT>",
    `Brief (extrait) : ${prompt.slice(0, 800)}${prompt.length > 800 ? "…" : ""}`,
    `Prospects déjà sauvegardés (CRM, cette session) : ${saved}.`,
  ];
  if (target != null) {
    lines.push(
      `Objectif chiffré : ${target} fiches sauvegardées via prospect_list.save. Moins seulement si tu documentes précisément les blocages ou homonymes impossibles.`,
      "Avant la découverte, crée un état de tâches durable avec prospect_list action=task_create. Mets-le à jour à chaque début/fin de phase avec action=task_update.",
      `Découverte : utilise prospect_discovery avec target_count=${target} et un vivier d'environ ${maxPool} candidats avant enrichissement.`,
    );
  } else {
    lines.push(
      "OBJECTIF par défaut : au moins 1 lead sauvegardé vérifiable, ou clarification honnête.",
      "Découverte : utilise prospect_discovery avec plusieurs variantes de mots-clés pour éviter des listes trop courtes.",
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
          "[REPRISE DE SESSION]\n" +
          `Tick ${stepNum} : Tu es en cours d'exécution. \n` +
      "- Ne recommence pas avec un nouveau bonjour ou un manifeste.\n" +
      "- Continue depuis les faits déjà collectés.\n" +
      "- Vérifie l'état avec prospect_list action=status si tu hésites.\n" +
      "- Prochaine action utile : prospect_list task_update/status, browser, prospect_discovery, business_research, ou ask_user si une décision utilisateur bloque vraiment.",
      },
    ],
  };
}
