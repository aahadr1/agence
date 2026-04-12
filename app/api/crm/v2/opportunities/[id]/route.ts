import { requireCrmContext } from "@/lib/crm/api";
import { parseOpportunityStatus } from "@/lib/crm/service";
import { NextResponse } from "next/server";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const ctx = await requireCrmContext(request);
  if (!ctx.ok) return ctx.response;
  const { id } = await context.params;

  const { data, error } = await ctx.supabase
    .from("crm_opportunities")
    .select(`
      *,
      crm_accounts(*),
      crm_contacts(*)
    `)
    .eq("id", id)
    .eq("org_id", ctx.orgId)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ opportunity: data });
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const ctx = await requireCrmContext(request);
  if (!ctx.ok) return ctx.response;
  const { id } = await context.params;
  const body = (await request.json()) as {
    title?: string;
    description?: string | null;
    amount_cents?: number;
    probability?: number;
    expected_close_date?: string | null;
    owner_user_id?: string | null;
    status?: string;
    loss_reason?: string | null;
    stage_id?: string;
    sort_order?: number;
    tags?: string[];
  };

  const patch: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  if (body.title !== undefined) patch.title = body.title;
  if (body.description !== undefined) patch.description = body.description;
  if (body.amount_cents !== undefined) patch.amount_cents = body.amount_cents;
  if (body.probability !== undefined) patch.probability = body.probability;
  if (body.expected_close_date !== undefined) patch.expected_close_date = body.expected_close_date;
  if (body.owner_user_id !== undefined) patch.owner_user_id = body.owner_user_id;
  if (body.loss_reason !== undefined) patch.loss_reason = body.loss_reason;
  if (body.stage_id !== undefined) patch.stage_id = body.stage_id;
  if (body.sort_order !== undefined) patch.sort_order = body.sort_order;
  if (body.tags !== undefined) patch.tags = body.tags;

  if (body.status !== undefined) {
    const status = parseOpportunityStatus(body.status);
    if (!status) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }
    patch.status = status;
    if (status === "won") patch.won_at = new Date().toISOString();
    if (status === "lost") patch.lost_at = new Date().toISOString();
    if (status === "archived") patch.archived_at = new Date().toISOString();
  }

  const { data: updated, error } = await ctx.supabase
    .from("crm_opportunities")
    .update(patch)
    .eq("id", id)
    .eq("org_id", ctx.orgId)
    .select("*")
    .single();

  if (error || !updated) {
    return NextResponse.json({ error: error?.message || "Update failed" }, { status: 500 });
  }

  return NextResponse.json({ opportunity: updated });
}
