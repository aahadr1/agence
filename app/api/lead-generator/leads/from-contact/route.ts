import { createClient, createServiceClient } from "@/lib/supabase/server";
import { resolveOrgIdForUser } from "@/lib/org/resolve-org";
import { NextResponse } from "next/server";

/**
 * POST /api/lead-generator/leads/from-contact
 *
 * Create a new lead from a related LinkedIn contact.
 * Body: { parent_lead_id, name, title?, linkedin_url? }
 */
export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { parent_lead_id, name, title, linkedin_url } = body as {
      parent_lead_id: string;
      name: string;
      title?: string | null;
      linkedin_url?: string | null;
    };

    if (!parent_lead_id || !name?.trim()) {
      return NextResponse.json(
        { error: "parent_lead_id and name are required" },
        { status: 400 }
      );
    }

    const serviceClient = await createServiceClient();
    const orgId = await resolveOrgIdForUser(serviceClient, user.id);

    // Fetch the parent lead for context
    const { data: parent } = await serviceClient
      .from("leads")
      .select("search_id, niche, location, org_id")
      .eq("id", parent_lead_id)
      .single();

    if (!parent) {
      return NextResponse.json({ error: "Parent lead not found" }, { status: 404 });
    }
    if (parent.org_id && parent.org_id !== orgId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { data: newLead, error } = await serviceClient
      .from("leads")
      .insert({
        org_id: orgId,
        search_id: parent.search_id,
        user_id: user.id,
        business_name: name.trim(),
        owner_name: name.trim(),
        owner_role: title || null,
        linkedin_url: linkedin_url || null,
        niche: parent.niche,
        location: parent.location,
        source: "LinkedIn Contact",
        has_website: false,
        enrichment_status: "pending",
        enrichment_data: {
          created_from: "related_contact",
          parent_lead_id,
        },
      })
      .select("*")
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ lead: newLead }, { status: 201 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to create lead";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
