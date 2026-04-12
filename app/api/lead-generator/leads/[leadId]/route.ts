import { createClient, createServiceClient } from "@/lib/supabase/server";
import { resolveOrgIdForUser } from "@/lib/org/resolve-org";
import { NextResponse } from "next/server";

const ALLOWED_FIELDS = [
  "pipeline_status",
  "priority_score",
  "targeted_offer",
  "identified_need",
  "estimated_budget",
  "decision_maker_confirmed",
  "first_contact_date",
  "last_contact_date",
  "next_action",
  "next_action_date",
  "contact_channel",
  "contact_attempts",
  "notes",
  "demo_site_created",
  "demo_site_url",
  "quote_sent",
  "quote_amount",
  "prospect_analysis",
] as const;

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ leadId: string }> }
) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { leadId } = await params;
    const body = await request.json();

    const serviceClient = await createServiceClient();

    const { data: dbLead } = await serviceClient
      .from("leads")
      .select("id, org_id")
      .eq("id", leadId)
      .single();

    if (!dbLead) {
      return NextResponse.json({ error: "Lead not found" }, { status: 404 });
    }

    const orgId = await resolveOrgIdForUser(serviceClient, user.id);
    if (dbLead.org_id && dbLead.org_id !== orgId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Only allow whitelisted fields to be updated
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    for (const field of ALLOWED_FIELDS) {
      if (field in body) updates[field] = body[field];
    }

    const { data: updated, error } = await serviceClient
      .from("leads")
      .update(updates)
      .eq("id", leadId)
      .select("*")
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ lead: updated });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Update failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
