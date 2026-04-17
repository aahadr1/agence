import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

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

  const [sessionRes, messagesRes, todosRes, reflectionsRes, approvalsRes, planRes] =
    await Promise.all([
      supabase.from("agent_sessions").select("*").eq("id", id).maybeSingle(),
      supabase
        .from("agent_messages")
        .select("*")
        .eq("session_id", id)
        .order("created_at", { ascending: true })
        .limit(500),
      supabase
        .from("agent_todos")
        .select("*")
        .eq("session_id", id)
        .order("position", { ascending: true }),
      supabase
        .from("agent_reflections")
        .select("*")
        .eq("session_id", id)
        .order("created_at", { ascending: true })
        .limit(100),
      supabase
        .from("agent_approvals")
        .select("*")
        .eq("session_id", id)
        .order("created_at", { ascending: false }),
      supabase
        .from("agent_plans")
        .select("*")
        .eq("session_id", id)
        .eq("is_current", true)
        .maybeSingle(),
    ]);

  if (!sessionRes.data)
    return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json({
    session: sessionRes.data,
    messages: messagesRes.data || [],
    todos: todosRes.data || [],
    reflections: reflectionsRes.data || [],
    approvals: approvalsRes.data || [],
    plan: planRes.data || null,
  });
}
