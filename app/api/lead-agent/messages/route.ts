import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const missionId = searchParams.get("missionId");
    if (!missionId) return NextResponse.json({ messages: [] });

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ messages: [] });

    const { data: messages, error } = await supabase
      .from("mission_messages")
      .select("*")
      .eq("mission_id", missionId)
      .order("created_at", { ascending: true });

    if (error) return NextResponse.json({ messages: [] });
    return NextResponse.json({ messages: messages || [] });
  } catch {
    return NextResponse.json({ messages: [] });
  }
}

export async function POST(req: Request) {
  try {
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

      try {
        const { inngest } = await import("@/lib/inngest/client");
        await inngest.send({
          name: "lead-agent/mission.start",
          data: { missionId },
        });
      } catch { /* Inngest not configured */ }
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Internal error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
