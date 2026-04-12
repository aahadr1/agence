import { requireCrmContext } from "@/lib/crm/api";
import { ensureCrmPipelineForOrg } from "@/lib/crm/service";
import { NextResponse } from "next/server";

function isSchemaDrift(error: { message?: string; details?: string; code?: string }) {
  const haystack =
    `${error.code || ""} ${error.message || ""} ${error.details || ""}`.toLowerCase();
  return (
    haystack.includes("schema cache") ||
    haystack.includes("could not find the table") ||
    error.code === "42P01"
  );
}

export async function GET(request: Request) {
  const ctx = await requireCrmContext(request);
  if (!ctx.ok) {
    return ctx.response;
  }

  try {
    const pipeline = await ensureCrmPipelineForOrg(ctx.supabase, ctx.orgId);
    const [stagesRes, opportunitiesRes, tasksRes] = await Promise.all([
      ctx.supabase
        .from("crm_stages_v2")
        .select("*")
        .eq("pipeline_id", pipeline.id)
        .order("sort_order", { ascending: true }),
      ctx.supabase
        .from("crm_opportunities")
        .select("*")
        .eq("org_id", ctx.orgId)
        .eq("pipeline_id", pipeline.id)
        .neq("status", "archived")
        .order("sort_order", { ascending: true }),
      ctx.supabase
        .from("crm_tasks")
        .select("id, opportunity_id, status, due_at")
        .eq("org_id", ctx.orgId)
        .in("status", ["todo", "in_progress"]),
    ]);

    if (stagesRes.error) {
      throw stagesRes.error;
    }
    if (opportunitiesRes.error) {
      throw opportunitiesRes.error;
    }

    const tasksByOpportunity = new Map<
      string,
      { openTaskCount: number; overdueTaskCount: number }
    >();
    const now = Date.now();
    for (const task of tasksRes.data || []) {
      if (!task.opportunity_id) continue;
      const previous = tasksByOpportunity.get(task.opportunity_id) || {
        openTaskCount: 0,
        overdueTaskCount: 0,
      };
      previous.openTaskCount += 1;
      if (task.due_at && new Date(task.due_at).getTime() < now) {
        previous.overdueTaskCount += 1;
      }
      tasksByOpportunity.set(task.opportunity_id, previous);
    }

    const opportunities = (opportunitiesRes.data || []).map((row) => ({
      ...row,
      ...(tasksByOpportunity.get(row.id) || {
        openTaskCount: 0,
        overdueTaskCount: 0,
      }),
    }));

    return NextResponse.json({
      pipeline,
      stages: stagesRes.data || [],
      opportunities,
    });
  } catch (error) {
    const err = error as { message?: string; details?: string; code?: string };
    if (!isSchemaDrift(err)) {
      return NextResponse.json(
        { error: err.message || "Failed to load CRM board" },
        { status: 500 }
      );
    }

    // Fallback for environments that still run legacy CRM schema (011).
    const { data: legacyPipeline } = await ctx.supabase
      .from("crm_pipelines")
      .select("id,name,is_default")
      .eq("org_id", ctx.orgId)
      .eq("is_default", true)
      .maybeSingle();

    const pipelineId =
      legacyPipeline?.id ??
      (
        await ctx.supabase
          .from("crm_pipelines")
          .select("id,name,is_default")
          .eq("org_id", ctx.orgId)
          .limit(1)
          .maybeSingle()
      ).data?.id;

    if (!pipelineId) {
      return NextResponse.json({
        pipeline: null,
        stages: [],
        opportunities: [],
        fallback: true,
        mode: "legacy",
      });
    }

    const [legacyStagesRes, legacyDealsRes] = await Promise.all([
      ctx.supabase
        .from("crm_stages")
        .select("id,pipeline_id,name,sort_order,color")
        .eq("pipeline_id", pipelineId)
        .order("sort_order", { ascending: true }),
      ctx.supabase
        .from("deals")
        .select("*")
        .eq("org_id", ctx.orgId)
        .eq("pipeline_id", pipelineId)
        .order("sort_order", { ascending: true }),
    ]);

    if (legacyStagesRes.error || legacyDealsRes.error) {
      return NextResponse.json(
        {
          error:
            legacyStagesRes.error?.message ||
            legacyDealsRes.error?.message ||
            "Legacy fallback failed",
        },
        { status: 500 }
      );
    }

    const opportunities = (legacyDealsRes.data || []).map((d) => ({
      id: d.id,
      stage_id: d.stage_id,
      title: d.title,
      owner_user_id: d.owner_user_id,
      amount_cents: d.value_cents || 0,
      source: "legacy",
      openTaskCount: 0,
      overdueTaskCount: 0,
    }));

    return NextResponse.json({
      pipeline: legacyPipeline || { id: pipelineId, name: "Legacy Pipeline", is_default: true },
      stages: legacyStagesRes.data || [],
      opportunities,
      fallback: true,
      mode: "legacy",
    });
  }
}
