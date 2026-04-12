import { requireCrmContext } from "@/lib/crm/api";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const ctx = await requireCrmContext(request);
  if (!ctx.ok) return ctx.response;

  const { data, error } = await ctx.supabase
    .from("crm_pipelines_v2")
    .select("*, crm_stages_v2(*)")
    .eq("org_id", ctx.orgId)
    .order("created_at", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ pipelines: data || [] });
}

export async function POST(request: Request) {
  const ctx = await requireCrmContext(request);
  if (!ctx.ok) return ctx.response;

  const body = (await request.json()) as { name?: string };
  const name = body.name?.trim();
  if (!name) {
    return NextResponse.json({ error: "name required" }, { status: 400 });
  }

  const { data: pipeline, error: pErr } = await ctx.supabase
    .from("crm_pipelines_v2")
    .insert({ org_id: ctx.orgId, name, is_default: false })
    .select("*")
    .single();

  if (pErr || !pipeline) {
    return NextResponse.json({ error: pErr?.message || "Insert failed" }, { status: 500 });
  }

  await ctx.supabase.from("crm_stages_v2").insert([
    { pipeline_id: pipeline.id, name: "New prospect", sort_order: 0, color: "#64748b" },
    { pipeline_id: pipeline.id, name: "Qualification", sort_order: 1, color: "#a78bfa" },
    { pipeline_id: pipeline.id, name: "Won", sort_order: 2, color: "#22c55e", is_closed_won: true },
    { pipeline_id: pipeline.id, name: "Lost", sort_order: 3, color: "#ef4444", is_closed_lost: true },
  ]);

  return NextResponse.json({ pipeline });
}
