import { requireCrmContext } from "@/lib/crm/api";
import { NextResponse } from "next/server";

export async function PATCH(request: Request) {
  const ctx = await requireCrmContext(request);
  if (!ctx.ok) return ctx.response;

  const body = await request.json();
  const ids: string[] = Array.isArray(body.ids) ? body.ids : [];
  if (ids.length === 0) {
    return NextResponse.json({ error: "ids array is required" }, { status: 400 });
  }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  let stageChanged = false;

  if (body.stage_id) {
    patch.stage_id = body.stage_id;
    stageChanged = true;
  }
  if (body.owner_user_id !== undefined) {
    patch.owner_user_id = body.owner_user_id || null;
  }
  if (body.status && ["open", "won", "lost", "archived"].includes(body.status)) {
    patch.status = body.status;
    if (body.status === "won") patch.won_at = new Date().toISOString();
    if (body.status === "lost") patch.lost_at = new Date().toISOString();
    if (body.status === "archived") patch.archived_at = new Date().toISOString();
  }
  if (body.add_tag && typeof body.add_tag === "string") {
    const { data: current } = await ctx.supabase
      .from("crm_opportunities")
      .select("id,tags")
      .eq("org_id", ctx.orgId)
      .in("id", ids);

    if (current) {
      for (const row of current) {
        const tags = Array.isArray(row.tags) ? row.tags : [];
        if (!tags.includes(body.add_tag)) {
          await ctx.supabase
            .from("crm_opportunities")
            .update({ tags: [...tags, body.add_tag], updated_at: new Date().toISOString() })
            .eq("id", row.id)
            .eq("org_id", ctx.orgId);
        }
      }
    }
  }

  if (Object.keys(patch).length > 1) {
    const { error } = await ctx.supabase
      .from("crm_opportunities")
      .update(patch)
      .eq("org_id", ctx.orgId)
      .in("id", ids);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  if (stageChanged) {
    const historyRows = ids.map((id) => ({
      org_id: ctx.orgId,
      opportunity_id: id,
      pipeline_id: body.pipeline_id || null,
      from_stage_id: null,
      to_stage_id: body.stage_id,
      changed_by: ctx.userId,
    }));
    await ctx.supabase.from("crm_opportunity_stage_history").insert(historyRows);
  }

  return NextResponse.json({ updated: ids.length });
}
