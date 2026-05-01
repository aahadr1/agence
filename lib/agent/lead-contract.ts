import { getAgentDb } from "./tools/_db";

export interface LeadMissionContract {
  requiresEmail: boolean;
}

const EMAIL_REQUIRED_RE =
  /\b(?:avec|incluant|contenant|qui ont|ayant|trouve(?:r)?|liste(?:r)?)\s+(?:leur\s+|un\s+|des\s+)?(?:e-?mail|emails?|mail|mails?|adresse(?:s)?\s+mail|adresse(?:s)?\s+e-?mail)\b/i;

export async function deriveLeadMissionContract(
  sessionId: string | undefined,
): Promise<LeadMissionContract> {
  if (!sessionId) return { requiresEmail: false };
  try {
    const db = getAgentDb();
    const { data } = await db
      .from("agent_messages")
      .select("content")
      .eq("session_id", sessionId)
      .eq("role", "user")
      .order("created_at", { ascending: true })
      .limit(20);
    const text = (data || []).map((r) => r.content || "").join("\n");
    return { requiresEmail: EMAIL_REQUIRED_RE.test(text) };
  } catch {
    return { requiresEmail: false };
  }
}
