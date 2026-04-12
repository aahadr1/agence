import { requireCrmContext } from "@/lib/crm/api";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const ctx = await requireCrmContext(request);
  if (!ctx.ok) return ctx.response;
  const body = (await request.json()) as {
    opportunity_id?: string;
    title?: string;
    starts_at?: string;
    ends_at?: string;
    attendee_ids?: string[];
    description?: string;
  };

  if (!body.opportunity_id || !body.title || !body.starts_at || !body.ends_at) {
    return NextResponse.json(
      { error: "opportunity_id, title, starts_at, ends_at required" },
      { status: 400 }
    );
  }

  const { data: opportunity } = await ctx.supabase
    .from("crm_opportunities")
    .select("id,account_id,primary_contact_id")
    .eq("id", body.opportunity_id)
    .eq("org_id", ctx.orgId)
    .maybeSingle();
  if (!opportunity) {
    return NextResponse.json({ error: "Opportunity not found" }, { status: 404 });
  }

  const { data: event, error } = await ctx.supabase
    .from("calendar_events")
    .insert({
      org_id: ctx.orgId,
      created_by: ctx.userId,
      title: body.title,
      description: body.description || null,
      starts_at: body.starts_at,
      ends_at: body.ends_at,
      event_type: "prospect_call",
      visibility: "org",
    })
    .select("*")
    .single();

  if (error || !event) {
    return NextResponse.json({ error: error?.message || "Failed to create event" }, { status: 500 });
  }

  await ctx.supabase.from("calendar_event_links").insert({
    event_id: event.id,
    entity_type: "deal",
    entity_id: body.opportunity_id,
  });

  const attendees = [ctx.userId, ...(body.attendee_ids || [])].filter(
    (id, index, arr) => arr.indexOf(id) === index
  );
  if (attendees.length) {
    await ctx.supabase.from("calendar_event_attendees").insert(
      attendees.map((uid) => ({
        event_id: event.id,
        user_id: uid,
        response_status: uid === ctx.userId ? "accepted" : "pending",
      }))
    );
  }

  const { data: activity } = await ctx.supabase
    .from("crm_activities")
    .insert({
      org_id: ctx.orgId,
      opportunity_id: body.opportunity_id,
      account_id: opportunity.account_id,
      contact_id: opportunity.primary_contact_id,
      type: "meeting",
      body: `Meeting scheduled: ${body.title}`,
      metadata: { calendar_event_id: event.id },
      created_by: ctx.userId,
    })
    .select("*")
    .single();

  if (activity) {
    await ctx.supabase.from("crm_activity_links").insert({
      org_id: ctx.orgId,
      activity_id: activity.id,
      linked_type: "calendar_event",
      linked_id: event.id,
      label: body.title,
    });
  }

  return NextResponse.json({ event, activity: activity || null });
}
