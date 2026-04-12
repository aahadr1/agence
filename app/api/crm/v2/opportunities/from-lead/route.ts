import { requireCrmContext } from "@/lib/crm/api";
import { createOpportunityFromLeadV2 } from "@/lib/crm/service";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const ctx = await requireCrmContext(request);
  if (!ctx.ok) return ctx.response;
  const body = (await request.json()) as { leadId?: string };
  if (!body.leadId) {
    return NextResponse.json({ error: "leadId required" }, { status: 400 });
  }

  try {
    const result = await createOpportunityFromLeadV2(ctx.supabase, {
      userId: ctx.userId,
      orgId: ctx.orgId,
      leadId: body.leadId,
    });
    return NextResponse.json({
      opportunityId: result.id,
      existing: result.existing,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to create opportunity" },
      { status: 500 }
    );
  }
}
