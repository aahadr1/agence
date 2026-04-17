import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { resolveOrgIdForUser } from "@/lib/org/resolve-org";
import { scheduleNextTick } from "@/lib/agent/runtime/schedule";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ sessions: [] });

  const orgId = await resolveOrgIdForUser(supabase, user.id);
  const service = await createServiceClient();
  const { data, error } = await service
    .from("agent_sessions")
    .select("*")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) {
    console.error("[agent] list sessions error:", error);
    return NextResponse.json({ sessions: [] });
  }
  return NextResponse.json({ sessions: data || [] });
}

export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const orgId = await resolveOrgIdForUser(supabase, user.id);
    const body = (await req.json()) as {
      prompt: string;
      title?: string;
      model?: string;
      capabilityPacks?: string[];
      domainInstructions?: string;
      budgetCapCents?: number;
    };

    if (!body.prompt?.trim()) {
      return NextResponse.json(
        { error: "Prompt is required" },
        { status: 400 },
      );
    }

    const service = await createServiceClient();
    const { data: session, error } = await service
      .from("agent_sessions")
      .insert({
        org_id: orgId,
        user_id: user.id,
        title: body.title || body.prompt.trim().slice(0, 100),
        model: body.model || "gemini-2.5-pro",
        capability_packs: body.capabilityPacks || ["web-research"],
        domain_instructions: body.domainInstructions || null,
        budget_cap_cents: body.budgetCapCents || null,
        status: "pending",
      })
      .select("*")
      .single();

    if (error)
      return NextResponse.json({ error: error.message }, { status: 500 });

    await service.from("agent_messages").insert({
      session_id: session.id,
      role: "user",
      content: body.prompt.trim(),
    });

    await scheduleNextTick(session.id, { delayMs: 0 });

    return NextResponse.json({ session }, { status: 201 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Internal error" },
      { status: 500 },
    );
  }
}
