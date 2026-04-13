import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { resolveOrgIdForUser } from "@/lib/org/resolve-org";
import { inngest } from "@/lib/inngest/client";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const missionId = searchParams.get("missionId");
  if (!missionId) {
    return NextResponse.json({ error: "missionId required" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: messages, error } = await supabase
    .from("mission_messages")
    .select("*")
    .eq("mission_id", missionId)
    .order("created_at", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ messages });
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { missionId, content } = body as { missionId: string; content: string };

  if (!missionId || !content?.trim()) {
    return NextResponse.json({ error: "missionId and content required" }, { status: 400 });
  }

  const service = await createServiceClient();

  await service.from("mission_messages").insert({
    mission_id: missionId,
    role: "user",
    content: content.trim(),
  });

  const { data: mission } = await service
    .from("missions")
    .select("status")
    .eq("id", missionId)
    .single();

  if (mission?.status === "paused") {
    await service
      .from("missions")
      .update({ status: "running" })
      .eq("id", missionId);

    await inngest.send({
      name: "lead-agent/mission.start",
      data: { missionId },
    });
  }

  return NextResponse.json({ ok: true });
}
