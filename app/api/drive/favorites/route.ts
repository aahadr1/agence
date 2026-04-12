import { buildDriveRequestContext, mapNodeSummaries } from "@/lib/drive/server";
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

  const ctx = await buildDriveRequestContext(supabase, user.id);
  const { data: stars } = await supabase
    .from("drive_stars")
    .select("node_id")
    .eq("user_id", user.id);

  const ids = (stars ?? []).map((row) => String(row.node_id));
  if (!ids.length) {
    return NextResponse.json({ items: [] });
  }

  const { data: nodes } = await supabase
    .from("drive_nodes")
    .select(
      "id, org_id, space_id, parent_id, type, title, content, deleted_at, created_by, updated_at, created_at"
    )
    .eq("org_id", ctx.orgId)
    .is("deleted_at", null)
    .in("id", ids)
    .order("updated_at", { ascending: false });

  return NextResponse.json({ items: await mapNodeSummaries(ctx, nodes ?? []) });
}
