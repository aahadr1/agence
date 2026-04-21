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
