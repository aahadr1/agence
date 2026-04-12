import { requireCrmContext } from "@/lib/crm/api";
import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

function isMissingSchemaObject(error: {
  code?: string;
  message?: string;
  details?: string;
}) {
  const haystack =
    `${error.code || ""} ${error.message || ""} ${error.details || ""}`.toLowerCase();
  return haystack.includes("schema cache") || haystack.includes("could not find the table");
}

function buildVelocityFromHistory(
  rows: Array<{ opportunity_id: string; to_stage_id: string; changed_at: string }>,
  orgId: string
) {
  const historyByOpp = new Map<
    string,
    Array<{ opportunity_id: string; to_stage_id: string; changed_at: string }>
  >();
  for (const row of rows) {
    const entries = historyByOpp.get(row.opportunity_id) || [];
    entries.push(row);
    historyByOpp.set(row.opportunity_id, entries);
  }

  const now = Date.now();
  return Array.from(historyByOpp.entries()).flatMap(([opportunityId, entries]) =>
    entries.map((row, index) => {
      const enteredAt = new Date(row.changed_at).getTime();
      const next = entries[index + 1];
      const exitedAt = next ? new Date(next.changed_at).getTime() : now;
      return {
        org_id: orgId,
        opportunity_id: opportunityId,
        stage_id: row.to_stage_id,
        entered_at: row.changed_at,
        exited_at: next?.changed_at || null,
        hours_in_stage: Math.max(
          0,
          Math.round((exitedAt - enteredAt) / (1000 * 60 * 60))
        ),
      };
    })
  );
}

async function buildFallbackReporting(
  orgId: string,
  supabase: SupabaseClient
) {
  const [opportunitiesRes, stagesRes, historyRes] = await Promise.all([
    supabase
      .from("crm_opportunities")
      .select("id,pipeline_id,stage_id,owner_user_id,status,amount_cents")
      .eq("org_id", orgId)
      .neq("status", "archived"),
    supabase
      .from("crm_stages_v2")
      .select("id,pipeline_id,name,sort_order")
      .order("sort_order", { ascending: true }),
    supabase
      .from("crm_opportunity_stage_history")
      .select("opportunity_id,to_stage_id,changed_at")
      .eq("org_id", orgId)
      .order("changed_at", { ascending: true }),
  ]);

  if (opportunitiesRes.error || stagesRes.error || historyRes.error) {
    const err = opportunitiesRes.error || stagesRes.error || historyRes.error;
    throw new Error(err?.message || "Fallback reporting query failed");
  }

  const opportunities = opportunitiesRes.data || [];
  const stages = stagesRes.data || [];
  const history = historyRes.data || [];

  const stageMap = new Map(stages.map((s) => [s.id, s]));
  const funnelByStage = new Map<
    string,
    {
      org_id: string;
      pipeline_id: string;
      stage_id: string;
      stage_name: string;
      stage_order: number;
      opportunity_count: number;
      amount_cents: number;
    }
  >();

  const ownerById = new Map<
    string,
    {
      org_id: string;
      owner_user_id: string;
      total_opportunities: number;
      won_count: number;
      lost_count: number;
      won_amount_cents: number;
    }
  >();

  for (const o of opportunities) {
    const stage = stageMap.get(o.stage_id);
    if (stage) {
      const existing = funnelByStage.get(o.stage_id) || {
        org_id: orgId,
        pipeline_id: o.pipeline_id,
        stage_id: o.stage_id,
        stage_name: stage.name,
        stage_order: stage.sort_order,
        opportunity_count: 0,
        amount_cents: 0,
      };
      existing.opportunity_count += 1;
      existing.amount_cents += o.amount_cents || 0;
      funnelByStage.set(o.stage_id, existing);
    }

    if (o.owner_user_id) {
      const owner = ownerById.get(o.owner_user_id) || {
        org_id: orgId,
        owner_user_id: o.owner_user_id,
        total_opportunities: 0,
        won_count: 0,
        lost_count: 0,
        won_amount_cents: 0,
      };
      owner.total_opportunities += 1;
      if (o.status === "won") {
        owner.won_count += 1;
        owner.won_amount_cents += o.amount_cents || 0;
      }
      if (o.status === "lost") {
        owner.lost_count += 1;
      }
      ownerById.set(o.owner_user_id, owner);
    }
  }

  return {
    funnel: Array.from(funnelByStage.values()).sort(
      (a, b) => a.stage_order - b.stage_order
    ),
    ownerPerformance: Array.from(ownerById.values()),
    velocity: buildVelocityFromHistory(history, orgId),
  };
}

export async function GET(request: Request) {
  const ctx = await requireCrmContext(request);
  if (!ctx.ok) return ctx.response;

  const [funnelRes, ownerRes, historyRes, taskRes] = await Promise.all([
    ctx.supabase
      .from("crm_v2_reporting_funnel")
      .select("*")
      .eq("org_id", ctx.orgId)
      .order("stage_order", { ascending: true }),
    ctx.supabase
      .from("crm_v2_reporting_owner_performance")
      .select("*")
      .eq("org_id", ctx.orgId),
    ctx.supabase
      .from("crm_opportunity_stage_history")
      .select("opportunity_id,to_stage_id,changed_at")
      .eq("org_id", ctx.orgId),
    ctx.supabase
      .from("crm_tasks")
      .select("id,status,due_at")
      .eq("org_id", ctx.orgId),
  ]);

  const firstError = funnelRes.error || ownerRes.error || historyRes.error || taskRes.error;
  if (firstError) {
    if (isMissingSchemaObject(firstError)) {
      try {
        const fallback = await buildFallbackReporting(ctx.orgId, ctx.supabase).catch(
          () => ({
            funnel: [],
            ownerPerformance: [],
            velocity: [],
          })
        );
        const now = Date.now();
        const tasks = taskRes.error ? [] : taskRes.data || [];
        const openTasks = tasks.filter(
          (t) => t.status !== "done" && t.status !== "cancelled"
        ).length;
        const overdueTasks = tasks.filter(
          (t) =>
            t.status !== "done" &&
            t.status !== "cancelled" &&
            t.due_at &&
            new Date(t.due_at).getTime() < now
        ).length;
        const completedTasks = tasks.filter((t) => t.status === "done").length;

        return NextResponse.json({
          ...fallback,
          taskSummary: {
            open: openTasks,
            overdue: overdueTasks,
            completed: completedTasks,
          },
          fallback: true,
        });
      } catch {
        return NextResponse.json(
          {
            funnel: [],
            ownerPerformance: [],
            velocity: [],
            taskSummary: { open: 0, overdue: 0, completed: 0 },
            fallback: true,
          },
          { status: 200 }
        );
      }
    }
    return NextResponse.json({ error: firstError.message }, { status: 500 });
  }

  const now = Date.now();
  const tasks = taskRes.data || [];
  const openTasks = tasks.filter((t) => t.status !== "done" && t.status !== "cancelled").length;
  const overdueTasks = tasks.filter(
    (t) =>
      t.status !== "done" &&
      t.status !== "cancelled" &&
      t.due_at &&
      new Date(t.due_at).getTime() < now
  ).length;
  const completedTasks = tasks.filter((t) => t.status === "done").length;

  return NextResponse.json({
    funnel: funnelRes.data || [],
    ownerPerformance: ownerRes.data || [],
    velocity: buildVelocityFromHistory(historyRes.data || [], ctx.orgId),
    taskSummary: {
      open: openTasks,
      overdue: overdueTasks,
      completed: completedTasks,
    },
  });
}
