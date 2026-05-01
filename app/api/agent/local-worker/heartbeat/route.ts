import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { authenticateLocalWorker } from "@/lib/agent/local-browser-worker";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const service = await createServiceClient();
  const worker = await authenticateLocalWorker(
    service,
    req.headers.get("authorization"),
  );
  if (!worker) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { jobId?: string };
  const now = new Date().toISOString();

  await service
    .from("agent_local_workers")
    .update({
      status: "online",
      last_seen_at: now,
      user_agent: req.headers.get("user-agent")?.slice(0, 300) || null,
    })
    .eq("id", worker.id);

  if (body.jobId) {
    await service
      .from("agent_local_browser_jobs")
      .update({ claimed_at: now })
      .eq("id", body.jobId)
      .eq("worker_id", worker.id)
      .eq("status", "claimed");
  }

  return NextResponse.json({ ok: true, at: now });
}
