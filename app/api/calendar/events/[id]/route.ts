import { ensureAgencyOrgContext } from "@/lib/org/ensure-agency-context";
import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const ctx = await ensureAgencyOrgContext(user.id);
  if (!ctx.ok) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  }

  const patch = await request.json();
  const allowed = [
    "title",
    "description",
    "starts_at",
    "ends_at",
    "event_type",
    "visibility",
    "location",
    "video_link",
    "all_day",
    "timezone",
    "recurrence_rule",
    "recurrence_until",
  ] as const;
  const updates: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  for (const k of allowed) {
    if (patch[k] !== undefined) updates[k] = patch[k];
  }

  const { data, error } = await ctx.admin
    .from("calendar_events")
    .update(updates)
    .eq("id", id)
    .eq("created_by", user.id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (Array.isArray(patch.attendee_ids)) {
    const attendeeIds = Array.from(
      new Set(
        [user.id, ...patch.attendee_ids].filter(
          (value): value is string => typeof value === "string" && value.length > 0
        )
      )
    );

    const { error: deleteError } = await ctx.admin
      .from("calendar_event_attendees")
      .delete()
      .eq("event_id", id);

    if (deleteError) {
      return NextResponse.json({ error: deleteError.message }, { status: 500 });
    }

    if (attendeeIds.length > 0) {
      const { error: insertError } = await ctx.admin
        .from("calendar_event_attendees")
        .insert(
          attendeeIds.map((attendeeId) => ({
            event_id: id,
            user_id: attendeeId,
            response_status: attendeeId === user.id ? "accepted" : "pending",
          }))
        );

      if (insertError) {
        return NextResponse.json({ error: insertError.message }, { status: 500 });
      }
    }
  }

  return NextResponse.json({ event: data });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const ctx = await ensureAgencyOrgContext(user.id);
  if (!ctx.ok) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  }

  const { error } = await ctx.admin
    .from("calendar_events")
    .delete()
    .eq("id", id)
    .eq("created_by", user.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
