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

  const { data } = await supabase
    .from("drive_nodes")
    .select(
      "id, org_id, space_id, parent_id, type, title, content, deleted_at, created_by, updated_at, created_at"
    )
    .eq("org_id", ctx.orgId)
    .not("deleted_at", "is", null)
    .in("space_id", [ctx.spaces.personal.id, ctx.spaces.shared.id])
    .order("updated_at", { ascending: false });

  return NextResponse.json({ items: await mapNodeSummaries(ctx, data ?? []) });
}
