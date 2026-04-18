import { getAgentDb } from "../tools/_db";

export async function insertAgentOsSource(params: {
  sessionId: string;
  orgId: string;
  userId: string;
  url: string;
  title?: string | null;
  snippet?: string | null;
  trustScore?: number | null;
  extra?: Record<string, unknown>;
}): Promise<string | null> {
  const db = getAgentDb();
  const { data, error } = await db
    .from("agent_os_sources")
    .insert({
      session_id: params.sessionId,
      org_id: params.orgId,
      user_id: params.userId,
      url: params.url.slice(0, 8000),
      title: params.title?.slice(0, 2000) ?? null,
      snippet: params.snippet?.slice(0, 8000) ?? null,
      trust_score: params.trustScore ?? null,
      extra: params.extra ?? {},
    })
    .select("id")
    .single();
  if (error) {
    console.warn("[agent_os] insertAgentOsSource:", error.message);
    return null;
  }
  return data?.id as string;
}

export async function insertAgentOsArtifact(params: {
  sessionId: string;
  orgId: string;
  userId: string;
  kind: string;
  title?: string | null;
  body?: string | null;
  citations?: unknown[];
}): Promise<string | null> {
  const db = getAgentDb();
  const { data, error } = await db
    .from("agent_os_artifacts")
    .insert({
      session_id: params.sessionId,
      org_id: params.orgId,
      user_id: params.userId,
      kind: params.kind.slice(0, 120),
      title: params.title?.slice(0, 500) ?? null,
      body: params.body?.slice(0, 100_000) ?? null,
      citations: params.citations ?? [],
    })
    .select("id")
    .single();
  if (error) {
    console.warn("[agent_os] insertAgentOsArtifact:", error.message);
    return null;
  }
  return data?.id as string;
}

export async function insertAgentOsDecision(params: {
  sessionId: string;
  orgId: string;
  userId: string;
  decision: string;
  rationale?: string | null;
  riskClass: "green" | "yellow" | "red";
  needsApproval?: boolean;
}): Promise<string | null> {
  const db = getAgentDb();
  const { data, error } = await db
    .from("agent_os_decisions")
    .insert({
      session_id: params.sessionId,
      org_id: params.orgId,
      user_id: params.userId,
      decision: params.decision.slice(0, 4000),
      rationale: params.rationale?.slice(0, 8000) ?? null,
      risk_class: params.riskClass,
      needs_approval: params.needsApproval ?? false,
    })
    .select("id")
    .single();
  if (error) {
    console.warn("[agent_os] insertAgentOsDecision:", error.message);
    return null;
  }
  return data?.id as string;
}

export async function insertAgentAuditLog(params: {
  orgId: string;
  userId: string;
  sessionId: string | null;
  toolName: string;
  riskClass: "green" | "yellow" | "red";
  ok: boolean;
  errorExcerpt?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const db = getAgentDb();
  const { error } = await db.from("agent_audit_log").insert({
    org_id: params.orgId,
    user_id: params.userId,
    session_id: params.sessionId,
    tool_name: params.toolName.slice(0, 200),
    risk_class: params.riskClass,
    ok: params.ok,
    error_excerpt: params.errorExcerpt?.slice(0, 2000) ?? null,
    metadata: params.metadata ?? {},
  });
  if (error) console.warn("[agent_os] insertAgentAuditLog:", error.message);
}
