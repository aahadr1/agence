import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { resolveOrgIdForUser } from "@/lib/org/resolve-org";
import {
  generateLocalWorkerToken,
  hashLocalWorkerToken,
} from "@/lib/agent/local-browser-worker";

export const runtime = "nodejs";

function appUrl(req: Request): string {
  const env = process.env.NEXT_PUBLIC_APP_URL;
  if (env && /^https?:\/\//.test(env)) return env.replace(/\/$/, "");
  const origin = req.headers.get("origin");
  if (origin) return origin.replace(/\/$/, "");
  return new URL(req.url).origin;
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { label?: string };
  const orgId = await resolveOrgIdForUser(supabase, user.id);
  const token = generateLocalWorkerToken();
  const service = await createServiceClient();

  const { data: worker, error } = await service
    .from("agent_local_workers")
    .insert({
      org_id: orgId,
      user_id: user.id,
      label: body.label?.trim() || "Worker local",
      token_hash: hashLocalWorkerToken(token),
      status: "created",
    })
    .select("id, label, status, created_at")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const baseUrl = appUrl(req);
  return NextResponse.json({
    worker,
    token,
    appUrl: baseUrl,
    commands: [
      "git clone <votre-repo> agence-worker",
      "cd agence-worker",
      "npm install",
      "npx playwright install chromium",
      `AGENCE_APP_URL="${baseUrl}" AGENCE_WORKER_TOKEN="${token}" npm run worker:local-browser`,
    ],
  });
}
