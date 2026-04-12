import { ensureAgencyOrgContext } from "@/lib/org/ensure-agency-context";
import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EVENT_TYPES = new Set([
  "prospect_call",
  "demo",
  "internal",
  "deadline",
  "focus_block",
  "callback",
  "other",
]);
const VISIBILITY_TYPES = new Set(["private", "org", "selected_users"]);

function parseIsoParam(value: string | null, label: string) {
  if (!value?.trim()) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    return { error: `Invalid ${label}` } as const;
  }
  return { iso: d.toISOString() } as const;
}

function isSchemaDriftError(error: {
  code?: string;
  message?: string;
  details?: string;
}) {
  const haystack = `${error.code || ""} ${error.message || ""} ${error.details || ""}`.toLowerCase();
  return (
    error.code === "42703" || // undefined_column (Postgres)
    error.code === "PGRST204" || // unknown column in request payload (PostgREST)
    haystack.includes("all_day") ||
    haystack.includes("recurrence_rule") ||
    haystack.includes("recurrence_until") ||
    haystack.includes("timezone")
  );
}

function hasMissingColumn(error: {
  code?: string;
  message?: string;
  details?: string;
}, column: string) {
  const haystack = `${error.code || ""} ${error.message || ""} ${error.details || ""}`.toLowerCase();
  return (
    error.code === "42703" ||
    error.code === "PGRST204" ||
    haystack.includes(column.toLowerCase())
  );
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const fromRaw = searchParams.get("from");
  const toRaw = searchParams.get("to");
  const ownerIdRaw = searchParams.get("ownerId");

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
  const { orgId, admin } = ctx;

  const ownerId = ownerIdRaw?.trim();
  if (ownerId && !UUID_RE.test(ownerId)) {
    return NextResponse.json(
      { error: "Invalid ownerId (expected UUID)" },
      { status: 400 }
    );
  }

  const fromParsed = parseIsoParam(fromRaw, "from");
  const toParsed = parseIsoParam(toRaw, "to");
  if (fromParsed && "error" in fromParsed) {
    return NextResponse.json({ error: fromParsed.error }, { status: 400 });
  }
  if (toParsed && "error" in toParsed) {
    return NextResponse.json({ error: toParsed.error }, { status: 400 });
  }

  const fromIso = fromParsed && "iso" in fromParsed ? fromParsed.iso : null;
  const toIso = toParsed && "iso" in toParsed ? toParsed.iso : null;

  const runGet = async (opts: { useOwner: boolean }) => {
    let q = admin.from("calendar_events").select("*").eq("org_id", orgId);

    if (opts.useOwner && ownerId) {
      q = q.eq("created_by", ownerId);
    }

    /** Overlap with [from, to): starts_at < to AND ends_at > from */
    if (fromIso && toIso) {
      q = q.lt("starts_at", toIso).gt("ends_at", fromIso);
    } else if (fromIso) {
      q = q.gt("ends_at", fromIso);
    } else if (toIso) {
      q = q.lt("starts_at", toIso);
    }

    q = q.order("starts_at", { ascending: true });
    return q.limit(1000);
  };

  let { data, error } = await runGet({ useOwner: true });

  if (error && ownerId && hasMissingColumn(error, "created_by")) {
    const retry = await runGet({ useOwner: false });
    data = retry.data;
    error = retry.error;
  }

  if (error) {
    console.error("[calendar/events GET]", {
      message: error.message,
      code: error.code,
      details: error.details,
      hint: error.hint,
    });
    return NextResponse.json(
      {
        error: error.message,
        code: error.code,
        details: error.details,
      },
      { status: 500 }
    );
  }

  const events = data ?? [];
  if (events.length === 0) {
    return NextResponse.json({ events: [] });
  }

  const eventIds = events
    .map((ev) => (typeof ev.id === "string" ? ev.id : null))
    .filter((id): id is string => Boolean(id));

  const attendeeSet = new Set<string>();
  const attendeeMap = new Map<string, Array<{ user_id: string }>>();
  if (eventIds.length > 0) {
    const { data: attendeeRows, error: attendeeError } = await admin
      .from("calendar_event_attendees")
      .select("event_id, user_id")
      .in("event_id", eventIds);
    if (attendeeError) {
      console.warn("[calendar/events GET] attendees lookup skipped", {
        message: attendeeError.message,
        code: attendeeError.code,
      });
    } else {
      for (const row of attendeeRows ?? []) {
        if (typeof row.event_id !== "string" || typeof row.user_id !== "string") {
          continue;
        }
        const next = attendeeMap.get(row.event_id) ?? [];
        next.push({ user_id: row.user_id });
        attendeeMap.set(row.event_id, next);
        if (row.user_id === user.id) {
          attendeeSet.add(row.event_id);
        }
      }
    }
  }

  // Keep explicit visibility filtering for compatibility with older/misaligned policies.
  const visibleEvents = events.filter((ev) => {
    if (ev.visibility === "org") return true;
    if (ev.created_by === user.id) return true;
    return attendeeSet.has(ev.id);
  });

  return NextResponse.json({
    events: visibleEvents.map((event) => ({
      ...event,
      calendar_event_attendees: attendeeMap.get(event.id) ?? [],
    })),
  });
}

export async function POST(request: Request) {
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
  const { orgId, admin } = ctx;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const {
    title,
    description,
    starts_at,
    ends_at,
    event_type = "internal",
    visibility = "org",
    location,
    video_link,
    attendee_ids = [],
    lead_id,
    deal_id,
    all_day = false,
    timezone = "UTC",
    recurrence_rule,
    recurrence_until,
  } = (body ?? {}) as {
    title: string;
    description?: string;
    starts_at: string;
    ends_at: string;
    event_type?: string;
    visibility?: string;
    location?: string;
    video_link?: string;
    attendee_ids?: string[];
    lead_id?: string;
    deal_id?: string;
    all_day?: boolean;
    timezone?: string;
    recurrence_rule?: string | null;
    recurrence_until?: string | null;
  };

  if (!title || !starts_at || !ends_at) {
    return NextResponse.json(
      { error: "title, starts_at, ends_at required" },
      { status: 400 }
    );
  }

  const parsedStart = new Date(starts_at);
  const parsedEnd = new Date(ends_at);
  if (
    Number.isNaN(parsedStart.getTime()) ||
    Number.isNaN(parsedEnd.getTime()) ||
    parsedEnd.getTime() <= parsedStart.getTime()
  ) {
    return NextResponse.json(
      { error: "Invalid starts_at/ends_at range" },
      { status: 400 }
    );
  }

  const normalizedEventType = EVENT_TYPES.has(event_type) ? event_type : "internal";
  const normalizedVisibility = VISIBILITY_TYPES.has(visibility)
    ? visibility
    : "org";
  const normalizedAttendees = Array.isArray(attendee_ids)
    ? attendee_ids.filter((v): v is string => typeof v === "string" && UUID_RE.test(v))
    : [];

  const buildBaseInsert = (targetOrgId: string) => ({
    org_id: targetOrgId,
    created_by: user.id,
    title: title.trim(),
    description: description || null,
    starts_at: parsedStart.toISOString(),
    ends_at: parsedEnd.toISOString(),
    event_type: normalizedEventType,
    visibility: normalizedVisibility,
    location: location || null,
    video_link: video_link || null,
  });

  const runInsert = async (targetOrgId: string) => {
    const eventId = crypto.randomUUID();
    const baseInsert = buildBaseInsert(targetOrgId);
    const insertCandidates: Record<string, unknown>[] = [
      {
        id: eventId,
        ...baseInsert,
        all_day,
        timezone,
        recurrence_rule: recurrence_rule ?? null,
        recurrence_until: recurrence_until ?? null,
      },
      { id: eventId, ...baseInsert },
      // old/partial schema fallback
      {
        id: eventId,
        created_by: user.id,
        title: title.trim(),
        description: description || null,
        starts_at: parsedStart.toISOString(),
        ends_at: parsedEnd.toISOString(),
        event_type: normalizedEventType,
        visibility: normalizedVisibility,
        location: location || null,
        video_link: video_link || null,
      },
    ];

    let lastError:
      | {
          message?: string;
          code?: string;
          details?: string;
          hint?: string;
        }
      | null = null;
    for (let i = 0; i < insertCandidates.length; i += 1) {
      const candidate = insertCandidates[i];
      const attempt = await admin
        .from("calendar_events")
        .insert(candidate);
      if (!attempt.error) {
        return { eventId, error: null };
      }
      lastError = attempt.error;
      if (!attempt.error) {
        continue;
      }
      // keep trying only on schema mismatch; otherwise stop early
      if (!isSchemaDriftError(attempt.error) && attempt.error.code !== "23503") {
        return { eventId: null, error: attempt.error };
      }
    }

    return { eventId: null, error: lastError };
  };

  const { eventId, error } = await runInsert(orgId);

  if (error || !eventId) {
    console.error("[calendar/events POST]", {
      message: error?.message,
      code: error?.code,
      details: error?.details,
      hint: error?.hint,
    });
    return NextResponse.json(
      {
        error: error?.message || "Insert failed",
        code: error?.code,
        details: error?.details,
      },
      { status: 500 }
    );
  }

  const attendees = [user.id, ...normalizedAttendees].filter(
    (id, i, a) => a.indexOf(id) === i
  );
  if (attendees.length) {
    const { error: attendeesError } = await admin.from("calendar_event_attendees").insert(
      attendees.map((uid) => ({
        event_id: eventId,
        user_id: uid,
        response_status: uid === user.id ? "accepted" : "pending",
      }))
    );
    if (attendeesError) {
      console.warn("[calendar/events POST] attendees insert skipped", {
        message: attendeesError.message,
        code: attendeesError.code,
      });
    }
  }

  if (lead_id && UUID_RE.test(lead_id)) {
    const { error: leadLinkError } = await admin.from("calendar_event_links").insert({
      event_id: eventId,
      entity_type: "lead",
      entity_id: lead_id,
    });
    if (leadLinkError) {
      console.warn("[calendar/events POST] lead link insert skipped", {
        message: leadLinkError.message,
        code: leadLinkError.code,
      });
    }
  }
  if (deal_id && UUID_RE.test(deal_id)) {
    const { error: dealLinkError } = await admin.from("calendar_event_links").insert({
      event_id: eventId,
      entity_type: "deal",
      entity_id: deal_id,
    });
    if (dealLinkError) {
      console.warn("[calendar/events POST] deal link insert skipped", {
        message: dealLinkError.message,
        code: dealLinkError.code,
      });
    }
  }

  return NextResponse.json({
    event: {
      id: eventId,
      org_id: orgId,
      created_by: user.id,
      title: title.trim(),
      starts_at: parsedStart.toISOString(),
      ends_at: parsedEnd.toISOString(),
      event_type: normalizedEventType,
      visibility: normalizedVisibility,
      all_day,
      timezone,
      description: description || null,
      location: location || null,
      video_link: video_link || null,
      recurrence_rule: recurrence_rule ?? null,
      recurrence_until: recurrence_until ?? null,
    },
  });
}
