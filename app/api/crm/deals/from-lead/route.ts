import { resolveOrgIdForUser } from "@/lib/org/resolve-org";
import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { leadId } = await request.json();
  if (!leadId) {
    return NextResponse.json({ error: "leadId required" }, { status: 400 });
  }

  const orgId = await resolveOrgIdForUser(supabase, user.id);

  const { data: lead, error: le } = await supabase
    .from("leads")
    .select("*")
    .eq("id", leadId)
    .single();

  if (le || !lead) {
    return NextResponse.json({ error: "Lead not found" }, { status: 404 });
  }

  const { data: existing } = await supabase
    .from("deals")
    .select("id")
    .eq("lead_id", leadId)
    .maybeSingle();

  if (existing) {
    return NextResponse.json({ dealId: existing.id, existing: true });
  }

  const { data: pipeline } = await supabase
    .from("crm_pipelines")
    .select("id")
    .eq("org_id", orgId)
    .eq("is_default", true)
    .maybeSingle();

  const pipelineId =
    pipeline?.id ??
    (
      await supabase
        .from("crm_pipelines")
        .select("id")
        .eq("org_id", orgId)
        .limit(1)
        .maybeSingle()
    ).data?.id;

  if (!pipelineId) {
    return NextResponse.json({ error: "No CRM pipeline" }, { status: 500 });
  }

  const { data: firstStage } = await supabase
    .from("crm_stages")
    .select("id")
    .eq("pipeline_id", pipelineId)
    .order("sort_order", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!firstStage) {
    return NextResponse.json({ error: "No stages" }, { status: 500 });
  }

  const title = lead.business_name as string;
  const phone =
    (lead.owner_phone as string) || (lead.phone as string) || null;
  const email =
    (lead.owner_email as string) || (lead.email as string) || null;
  const contactName = (lead.owner_name as string) || null;
  const niche = (lead.niche as string) || null;

  const { data: deal, error: de } = await supabase
    .from("deals")
    .insert({
      org_id: orgId,
      pipeline_id: pipelineId,
      stage_id: firstStage.id,
      lead_id: leadId,
      title,
      owner_user_id: user.id,
      contact_name: contactName,
      contact_phone: phone,
      contact_email: email,
      niche,
      sort_order: 0,
    })
    .select()
    .single();

  if (de || !deal) {
    return NextResponse.json(
      { error: de?.message || "Failed to create deal" },
      { status: 500 }
    );
  }

  await supabase.from("deal_activities").insert({
    org_id: orgId,
    deal_id: deal.id,
    type: "system",
    payload: { message: "Deal created from lead generator" },
    created_by: user.id,
  });

  return NextResponse.json({ dealId: deal.id, deal });
}
