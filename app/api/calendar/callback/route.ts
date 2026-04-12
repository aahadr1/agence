import { resolveOrgIdForUser } from "@/lib/org/resolve-org";
import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

/** Schedule a callback after a call — links optional lead + telephony call */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { starts_at, ends_at, lead_id, call_sid, title } = await request.json() as {
    starts_at: string;
    ends_at?: string;
    lead_id?: string;
    call_sid?: string;
    title?: string;
  };

  if (!starts_at) {
    return NextResponse.json({ error: "starts_at required" }, { status: 400 });
  }

  const orgId = await resolveOrgIdForUser(supabase, user.id);
  const start = new Date(starts_at);
  const end = ends_at
    ? new Date(ends_at)
    : new Date(start.getTime() + 30 * 60 * 1000);

  const { data: event, error } = await supabase
    .from("calendar_events")
    .insert({
      org_id: orgId,
      created_by: user.id,
      title: title || "Rappel — rappeler le prospect",
      description: call_sid ? `Appel: ${call_sid}` : null,
      starts_at: start.toISOString(),
      ends_at: end.toISOString(),
      event_type: "callback",
      visibility: "org",
    })
    .select()
    .single();

  if (error || !event) {
    return NextResponse.json(
      { error: error?.message || "Failed" },
      { status: 500 }
    );
  }

  await supabase.from("calendar_event_attendees").insert({
    event_id: event.id,
    user_id: user.id,
    response_status: "accepted",
  });

  if (lead_id) {
    await supabase.from("calendar_event_links").insert({
      event_id: event.id,
      entity_type: "lead",
      entity_id: lead_id,
    });
  }

  if (call_sid) {
    const { data: callRow } = await supabase
      .from("telephony_calls")
      .select("id")
      .eq("call_sid", call_sid)
      .maybeSingle();
    if (callRow) {
      await supabase.from("calendar_event_links").insert({
        event_id: event.id,
        entity_type: "telephony_call",
        entity_id: callRow.id,
      });
    }
  }

  return NextResponse.json({ event });
}
