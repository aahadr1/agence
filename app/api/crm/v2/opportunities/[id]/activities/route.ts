import { requireCrmContext } from "@/lib/crm/api";
import { parseActivityType } from "@/lib/crm/service";
import { NextResponse } from "next/server";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const ctx = await requireCrmContext(request);
  if (!ctx.ok) return ctx.response;
  const { id } = await context.params;

  const { data, error } = await ctx.supabase
    .from("crm_activities")
    .select("*")
    .eq("org_id", ctx.orgId)
    .eq("opportunity_id", id)
    .order("happened_at", { ascending: false })
    .limit(100);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ activities: data || [] });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const ctx = await requireCrmContext(request);
  if (!ctx.ok) return ctx.response;
  const { id } = await context.params;

  const body = (await request.json()) as {
    type?: string;
    body?: string;
    metadata?: Record<string, unknown>;
    happened_at?: string;
  };
  const type = parseActivityType(body.type || "note");
  if (!type) return NextResponse.json({ error: "Invalid type" }, { status: 400 });

  const { data, error } = await ctx.supabase
    .from("crm_activities")
    .insert({
      org_id: ctx.orgId,
      opportunity_id: id,
      type,
      body: body.body || null,
      metadata: body.metadata || {},
      happened_at: body.happened_at || new Date().toISOString(),
      created_by: ctx.userId,
    })
    .select("*")
    .single();

  if (error || !data) {
    return NextResponse.json({ error: error?.message || "Insert failed" }, { status: 500 });
  }

  return NextResponse.json({ activity: data });
}
