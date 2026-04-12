import { requireCrmContext } from "@/lib/crm/api";
import { NextResponse } from "next/server";

function normalizeText(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const ctx = await requireCrmContext(request);
  if (!ctx.ok) return ctx.response;
  const { id } = await context.params;

  const { data: opportunity, error: oppErr } = await ctx.supabase
    .from("crm_opportunities")
    .select("*")
    .eq("id", id)
    .eq("org_id", ctx.orgId)
    .maybeSingle();
  if (oppErr) return NextResponse.json({ error: oppErr.message }, { status: 500 });
  if (!opportunity) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const [accountRes, contactRes, activitiesRes, tasksRes, linksRes] = await Promise.all([
    opportunity.account_id
      ? ctx.supabase
          .from("crm_accounts")
          .select("*")
          .eq("id", opportunity.account_id)
          .eq("org_id", ctx.orgId)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    opportunity.primary_contact_id
      ? ctx.supabase
          .from("crm_contacts")
          .select("*")
          .eq("id", opportunity.primary_contact_id)
          .eq("org_id", ctx.orgId)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    ctx.supabase
      .from("crm_activities")
      .select("*")
      .eq("org_id", ctx.orgId)
      .eq("opportunity_id", id)
      .order("happened_at", { ascending: false })
      .limit(100),
    ctx.supabase
      .from("crm_tasks")
      .select("*")
      .eq("org_id", ctx.orgId)
      .eq("opportunity_id", id)
      .order("due_at", { ascending: true }),
    ctx.supabase
      .from("calendar_event_links")
      .select("event_id,entity_type,entity_id")
      .eq("entity_type", "deal")
      .eq("entity_id", id),
  ]);

  if (activitiesRes.error || tasksRes.error || linksRes.error) {
    return NextResponse.json(
      { error: activitiesRes.error?.message || tasksRes.error?.message || linksRes.error?.message },
      { status: 500 }
    );
  }

  const activityIds = (activitiesRes.data || []).map((activity) => activity.id);
  let callLinks: Array<{ activity_id: string; linked_id: string; label: string | null }> = [];
  let calls: Array<Record<string, unknown>> = [];

  if (activityIds.length > 0) {
    const { data: linkedCalls, error: linkedCallsError } = await ctx.supabase
      .from("crm_activity_links")
      .select("activity_id,linked_id,label")
      .eq("org_id", ctx.orgId)
      .eq("linked_type", "telephony_call")
      .in("activity_id", activityIds);

    if (linkedCallsError) {
      return NextResponse.json({ error: linkedCallsError.message }, { status: 500 });
    }

    callLinks = linkedCalls || [];
    const callIds = callLinks.map((link) => link.linked_id);
    if (callIds.length > 0) {
      const { data: callRows, error: callsError } = await ctx.supabase
        .from("telephony_calls")
        .select(
          "id,call_sid,from_number,to_number,status,recording_url,recording_duration_sec,transcription,created_at,metadata"
        )
        .eq("org_id", ctx.orgId)
        .in("id", callIds)
        .order("created_at", { ascending: false });

      if (callsError) {
        return NextResponse.json({ error: callsError.message }, { status: 500 });
      }
      calls = callRows || [];
    }
  }

  return NextResponse.json({
    opportunity,
    account: accountRes.data,
    contact: contactRes.data,
    activities: activitiesRes.data || [],
    tasks: tasksRes.data || [],
    calendarLinks: linksRes.data || [],
    callLinks,
    calls,
  });
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const ctx = await requireCrmContext(request);
  if (!ctx.ok) return ctx.response;
  const { id } = await context.params;

  const { data: existingOpportunity, error: opportunityError } = await ctx.supabase
    .from("crm_opportunities")
    .select("*")
    .eq("id", id)
    .eq("org_id", ctx.orgId)
    .maybeSingle();

  if (opportunityError) {
    return NextResponse.json({ error: opportunityError.message }, { status: 500 });
  }
  if (!existingOpportunity) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = (await request.json()) as {
    title?: string;
    description?: string | null;
    amount_cents?: number;
    probability?: number;
    expected_close_date?: string | null;
    owner_user_id?: string | null;
    source?: string | null;
    tags?: string[];
    account_name?: string | null;
    account_phone?: string | null;
    account_email?: string | null;
    website_url?: string | null;
    contact_name?: string | null;
    contact_role?: string | null;
    contact_phone?: string | null;
    contact_email?: string | null;
    contact_linkedin_url?: string | null;
  };

  const opportunityPatch: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  if (body.title !== undefined) {
    const title = normalizeText(body.title);
    if (!title) {
      return NextResponse.json({ error: "title required" }, { status: 400 });
    }
    opportunityPatch.title = title;
  }
  if (body.description !== undefined) opportunityPatch.description = normalizeText(body.description);
  if (body.expected_close_date !== undefined) {
    opportunityPatch.expected_close_date = body.expected_close_date || null;
  }
  if (body.owner_user_id !== undefined) opportunityPatch.owner_user_id = body.owner_user_id || null;
  if (body.source !== undefined) opportunityPatch.source = normalizeText(body.source) || "manual";
  if (body.amount_cents !== undefined) {
    opportunityPatch.amount_cents =
      typeof body.amount_cents === "number" && Number.isFinite(body.amount_cents)
        ? Math.round(body.amount_cents)
        : 0;
  }
  if (body.probability !== undefined) {
    const probability =
      typeof body.probability === "number" && Number.isFinite(body.probability)
        ? Math.max(0, Math.min(100, Math.round(body.probability)))
        : 0;
    opportunityPatch.probability = probability;
  }
  if (body.tags !== undefined) {
    opportunityPatch.tags = Array.isArray(body.tags)
      ? body.tags
          .map((tag) => normalizeText(tag))
          .filter((tag): tag is string => Boolean(tag))
      : [];
  }

  const hasAccountEdits =
    body.account_name !== undefined ||
    body.account_phone !== undefined ||
    body.account_email !== undefined ||
    body.website_url !== undefined;
  const hasContactEdits =
    body.contact_name !== undefined ||
    body.contact_role !== undefined ||
    body.contact_phone !== undefined ||
    body.contact_email !== undefined ||
    body.contact_linkedin_url !== undefined;

  let accountId = existingOpportunity.account_id;
  if (hasAccountEdits) {
    const accountName = normalizeText(body.account_name);
    const accountPatch: Record<string, unknown> = {};
    if (body.account_name !== undefined && accountName) accountPatch.name = accountName;
    if (body.account_phone !== undefined) {
      accountPatch.phone = normalizeText(body.account_phone);
    }
    if (body.account_email !== undefined) {
      accountPatch.email = normalizeText(body.account_email);
    }
    if (body.website_url !== undefined) {
      accountPatch.website_url = normalizeText(body.website_url);
    }

    if (accountId) {
      if (Object.keys(accountPatch).length > 0) {
        accountPatch.updated_at = new Date().toISOString();
        const { error } = await ctx.supabase
          .from("crm_accounts")
          .update(accountPatch)
          .eq("id", accountId)
          .eq("org_id", ctx.orgId);
        if (error) {
          return NextResponse.json({ error: error.message }, { status: 500 });
        }
      }
    } else if (
      accountName ||
      normalizeText(body.account_phone) ||
      normalizeText(body.account_email) ||
      normalizeText(body.website_url)
    ) {
      const { data: createdAccount, error } = await ctx.supabase
        .from("crm_accounts")
        .insert({
          org_id: ctx.orgId,
          name: accountName || normalizeText(body.title) || existingOpportunity.title,
          phone: normalizeText(body.account_phone),
          email: normalizeText(body.account_email),
          website_url: normalizeText(body.website_url),
          source: normalizeText(body.source) || existingOpportunity.source,
          owner_user_id:
            body.owner_user_id !== undefined
              ? body.owner_user_id || null
              : existingOpportunity.owner_user_id,
          created_by: ctx.userId,
        })
        .select("id")
        .single();

      if (error || !createdAccount) {
        return NextResponse.json(
          { error: error?.message || "Unable to create account" },
          { status: 500 }
        );
      }

      accountId = createdAccount.id;
      opportunityPatch.account_id = createdAccount.id;
    }
  }

  let contactId = existingOpportunity.primary_contact_id;
  if (hasContactEdits) {
    const fullName = normalizeText(body.contact_name);
    const contactPatch: Record<string, unknown> = {};
    if (body.contact_name !== undefined && fullName) contactPatch.full_name = fullName;
    if (body.contact_role !== undefined) contactPatch.role = normalizeText(body.contact_role);
    if (body.contact_phone !== undefined) contactPatch.phone = normalizeText(body.contact_phone);
    if (body.contact_email !== undefined) contactPatch.email = normalizeText(body.contact_email);
    if (body.contact_linkedin_url !== undefined) {
      contactPatch.linkedin_url = normalizeText(body.contact_linkedin_url);
    }
    if (accountId && accountId !== existingOpportunity.account_id) {
      contactPatch.account_id = accountId;
    }

    if (contactId) {
      if (Object.keys(contactPatch).length > 0) {
        contactPatch.updated_at = new Date().toISOString();
        const { error } = await ctx.supabase
          .from("crm_contacts")
          .update(contactPatch)
          .eq("id", contactId)
          .eq("org_id", ctx.orgId);
        if (error) {
          return NextResponse.json({ error: error.message }, { status: 500 });
        }
      }
    } else if (
      fullName ||
      normalizeText(body.contact_phone) ||
      normalizeText(body.contact_email)
    ) {
      const { data: createdContact, error } = await ctx.supabase
        .from("crm_contacts")
        .insert({
          org_id: ctx.orgId,
          account_id: accountId,
          full_name:
            fullName ||
            normalizeText(body.account_name) ||
            normalizeText(body.title) ||
            existingOpportunity.title,
          role: normalizeText(body.contact_role),
          phone: normalizeText(body.contact_phone),
          email: normalizeText(body.contact_email),
          linkedin_url: normalizeText(body.contact_linkedin_url),
          owner_user_id:
            body.owner_user_id !== undefined
              ? body.owner_user_id || null
              : existingOpportunity.owner_user_id,
          created_by: ctx.userId,
        })
        .select("id")
        .single();

      if (error || !createdContact) {
        return NextResponse.json(
          { error: error?.message || "Unable to create contact" },
          { status: 500 }
        );
      }

      contactId = createdContact.id;
      opportunityPatch.primary_contact_id = createdContact.id;
    }
  }

  const { data: updatedOpportunity, error: updateError } = await ctx.supabase
    .from("crm_opportunities")
    .update(opportunityPatch)
    .eq("id", id)
    .eq("org_id", ctx.orgId)
    .select("*")
    .single();

  if (updateError || !updatedOpportunity) {
    return NextResponse.json(
      { error: updateError?.message || "Update failed" },
      { status: 500 }
    );
  }

  const [accountRes, contactRes] = await Promise.all([
    updatedOpportunity.account_id
      ? ctx.supabase
          .from("crm_accounts")
          .select("*")
          .eq("id", updatedOpportunity.account_id)
          .eq("org_id", ctx.orgId)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    updatedOpportunity.primary_contact_id
      ? ctx.supabase
          .from("crm_contacts")
          .select("*")
          .eq("id", updatedOpportunity.primary_contact_id)
          .eq("org_id", ctx.orgId)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);

  return NextResponse.json({
    opportunity: updatedOpportunity,
    account: accountRes.data,
    contact: contactRes.data,
  });
}
