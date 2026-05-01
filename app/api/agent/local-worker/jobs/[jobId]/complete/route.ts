import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { authenticateLocalWorker } from "@/lib/agent/local-browser-worker";

export const runtime = "nodejs";

export async function POST(
  req: Request,
  ctx: { params: Promise<{ jobId: string }> },
) {
  const { jobId } = await ctx.params;
  const service = await createServiceClient();
  const worker = await authenticateLocalWorker(
    service,
    req.headers.get("authorization"),
  );
  if (!worker) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as {
    ok?: boolean;
    result?: unknown;
    error?: string;
  };
  const status = body.ok ? "completed" : "failed";
  const now = new Date().toISOString();
  await service
    .from("agent_local_workers")
    .update({ status: "online", last_seen_at: now })
    .eq("id", worker.id);
  const { error } = await service
    .from("agent_local_browser_jobs")
    .update({
      status,
      result: body.ok ? (body.result ?? null) : null,
      error: body.ok ? null : body.error?.slice(0, 4000) || "Worker failed",
      completed_at: now,
    })
    .eq("id", jobId)
    .eq("worker_id", worker.id)
    .in("status", ["claimed", "pending"]);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
