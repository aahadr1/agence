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

  // Load the session via service client (bypasses RLS) but enforce org check
  // manually to avoid silent RLS filtering caused by is_org_member() edge cases.
  const { data: session } = await service
    .from("agent_sessions")
    .select("*")
    .eq("id", id)
    .eq("org_id", orgId)
    .maybeSingle();

  if (!session)
    return NextResponse.json({ error: "Not found" }, { status: 404 });

  const [messagesRes, todosRes, reflectionsRes, approvalsRes, planRes] =
    await Promise.all([
      service
        .from("agent_messages")
        .select("*")
        .eq("session_id", id)
        .order("created_at", { ascending: true })
        .limit(500),
      service
        .from("agent_todos")
        .select("*")
        .eq("session_id", id)
        .order("position", { ascending: true }),
      service
        .from("agent_reflections")
        .select("*")
        .eq("session_id", id)
        .order("created_at", { ascending: true })
        .limit(100),
      service
        .from("agent_approvals")
        .select("*")
        .eq("session_id", id)
        .order("created_at", { ascending: false }),
      service
        .from("agent_plans")
        .select("*")
        .eq("session_id", id)
        .eq("is_current", true)
        .maybeSingle(),
    ]);

  return NextResponse.json({
    session,
    messages: messagesRes.data || [],
    todos: todosRes.data || [],
    reflections: reflectionsRes.data || [],
    approvals: approvalsRes.data || [],
    plan: planRes.data || null,
  });
}
