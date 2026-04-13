import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { resolveOrgIdForUser } from "@/lib/org/resolve-org";
import { inngest } from "@/lib/inngest/client";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const orgId = await resolveOrgIdForUser(supabase, user.id);

  const { data: missions, error } = await supabase
    .from("missions")
    .select("*")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ missions });
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const orgId = await resolveOrgIdForUser(supabase, user.id);
  const body = await req.json();
  const { prompt, budgetCapCents, leadsTarget } = body as {
    prompt: string;
    budgetCapCents?: number;
    leadsTarget?: number;
  };

  if (!prompt?.trim()) {
    return NextResponse.json({ error: "Prompt is required" }, { status: 400 });
  }

  const service = await createServiceClient();

  const { data: mission, error } = await service
    .from("missions")
    .insert({
      org_id: orgId,
      user_id: user.id,
      user_prompt: prompt.trim(),
      budget_cap_cents: budgetCapCents || null,
      leads_target: leadsTarget || null,
      status: "pending",
    })
    .select("*")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await service.from("mission_messages").insert({
    mission_id: mission.id,
    role: "user",
    content: prompt.trim(),
  });

  await inngest.send({
    name: "lead-agent/mission.start",
    data: { missionId: mission.id },
  });

  return NextResponse.json({ mission }, { status: 201 });
}
