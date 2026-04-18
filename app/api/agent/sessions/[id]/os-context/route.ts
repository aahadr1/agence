import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { resolveOrgIdForUser } from "@/lib/org/resolve-org";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const orgId = await resolveOrgIdForUser(supabase, user.id);
  const service = await createServiceClient();

  const { data: session } = await service
    .from("agent_sessions")
    .select("id")
    .eq("id", id)
    .eq("org_id", orgId)
    .maybeSingle();

  if (!session)
    return NextResponse.json({ error: "Not found" }, { status: 404 });

  const [sources, artifacts, decisions, audit] = await Promise.all([
    service
      .from("agent_os_sources")
      .select("id, url, title, snippet, trust_score, created_at")
      .eq("session_id", id)
      .order("created_at", { ascending: false })
      .limit(80),
    service
      .from("agent_os_artifacts")
      .select("id, kind, title, created_at")
      .eq("session_id", id)
      .order("created_at", { ascending: false })
      .limit(40),
    service
      .from("agent_os_decisions")
      .select("id, decision, rationale, risk_class, needs_approval, created_at")
      .eq("session_id", id)
      .order("created_at", { ascending: false })
      .limit(40),
    service
      .from("agent_audit_log")
      .select("id, tool_name, risk_class, ok, error_excerpt, created_at")
      .eq("session_id", id)
      .order("created_at", { ascending: false })
      .limit(120),
  ]);

  return NextResponse.json({
    sources: sources.data || [],
    artifacts: artifacts.data || [],
    decisions: decisions.data || [],
    audit: audit.data || [],
  });
}
