import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { resolveOrgIdForUser } from "@/lib/org/resolve-org";

export const runtime = "nodejs";

const ONLINE_MS = 75_000;

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ workers: [], online: false });

  const orgId = await resolveOrgIdForUser(supabase, user.id);
  const service = await createServiceClient();
  const { data, error } = await service
    .from("agent_local_workers")
    .select("id, label, status, last_seen_at, user_agent, created_at")
    .eq("org_id", orgId)
    .eq("user_id", user.id)
    .neq("status", "revoked")
    .order("last_seen_at", { ascending: false, nullsFirst: false })
    .limit(5);

  if (error) return NextResponse.json({ workers: [], online: false });

  const workers = (data || []).map((w) => {
    const fresh =
      w.last_seen_at &&
      Date.now() - new Date(w.last_seen_at).getTime() < ONLINE_MS;
    return { ...w, online: Boolean(fresh) };
  });

  return NextResponse.json({
    workers,
    online: workers.some((w) => w.online),
  });
}
