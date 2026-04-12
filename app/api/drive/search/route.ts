import {
  buildLocationLabels,
  buildDriveRequestContext,
  mapNodeSummaries,
} from "@/lib/drive/server";
import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q")?.trim() ?? "";

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!q) {
    return NextResponse.json({ results: [] });
  }

  const ctx = await buildDriveRequestContext(supabase, user.id);
  const { data, error } = await supabase
    .from("drive_nodes")
    .select(
      "id, org_id, space_id, parent_id, type, title, content, deleted_at, created_by, updated_at, created_at"
    )
    .eq("org_id", ctx.orgId)
    .is("deleted_at", null)
    .in("space_id", [ctx.spaces.personal.id, ctx.spaces.shared.id])
    .ilike("title", `%${q}%`)
    .order("updated_at", { ascending: false })
    .limit(25);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const summaries = await mapNodeSummaries(ctx, data ?? []);
  const locationLabels = await buildLocationLabels(supabase, data ?? []);
  const results = summaries.map((summary) => ({
    ...summary,
    location: locationLabels.get(summary.id) ?? "",
  }));

  return NextResponse.json({ results });
}
