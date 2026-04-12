import { ensureAgencyOrgContext } from "@/lib/org/ensure-agency-context";
import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const ctx = await ensureAgencyOrgContext(user.id);
  if (!ctx.ok) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  }

  const { orgId, admin } = ctx;

  const { data: members, error: memErr } = await admin
    .from("organization_members")
    .select("user_id")
    .eq("org_id", orgId);

  if (memErr) {
    console.error("[profiles/directory] organization_members", memErr);
    return NextResponse.json({ error: memErr.message }, { status: 500 });
  }

  const ids = (members || []).map((m) => m.user_id);
  if (ids.length === 0) {
    return NextResponse.json({ profiles: [] });
  }

  const { data: profiles, error } = await admin
    .from("profiles")
    .select("user_id, display_name, avatar_url, title, default_status_text")
    .in("user_id", ids);

  if (error) {
    console.error("[profiles/directory] profiles", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ profiles: profiles ?? [] });
}
