import { requireCrmContext } from "@/lib/crm/api";
import { NextResponse } from "next/server";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const ctx = await requireCrmContext(request);
  if (!ctx.ok) return ctx.response;
  const { id } = await context.params;
  const body = (await request.json()) as { stage_id?: string; sort_order?: number };

  if (!body.stage_id) {
    return NextResponse.json({ error: "stage_id required" }, { status: 400 });
  }

  const { data: existing, error: eErr } = await ctx.supabase
    .from("crm_opportunities")
    .select("id,org_id,pipeline_id,stage_id,sort_order")
    .eq("id", id)
    .eq("org_id", ctx.orgId)
    .single();

  if (eErr || !existing) {
    return NextResponse.json({ error: "Opportunity not found" }, { status: 404 });
  }

  const { data: nextStage, error: stageError } = await ctx.supabase
    .from("crm_stages_v2")
    .select("id,name,is_closed_won,is_closed_lost")
    .eq("id", body.stage_id)
    .eq("pipeline_id", existing.pipeline_id)
    .maybeSingle();

  if (stageError || !nextStage) {
    return NextResponse.json({ error: stageError?.message || "Stage not found" }, { status: 404 });
  }

  const statusPatch = nextStage.is_closed_won
    ? {
        status: "won",
        won_at: new Date().toISOString(),
        lost_at: null,
      }
    : nextStage.is_closed_lost
      ? {
          status: "lost",
          lost_at: new Date().toISOString(),
          won_at: null,
        }
      : {
          status: "open",
          won_at: null,
          lost_at: null,
        };

  const { data: updated, error: uErr } = await ctx.supabase
    .from("crm_opportunities")
    .update({
      stage_id: body.stage_id,
      sort_order: body.sort_order ?? existing.sort_order,
      ...statusPatch,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("org_id", ctx.orgId)
    .select("*")
    .single();

  if (uErr || !updated) {
    return NextResponse.json({ error: uErr?.message || "Move failed" }, { status: 500 });
  }

  await ctx.supabase.from("crm_opportunity_stage_history").insert({
    org_id: ctx.orgId,
    opportunity_id: id,
    pipeline_id: existing.pipeline_id,
    from_stage_id: existing.stage_id,
    to_stage_id: body.stage_id,
    changed_by: ctx.userId,
  });

  await ctx.supabase.from("crm_activities").insert({
    org_id: ctx.orgId,
    opportunity_id: id,
    type: "stage_change",
    body: `Moved to ${nextStage.name}`,
    metadata: {
      from_stage_id: existing.stage_id,
      to_stage_id: body.stage_id,
      status: statusPatch.status,
    },
    created_by: ctx.userId,
  });

  return NextResponse.json({ opportunity: updated });
}
