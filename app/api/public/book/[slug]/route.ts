import { createServiceClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

/** Public: load booking link meta (no auth) */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  let supabase;
  try {
    supabase = await createServiceClient();
  } catch {
    return NextResponse.json(
      { error: "Server misconfiguration: booking service unavailable" },
      { status: 503 }
    );
  }

  const { data: link, error } = await supabase
    .from("booking_links")
    .select("id, title, duration_minutes, user_id, org_id, active")
    .eq("slug", slug)
    .eq("active", true)
    .maybeSingle();

  if (error || !link) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({
    title: link.title,
    durationMinutes: link.duration_minutes,
  });
}

/** Public: propose a slot — creates event as pending confirmation (simplified: direct book) */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const { guestName, guestEmail, starts_at } = await request.json() as {
    guestName?: string;
    guestEmail?: string;
    starts_at?: string;
  };

  if (!starts_at) {
    return NextResponse.json({ error: "starts_at required" }, { status: 400 });
  }

  let supabase;
  try {
    supabase = await createServiceClient();
  } catch {
    return NextResponse.json(
      { error: "Server misconfiguration: booking service unavailable" },
      { status: 503 }
    );
  }
  const { data: link } = await supabase
    .from("booking_links")
    .select("*")
    .eq("slug", slug)
    .eq("active", true)
    .maybeSingle();

  if (!link) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const start = new Date(starts_at);
  const end = new Date(
    start.getTime() + (link.duration_minutes || 30) * 60 * 1000
  );

  const title = guestName
    ? `Réservation: ${guestName}`
    : "Réservation (lien public)";

  const desc =
    guestEmail || guestName
      ? [guestName, guestEmail].filter(Boolean).join(" · ")
      : null;

  const { data: event, error } = await supabase
    .from("calendar_events")
    .insert({
      org_id: link.org_id,
      created_by: link.user_id,
      title,
      description: desc,
      starts_at: start.toISOString(),
      ends_at: end.toISOString(),
      event_type: "demo",
      visibility: "private",
      location: null,
      video_link: null,
    })
    .select()
    .single();

  if (error || !event) {
    return NextResponse.json(
      { error: error?.message || "Booking failed" },
      { status: 500 }
    );
  }

  await supabase.from("calendar_event_attendees").insert({
    event_id: event.id,
    user_id: link.user_id,
    response_status: "pending",
  });

  return NextResponse.json({ ok: true, eventId: event.id });
}
