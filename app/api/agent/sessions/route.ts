import { NextResponse, after } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { resolveOrgIdForUser } from "@/lib/org/resolve-org";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Dispatch the agent run. Tries Inngest first (durable, retries). If Inngest
 * isn't configured or send fails, falls back to running the session inline
 * via `after()` — no durability/retries, but works out of the box.
 */
async function dispatchStart(sessionId: string) {
  if (process.env.INNGEST_EVENT_KEY) {
    try {
      const { inngest } = await import("@/lib/inngest/client");
      await inngest.send({
        name: "agent/session.start",
        data: { sessionId },
      });
      return;
    } catch (e) {
      console.warn("[agent] inngest.send failed, falling back inline:", e);
    }
  }
  after(async () => {
    try {
      const { runSession } = await import(
        "@/lib/inngest/functions/session-run"
      );
      await runSession(sessionId);
    } catch (e) {
      console.error("[agent] inline runSession failed:", e);
    }
  });
}

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ sessions: [] });

  const orgId = await resolveOrgIdForUser(supabase, user.id);
  const { data, error } = await supabase
    .from("agent_sessions")
    .select("*")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) return NextResponse.json({ sessions: [] });
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

    await dispatchStart(session.id);

    return NextResponse.json({ session }, { status: 201 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Internal error" },
      { status: 500 },
    );
  }
}
