import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { authenticateLocalWorker } from "@/lib/agent/local-browser-worker";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: Request) {
  const service = await createServiceClient();
  const worker = await authenticateLocalWorker(
    service,
    req.headers.get("authorization"),
  );
  if (!worker) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const now = new Date().toISOString();
  await service
    .from("agent_local_workers")
    .update({
      status: "online",
      last_seen_at: now,
      user_agent: req.headers.get("user-agent")?.slice(0, 300) || null,
    })
    .eq("id", worker.id);

  await service
    .from("agent_local_browser_jobs")
    .update({
      status: "expired",
      error: "Job expiré avant prise en charge par le worker local.",
      completed_at: now,
    })
    .eq("worker_id", worker.id)
    .eq("status", "pending")
    .lt("expires_at", now);

  const { data: job } = await service
    .from("agent_local_browser_jobs")
    .select("id, session_id, tool_name, args, context, created_at")
    .eq("worker_id", worker.id)
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle<{
      id: string;
      session_id: string;
      tool_name: string;
      args: Record<string, unknown>;
      context: Record<string, unknown>;
      created_at: string;
    }>();

  if (!job) return NextResponse.json({ job: null });

  const { data: claimed, error } = await service
    .from("agent_local_browser_jobs")
    .update({ status: "claimed", claimed_at: now })
    .eq("id", job.id)
    .eq("worker_id", worker.id)
    .eq("status", "pending")
    .select("id, session_id, tool_name, args, context, created_at")
    .maybeSingle();

  if (error || !claimed) return NextResponse.json({ job: null });
  return NextResponse.json({ job: claimed });
}
