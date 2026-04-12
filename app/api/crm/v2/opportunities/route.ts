import { requireCrmContext } from "@/lib/crm/api";
import { ensureCrmPipelineForOrg } from "@/lib/crm/service";
import { NextResponse } from "next/server";

function normalizeText(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export async function GET(request: Request) {
  const ctx = await requireCrmContext(request);
  if (!ctx.ok) return ctx.response;
  const { searchParams } = new URL(request.url);
  const stageId = searchParams.get("stageId");
  const ownerId = searchParams.get("ownerId");
  const status = searchParams.get("status");

  let q = ctx.supabase
    .from("crm_opportunities")
    .select("*")
    .eq("org_id", ctx.orgId)
    .order("updated_at", { ascending: false })
    .limit(200);

  if (stageId) q = q.eq("stage_id", stageId);
  if (ownerId) q = q.eq("owner_user_id", ownerId);
  if (status) q = q.eq("status", status);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ opportunities: data || [] });
}

export async function POST(request: Request) {
  const ctx = await requireCrmContext(request);
  if (!ctx.ok) return ctx.response;

  const body = (await request.json()) as {
    title?: string;
    stage_id?: string;
    account_id?: string | null;
    primary_contact_id?: string | null;
    account_name?: string | null;
    website_url?: string | null;
    contact_name?: string | null;
    contact_role?: string | null;
    contact_phone?: string | null;
    contact_email?: string | null;
    amount_cents?: number;
    owner_user_id?: string | null;
    expected_close_date?: string | null;
    source?: string;
    description?: string | null;
    tags?: string[];
  };

  const title = normalizeText(body.title);
  if (!title) {
    return NextResponse.json({ error: "title required" }, { status: 400 });
  }

  const pipeline = await ensureCrmPipelineForOrg(ctx.supabase, ctx.orgId);
  let stageId = body.stage_id;
  if (!stageId) {
    const { data: firstStage } = await ctx.supabase
      .from("crm_stages_v2")
      .select("id")
      .eq("pipeline_id", pipeline.id)
      .order("sort_order", { ascending: true })
      .limit(1)
      .maybeSingle();
    stageId = firstStage?.id;
  }

  if (!stageId) {
    return NextResponse.json({ error: "No stage available" }, { status: 500 });
  }

  const accountName = normalizeText(body.account_name);
  const contactName = normalizeText(body.contact_name);
  const contactRole = normalizeText(body.contact_role);
  const contactPhone = normalizeText(body.contact_phone);
  const contactEmail = normalizeText(body.contact_email);
  const websiteUrl = normalizeText(body.website_url);

  let accountId = body.account_id || null;
  let primaryContactId = body.primary_contact_id || null;

  if (!accountId && accountName) {
    const { data: existingAccount } = await ctx.supabase
      .from("crm_accounts")
      .select("id")
      .eq("org_id", ctx.orgId)
      .ilike("name", accountName)
      .maybeSingle();

    if (existingAccount?.id) {
      accountId = existingAccount.id;
    } else {
      const { data: account, error: accountError } = await ctx.supabase
        .from("crm_accounts")
        .insert({
          org_id: ctx.orgId,
          name: accountName,
          website_url: websiteUrl,
          phone: contactPhone,
          email: contactEmail,
          source: body.source || "manual",
          owner_user_id: body.owner_user_id || ctx.userId,
          created_by: ctx.userId,
        })
        .select("id")
        .single();

      if (accountError || !account) {
        return NextResponse.json(
          { error: accountError?.message || "Unable to create account" },
          { status: 500 }
        );
      }
      accountId = account.id;
    }
  }

  if (!primaryContactId && (contactName || contactPhone || contactEmail)) {
    const fallbackContactName = contactName || accountName || title;
    let contactQuery = ctx.supabase
      .from("crm_contacts")
      .select("id")
      .eq("org_id", ctx.orgId)
      .limit(1);

    if (accountId) {
      contactQuery = contactQuery.eq("account_id", accountId);
    }
    if (contactEmail) {
      contactQuery = contactQuery.eq("email", contactEmail);
    } else if (contactPhone) {
      contactQuery = contactQuery.eq("phone", contactPhone);
    } else {
      contactQuery = contactQuery.ilike("full_name", fallbackContactName);
    }

    const { data: existingContact } = await contactQuery.maybeSingle();
    if (existingContact?.id) {
      primaryContactId = existingContact.id;
    } else {
      const { data: contact, error: contactError } = await ctx.supabase
        .from("crm_contacts")
        .insert({
          org_id: ctx.orgId,
          account_id: accountId,
          full_name: fallbackContactName,
          role: contactRole,
          phone: contactPhone,
          email: contactEmail,
          owner_user_id: body.owner_user_id || ctx.userId,
          created_by: ctx.userId,
        })
        .select("id")
        .single();

      if (contactError || !contact) {
        return NextResponse.json(
          { error: contactError?.message || "Unable to create contact" },
          { status: 500 }
        );
      }
      primaryContactId = contact.id;
    }
  }

  const amountCents =
    typeof body.amount_cents === "number" && Number.isFinite(body.amount_cents)
      ? Math.round(body.amount_cents)
      : 0;
  const tags = Array.isArray(body.tags)
    ? body.tags
        .map((tag) => normalizeText(tag))
        .filter((tag): tag is string => Boolean(tag))
    : [];

  const { data: opportunity, error } = await ctx.supabase
    .from("crm_opportunities")
    .insert({
      org_id: ctx.orgId,
      pipeline_id: pipeline.id,
      stage_id: stageId,
      title,
      description: body.description || null,
      account_id: accountId,
      primary_contact_id: primaryContactId,
      owner_user_id: body.owner_user_id || ctx.userId,
      amount_cents: amountCents,
      expected_close_date: body.expected_close_date || null,
      source: body.source || "manual",
      tags,
      created_by: ctx.userId,
    })
    .select("*")
    .single();

  if (error || !opportunity) {
    return NextResponse.json({ error: error?.message || "Insert failed" }, { status: 500 });
  }

  await ctx.supabase.from("crm_opportunity_stage_history").insert({
    org_id: ctx.orgId,
    opportunity_id: opportunity.id,
    pipeline_id: pipeline.id,
    from_stage_id: null,
    to_stage_id: stageId,
    changed_by: ctx.userId,
  });

  await ctx.supabase.from("crm_activities").insert({
    org_id: ctx.orgId,
    opportunity_id: opportunity.id,
    account_id: opportunity.account_id,
    contact_id: opportunity.primary_contact_id,
    type: "system",
    body:
      accountId || primaryContactId
        ? "Opportunity created with linked prospect details"
        : "Opportunity created",
    created_by: ctx.userId,
  });

  return NextResponse.json({ opportunity });
}
