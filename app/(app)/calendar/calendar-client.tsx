"use client";

import { useAuth } from "@/components/auth/auth-provider";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Link2,
  MapPin,
  Plus,
  Trash2,
  Users2,
  Video,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

type CalendarEvent = {
  id: string;
  title: string;
  description: string | null;
  starts_at: string;
  ends_at: string;
  event_type: string;
  visibility: string;
  location: string | null;
  video_link: string | null;
  all_day: boolean;
  timezone: string;
  created_by: string;
  calendar_event_attendees?: { user_id: string }[];
};

type Profile = {
  user_id: string;
  display_name: string | null;
  avatar_url: string | null;
  title: string | null;
};

type BookingLink = {
  slug: string;
  title: string;
};

type CalendarView = "day" | "month" | "year";

type EventDraft = {
  id: string | null;
  title: string;
  description: string;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  eventType: string;
  visibility: string;
  location: string;
  videoLink: string;
  attendeeIds: string[];
  ownerId: string | null;
};

const DAY_MINUTES = 24 * 60;
const DAY_ROW_HEIGHT = 72;
const USER_COLORS = [
  "#3b82f6",
  "#ef4444",
  "#10b981",
  "#8b5cf6",
  "#f59e0b",
  "#ec4899",
  "#14b8a6",
  "#6366f1",
];

const EVENT_TYPE_LABELS: Record<string, string> = {
  prospect_call: "Prospect",
  demo: "Demo",
  internal: "Interne",
  deadline: "Deadline",
  focus_block: "Focus",
  callback: "Callback",
  other: "Autre",
};

const VISIBILITY_LABELS: Record<string, string> = {
  private: "Privé",
  org: "Équipe",
  selected_users: "Invités",
};

function startOfDay(value: Date) {
  const next = new Date(value);
  next.setHours(0, 0, 0, 0);
  return next;
}

function endOfDay(value: Date) {
  const next = new Date(value);
  next.setHours(23, 59, 59, 999);
  return next;
}

function startOfMonth(value: Date) {
  return new Date(value.getFullYear(), value.getMonth(), 1);
}

function startOfYear(value: Date) {
  return new Date(value.getFullYear(), 0, 1);
}

function endOfYear(value: Date) {
  return new Date(value.getFullYear(), 11, 31, 23, 59, 59, 999);
}

function addDays(value: Date, days: number) {
  const next = new Date(value);
  next.setDate(next.getDate() + days);
  return next;
}

function addMonths(value: Date, months: number) {
  return new Date(value.getFullYear(), value.getMonth() + months, value.getDate());
}

function addYears(value: Date, years: number) {
  return new Date(value.getFullYear() + years, value.getMonth(), value.getDate());
}

function isSameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function dateKey(value: Date) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(
    value.getDate()
  ).padStart(2, "0")}`;
}

function toLocalDateTimeInput(value: string) {
  const date = new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function toLocalDateInput(value: string) {
  const date = new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function toIsoFromDraft(value: string, allDay: boolean, end = false) {
  if (!allDay) return new Date(value).toISOString();
  const local = new Date(`${value}T${end ? "23:59:00" : "00:00:00"}`);
  return local.toISOString();
}

function formatHeaderDate(value: Date, view: CalendarView) {
  if (view === "year") {
    return value.toLocaleDateString("fr-FR", { year: "numeric" });
  }
  if (view === "day") {
    return value.toLocaleDateString("fr-FR", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  }
  return value.toLocaleDateString("fr-FR", {
    month: "long",
    year: "numeric",
  });
}

function formatTimeRange(event: CalendarEvent) {
  if (event.all_day) return "Toute la journée";
  return `${new Date(event.starts_at).toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
  })} - ${new Date(event.ends_at).toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
  })}`;
}

function getMonthGrid(value: Date) {
  const monthStart = startOfMonth(value);
  const startShift = (monthStart.getDay() + 6) % 7;
  const gridStart = addDays(monthStart, -startShift);
  return Array.from({ length: 42 }, (_, index) => addDays(gridStart, index));
}

function getVisibleOwnerId(event: CalendarEvent) {
  return event.created_by;
}

function getEventParticipantIds(event: CalendarEvent) {
  const attendeeIds = event.calendar_event_attendees?.map((entry) => entry.user_id) ?? [];
  return Array.from(new Set([event.created_by, ...attendeeIds]));
}

function buildDraft(date: Date, ownerId: string | null): EventDraft {
  const start = new Date(date);
  const end = new Date(date);
  end.setHours(end.getHours() + 1);

  return {
    id: null,
    title: "",
    description: "",
    startsAt: toLocalDateTimeInput(start.toISOString()),
    endsAt: toLocalDateTimeInput(end.toISOString()),
    allDay: false,
    eventType: "internal",
    visibility: "org",
    location: "",
    videoLink: "",
    attendeeIds: ownerId ? [ownerId] : [],
    ownerId,
  };
}

function buildDraftFromEvent(event: CalendarEvent): EventDraft {
  return {
    id: event.id,
    title: event.title,
    description: event.description ?? "",
    startsAt: event.all_day
      ? toLocalDateInput(event.starts_at)
      : toLocalDateTimeInput(event.starts_at),
    endsAt: event.all_day
      ? toLocalDateInput(event.ends_at)
      : toLocalDateTimeInput(event.ends_at),
    allDay: event.all_day,
    eventType: event.event_type,
    visibility: event.visibility,
    location: event.location ?? "",
    videoLink: event.video_link ?? "",
    attendeeIds: getEventParticipantIds(event),
    ownerId: event.created_by,
  };
}

function clampMinutes(value: number) {
  return Math.max(0, Math.min(DAY_MINUTES, value));
}

function listEventDays(event: CalendarEvent) {
  const start = startOfDay(new Date(event.starts_at));
  const end = startOfDay(new Date(event.ends_at));
  const days: string[] = [];
  let cursor = start;
  let guard = 0;
  while (cursor <= end && guard < 370) {
    days.push(dateKey(cursor));
    cursor = addDays(cursor, 1);
    guard += 1;
  }
  return days;
}

function buildDayLayouts(events: CalendarEvent[], selectedDate: Date) {
  const start = startOfDay(selectedDate).getTime();
  const end = endOfDay(selectedDate).getTime();
  const sameDay = events
    .filter((event) => {
      const eventStart = new Date(event.starts_at).getTime();
      const eventEnd = new Date(event.ends_at).getTime();
      return eventStart < end && eventEnd > start && !event.all_day;
    })
    .sort(
      (left, right) =>
        new Date(left.starts_at).getTime() - new Date(right.starts_at).getTime()
    );

  const layouts: Array<{
    event: CalendarEvent;
    top: number;
    height: number;
    left: number;
    width: number;
  }> = [];

  let cluster: CalendarEvent[] = [];
  let clusterEnd = 0;

  const flushCluster = () => {
    if (cluster.length === 0) return;

    const columns: CalendarEvent[][] = [];
    const assignments = new Map<string, number>();

    cluster.forEach((event) => {
      const eventStart = new Date(event.starts_at).getTime();
      let columnIndex = columns.findIndex((column) => {
        const last = column[column.length - 1];
        return new Date(last.ends_at).getTime() <= eventStart;
      });
      if (columnIndex === -1) {
        columns.push([event]);
        columnIndex = columns.length - 1;
      } else {
        columns[columnIndex].push(event);
      }
      assignments.set(event.id, columnIndex);
    });

    const columnCount = Math.max(columns.length, 1);
    cluster.forEach((event) => {
      const dayStart = startOfDay(selectedDate);
      const startMinutes =
        (new Date(event.starts_at).getTime() - dayStart.getTime()) / 60000;
      const endMinutes =
        (new Date(event.ends_at).getTime() - dayStart.getTime()) / 60000;
      const left = (assignments.get(event.id) ?? 0) * (100 / columnCount);
      layouts.push({
        event,
        top: (clampMinutes(startMinutes) / 60) * DAY_ROW_HEIGHT,
        height: Math.max(26, ((clampMinutes(endMinutes) - clampMinutes(startMinutes)) / 60) * DAY_ROW_HEIGHT),
        left,
        width: 100 / columnCount,
      });
    });

    cluster = [];
    clusterEnd = 0;
  };

  sameDay.forEach((event) => {
    const eventStart = new Date(event.starts_at).getTime();
    const eventEnd = new Date(event.ends_at).getTime();
    if (cluster.length === 0 || eventStart < clusterEnd) {
      cluster.push(event);
      clusterEnd = Math.max(clusterEnd, eventEnd);
      return;
    }
    flushCluster();
    cluster.push(event);
    clusterEnd = eventEnd;
  });
  flushCluster();

  return layouts;
}

export function CalendarClient() {
  const { user } = useAuth();
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [links, setLinks] = useState<BookingLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<CalendarView>("month");
  const [selectedDate, setSelectedDate] = useState(() => new Date());
  const [visibleUserIds, setVisibleUserIds] = useState<string[]>([]);
  const [draft, setDraft] = useState<EventDraft | null>(null);

  const range = useMemo(() => {
    if (view === "day") {
      return {
        from: startOfDay(selectedDate),
        to: endOfDay(selectedDate),
      };
    }
    if (view === "year") {
      return {
        from: startOfYear(selectedDate),
        to: endOfYear(selectedDate),
      };
    }
    const monthDays = getMonthGrid(selectedDate);
    return {
      from: startOfDay(monthDays[0]),
      to: endOfDay(monthDays[monthDays.length - 1]),
    };
  }, [selectedDate, view]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [eventsResponse, profilesResponse, linksResponse] = await Promise.all([
        fetch(
          `/api/calendar/events?from=${range.from.toISOString()}&to=${range.to.toISOString()}`
        ),
        fetch("/api/profiles/directory"),
        fetch("/api/calendar/booking-links"),
      ]);

      const [eventsData, profilesData, linksData] = await Promise.all([
        eventsResponse.json(),
        profilesResponse.json(),
        linksResponse.json(),
      ]);

      if (!eventsResponse.ok) {
        throw new Error(eventsData.error || "Impossible de charger le calendrier.");
      }
      if (!profilesResponse.ok) {
        throw new Error(profilesData.error || "Impossible de charger l'équipe.");
      }

      setEvents(eventsData.events || []);
      setProfiles(profilesData.profiles || []);
      if (linksResponse.ok) {
        setLinks(linksData.links || []);
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Une erreur est survenue.");
    } finally {
      setLoading(false);
    }
  }, [range.from, range.to]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (visibleUserIds.length > 0) return;
    if (user?.id) {
      setVisibleUserIds([user.id]);
      return;
    }
    if (profiles.length > 0) {
      setVisibleUserIds([profiles[0].user_id]);
    }
  }, [profiles, user?.id, visibleUserIds.length]);

  const profilesWithSelf = useMemo(() => {
    if (!user) return profiles;
    const exists = profiles.some((profile) => profile.user_id === user.id);
    if (exists) return profiles;
    return [
      {
        user_id: user.id,
        display_name:
          (typeof user.user_metadata?.display_name === "string" &&
            user.user_metadata.display_name) ||
          (typeof user.user_metadata?.full_name === "string" &&
            user.user_metadata.full_name) ||
          user.email ||
          "Moi",
        avatar_url: null,
        title: null,
      },
      ...profiles,
    ];
  }, [profiles, user]);

  const profilesById = useMemo(
    () =>
      new Map(
        profilesWithSelf.map((profile) => [
          profile.user_id,
          {
            ...profile,
            display_name: profile.display_name || profile.title || "Sans nom",
          },
        ])
      ),
    [profilesWithSelf]
  );

  const colorByUserId = useMemo(() => {
    return new Map(
      profilesWithSelf.map((profile, index) => [
        profile.user_id,
        USER_COLORS[index % USER_COLORS.length],
      ])
    );
  }, [profilesWithSelf]);

  const filteredEvents = useMemo(() => {
    if (visibleUserIds.length === 0) return [];
    return events.filter((event) =>
      getEventParticipantIds(event).some((participantId) =>
        visibleUserIds.includes(participantId)
      )
    );
  }, [events, visibleUserIds]);

  const eventsByDay = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    filteredEvents.forEach((event) => {
      listEventDays(event).forEach((key) => {
        const next = map.get(key) ?? [];
        next.push(event);
        map.set(key, next);
      });
    });
    map.forEach((items) =>
      items.sort(
        (left, right) =>
          new Date(left.starts_at).getTime() - new Date(right.starts_at).getTime()
      )
    );
    return map;
  }, [filteredEvents]);

  const selectedDayEvents = useMemo(
    () => eventsByDay.get(dateKey(selectedDate)) ?? [],
    [eventsByDay, selectedDate]
  );

  const dayLayouts = useMemo(
    () => buildDayLayouts(filteredEvents, selectedDate),
    [filteredEvents, selectedDate]
  );

  const canEditDraft = useMemo(() => {
    if (!draft) return false;
    if (!draft.id) return true;
    return draft.ownerId === user?.id;
  }, [draft, user?.id]);

  const openNewEvent = useCallback(
    (date?: Date) => {
      const base = date ? new Date(date) : new Date(selectedDate);
      if (view !== "day") {
        base.setHours(9, 0, 0, 0);
      }
      setDraft(buildDraft(base, user?.id ?? null));
    },
    [selectedDate, user?.id, view]
  );

  const openEvent = useCallback((event: CalendarEvent) => {
    setDraft(buildDraftFromEvent(event));
    setSelectedDate(new Date(event.starts_at));
  }, []);

  const moveRange = (direction: number) => {
    if (view === "day") {
      setSelectedDate((current) => addDays(current, direction));
      return;
    }
    if (view === "year") {
      setSelectedDate((current) => addYears(current, direction));
      return;
    }
    setSelectedDate((current) => addMonths(current, direction));
  };

  const saveDraft = async () => {
    if (!draft?.title.trim() || !draft.startsAt || !draft.endsAt) return;

    const startsAt = toIsoFromDraft(draft.startsAt, draft.allDay);
    const endsAt = toIsoFromDraft(draft.endsAt, draft.allDay, true);
    if (new Date(endsAt).getTime() < new Date(startsAt).getTime()) {
      setError("La fin doit être après le début.");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const payload = {
        title: draft.title.trim(),
        description: draft.description.trim() || null,
        starts_at: startsAt,
        ends_at: endsAt,
        all_day: draft.allDay,
        event_type: draft.eventType,
        visibility: draft.visibility,
        location: draft.location.trim() || null,
        video_link: draft.videoLink.trim() || null,
        attendee_ids: draft.attendeeIds.filter(Boolean),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
      };

      const response = await fetch(
        draft.id ? `/api/calendar/events/${draft.id}` : "/api/calendar/events",
        {
          method: draft.id ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Impossible d'enregistrer l'événement.");
      }
      setDraft(null);
      setSelectedDate(new Date(startsAt));
      await load();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Enregistrement impossible.");
    } finally {
      setSaving(false);
    }
  };

  const deleteDraft = async () => {
    if (!draft?.id) return;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/calendar/events/${draft.id}`, {
        method: "DELETE",
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Suppression impossible.");
      }
      setDraft(null);
      await load();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Suppression impossible.");
    } finally {
      setSaving(false);
    }
  };

  const createLink = async () => {
    try {
      const response = await fetch("/api/calendar/booking-links", { method: "POST" });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Impossible de créer le lien.");
      }
      await load();
    } catch (linkError) {
      setError(linkError instanceof Error ? linkError.message : "Impossible de créer le lien.");
    }
  };

  const selectedDayLabel = selectedDate.toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  return (
    <div className="flex h-full min-h-0 flex-col lg:flex-row">
      <aside className="flex w-full shrink-0 flex-col border-b border-border/60 bg-white/80 lg:w-72 lg:border-b-0 lg:border-r dark:bg-zinc-950/80">
        <div className="border-b border-border/60 p-5">
          <button
            type="button"
            onClick={() => openNewEvent()}
            className="flex w-full items-center justify-center gap-2 rounded-2xl bg-[#0f172a] px-4 py-3 text-sm font-medium text-white shadow-sm transition hover:bg-black dark:bg-white dark:text-black"
          >
            <Plus className="h-4 w-4" />
            Nouvel événement
          </button>
        </div>

        <div className="flex-1 space-y-6 overflow-y-auto p-5">
          <section className="rounded-[28px] border border-border/60 bg-[#f5f5f7] p-4 dark:bg-zinc-900/80">
            <div className="mb-4 flex items-center justify-between">
              <p className="text-sm font-medium text-foreground">
                {selectedDate.toLocaleDateString("fr-FR", {
                  month: "long",
                  year: "numeric",
                })}
              </p>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setSelectedDate((current) => addMonths(current, -1))}
                  className="rounded-full p-2 text-muted-foreground transition hover:bg-white hover:text-foreground dark:hover:bg-zinc-800"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedDate((current) => addMonths(current, 1))}
                  className="rounded-full p-2 text-muted-foreground transition hover:bg-white hover:text-foreground dark:hover:bg-zinc-800"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
            <div className="grid grid-cols-7 gap-1 text-center text-[11px] text-muted-foreground">
              {["L", "M", "M", "J", "V", "S", "D"].map((label, index) => (
                <div key={`${label}-${index}`} className="pb-2">
                  {label}
                </div>
              ))}
              {getMonthGrid(selectedDate).map((day) => {
                const isSelected = isSameDay(day, selectedDate);
                const inMonth = day.getMonth() === selectedDate.getMonth();
                return (
                  <button
                    key={dateKey(day)}
                    type="button"
                    onClick={() => setSelectedDate(day)}
                    className={`rounded-full px-0 py-2 text-sm transition ${
                      isSelected
                        ? "bg-[#111827] text-white dark:bg-white dark:text-black"
                        : inMonth
                          ? "text-foreground hover:bg-white dark:hover:bg-zinc-800"
                          : "text-muted-foreground/50 hover:bg-white dark:hover:bg-zinc-800"
                    }`}
                  >
                    {day.getDate()}
                  </button>
                );
              })}
            </div>
          </section>

          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                Calendriers
              </p>
              <button
                type="button"
                onClick={() => setVisibleUserIds(profilesWithSelf.map((profile) => profile.user_id))}
                className="text-xs text-muted-foreground transition hover:text-foreground"
              >
                Tout afficher
              </button>
            </div>
            <div className="space-y-2">
              {profilesWithSelf.map((profile) => {
                const checked = visibleUserIds.includes(profile.user_id);
                const color = colorByUserId.get(profile.user_id) || USER_COLORS[0];
                const label = profile.user_id === user?.id ? "Moi" : profile.display_name || "Sans nom";
                return (
                  <button
                    key={profile.user_id}
                    type="button"
                    onClick={() =>
                      setVisibleUserIds((current) =>
                        current.includes(profile.user_id)
                          ? current.filter((value) => value !== profile.user_id)
                          : [...current, profile.user_id]
                      )
                    }
                    className={`flex w-full items-center gap-3 rounded-2xl border px-3 py-3 text-left transition ${
                      checked
                        ? "border-border bg-[#f5f5f7] dark:bg-zinc-900"
                        : "border-transparent bg-transparent hover:border-border/70 hover:bg-[#f8f8fa] dark:hover:bg-zinc-900/80"
                    }`}
                  >
                    <span
                      className="h-3 w-3 rounded-full"
                      style={{ backgroundColor: color }}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-foreground">
                        {label}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {profile.title || "Calendrier personnel"}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                Réservation
              </p>
              <button
                type="button"
                onClick={() => void createLink()}
                className="rounded-full border border-border/70 px-3 py-1 text-xs text-foreground transition hover:bg-[#f5f5f7] dark:hover:bg-zinc-900"
              >
                Générer
              </button>
            </div>
            <div className="space-y-2">
              {links.length === 0 ? (
                <p className="rounded-2xl border border-dashed border-border/70 px-3 py-4 text-sm text-muted-foreground">
                  Aucun lien disponible.
                </p>
              ) : (
                links.map((link) => (
                  <div
                    key={link.slug}
                    className="rounded-2xl border border-border/70 bg-[#f8f8fa] p-3 dark:bg-zinc-900"
                  >
                    <p className="text-sm font-medium text-foreground">{link.title}</p>
                    <p className="mt-1 break-all text-xs text-muted-foreground">
                      {typeof window !== "undefined"
                        ? `${window.location.origin}/book/${link.slug}`
                        : `/book/${link.slug}`}
                    </p>
                  </div>
                ))
              )}
            </div>
          </section>
        </div>
      </aside>

      <main className="flex min-h-0 min-w-0 flex-1 flex-col bg-[#fcfcfd] dark:bg-zinc-950">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border/60 px-5 py-4 lg:px-8">
          <div className="flex items-center gap-3">
            <div className="rounded-2xl bg-[#f1f5f9] p-2.5 text-foreground dark:bg-zinc-900">
              <CalendarDays className="h-5 w-5" />
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-muted-foreground">
                Calendrier
              </p>
              <h1 className="text-xl font-semibold capitalize text-foreground">
                {formatHeaderDate(selectedDate, view)}
              </h1>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center rounded-full border border-border/70 bg-white p-1 shadow-sm dark:bg-zinc-900">
              <button
                type="button"
                onClick={() => moveRange(-1)}
                className="rounded-full p-2 text-muted-foreground transition hover:bg-[#f5f5f7] hover:text-foreground dark:hover:bg-zinc-800"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => setSelectedDate(new Date())}
                className="rounded-full px-3 py-2 text-sm font-medium text-foreground transition hover:bg-[#f5f5f7] dark:hover:bg-zinc-800"
              >
                Aujourd’hui
              </button>
              <button
                type="button"
                onClick={() => moveRange(1)}
                className="rounded-full p-2 text-muted-foreground transition hover:bg-[#f5f5f7] hover:text-foreground dark:hover:bg-zinc-800"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>

            <div className="flex items-center rounded-full border border-border/70 bg-white p-1 shadow-sm dark:bg-zinc-900">
              {(["day", "month", "year"] as CalendarView[]).map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setView(option)}
                  className={`rounded-full px-4 py-2 text-sm font-medium capitalize transition ${
                    view === option
                      ? "bg-[#111827] text-white dark:bg-white dark:text-black"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {option === "day" ? "Jour" : option === "month" ? "Mois" : "Année"}
                </button>
              ))}
            </div>
          </div>
        </div>

        {error ? (
          <div className="mx-5 mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200 lg:mx-8">
            {error}
          </div>
        ) : null}

        <div className="min-h-0 flex-1 overflow-auto px-4 py-4 lg:px-6 lg:py-6">
          {loading ? (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {Array.from({ length: 6 }).map((_, index) => (
                <div
                  key={index}
                  className="h-32 animate-pulse rounded-[28px] bg-[#f1f5f9] dark:bg-zinc-900"
                />
              ))}
            </div>
          ) : view === "month" ? (
            <div className="overflow-hidden rounded-[30px] border border-border/60 bg-white shadow-sm dark:bg-zinc-950">
              <div className="grid grid-cols-7 border-b border-border/60 bg-[#f8f8fa] text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground dark:bg-zinc-900/80">
                {["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"].map((label) => (
                  <div key={label} className="px-4 py-3">
                    {label}
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-7">
                {getMonthGrid(selectedDate).map((day) => {
                  const key = dateKey(day);
                  const dayEvents = eventsByDay.get(key) ?? [];
                  const inMonth = day.getMonth() === selectedDate.getMonth();
                  const isActiveDay = isSameDay(day, selectedDate);
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => {
                        setSelectedDate(day);
                        openNewEvent(day);
                      }}
                      className={`min-h-[160px] border-b border-r border-border/60 p-3 text-left align-top transition ${
                        inMonth
                          ? "bg-white hover:bg-[#fafafa] dark:bg-zinc-950 dark:hover:bg-zinc-900/70"
                          : "bg-[#fafafa] text-muted-foreground/60 hover:bg-[#f6f6f6] dark:bg-zinc-950/80 dark:hover:bg-zinc-900/50"
                      }`}
                    >
                      <div className="mb-3 flex items-center justify-between">
                        <span
                          className={`inline-flex h-8 w-8 items-center justify-center rounded-full text-sm font-medium ${
                            isActiveDay
                              ? "bg-[#111827] text-white dark:bg-white dark:text-black"
                              : ""
                          }`}
                        >
                          {day.getDate()}
                        </span>
                        {dayEvents.length > 0 ? (
                          <span className="text-[11px] text-muted-foreground">
                            {dayEvents.length} év.
                          </span>
                        ) : null}
                      </div>
                      <div className="space-y-2">
                        {dayEvents.slice(0, 4).map((event) => {
                          const color = colorByUserId.get(getVisibleOwnerId(event)) || USER_COLORS[0];
                          return (
                            <button
                              key={event.id}
                              type="button"
                              onClick={(eventClick) => {
                                eventClick.stopPropagation();
                                openEvent(event);
                              }}
                              className="block w-full rounded-2xl px-3 py-2 text-left text-xs text-foreground transition hover:brightness-95"
                              style={{
                                backgroundColor: `${color}20`,
                                borderLeft: `3px solid ${color}`,
                              }}
                            >
                              <span className="block truncate font-medium">{event.title}</span>
                              <span className="block truncate text-[11px] text-muted-foreground">
                                {formatTimeRange(event)}
                              </span>
                            </button>
                          );
                        })}
                        {dayEvents.length > 4 ? (
                          <span className="block px-1 text-xs text-muted-foreground">
                            + {dayEvents.length - 4} autres
                          </span>
                        ) : null}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : view === "day" ? (
            <div className="overflow-hidden rounded-[30px] border border-border/60 bg-white shadow-sm dark:bg-zinc-950">
              <div className="flex items-center justify-between border-b border-border/60 px-6 py-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                    Vue du jour
                  </p>
                  <h2 className="text-lg font-semibold capitalize text-foreground">
                    {selectedDayLabel}
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={() => openNewEvent(selectedDate)}
                  className="rounded-full border border-border/70 px-4 py-2 text-sm font-medium text-foreground transition hover:bg-[#f5f5f7] dark:hover:bg-zinc-900"
                >
                  Ajouter
                </button>
              </div>

              <div className="relative overflow-auto p-4">
                <div className="relative" style={{ height: DAY_ROW_HEIGHT * 24 }}>
                  {Array.from({ length: 24 }).map((_, hour) => (
                    <button
                      key={hour}
                      type="button"
                      onClick={() => {
                        const next = new Date(selectedDate);
                        next.setHours(hour, 0, 0, 0);
                        openNewEvent(next);
                      }}
                      className="absolute left-0 right-0 flex border-t border-border/60 text-left hover:bg-[#fafafa] dark:hover:bg-zinc-900/50"
                      style={{ top: hour * DAY_ROW_HEIGHT, height: DAY_ROW_HEIGHT }}
                    >
                      <span className="w-20 px-2 py-3 text-xs text-muted-foreground">
                        {String(hour).padStart(2, "0")}:00
                      </span>
                      <span className="flex-1" />
                    </button>
                  ))}

                  {selectedDayEvents.filter((event) => event.all_day).length > 0 ? (
                    <div className="absolute left-20 right-4 top-2 flex flex-wrap gap-2">
                      {selectedDayEvents
                        .filter((event) => event.all_day)
                        .map((event) => {
                          const color =
                            colorByUserId.get(getVisibleOwnerId(event)) || USER_COLORS[0];
                          return (
                            <button
                              key={event.id}
                              type="button"
                              onClick={() => openEvent(event)}
                              className="rounded-full px-3 py-1 text-xs font-medium text-foreground"
                              style={{ backgroundColor: `${color}24` }}
                            >
                              {event.title}
                            </button>
                          );
                        })}
                    </div>
                  ) : null}

                  {dayLayouts.map(({ event, top, height, left, width }) => {
                    const color = colorByUserId.get(getVisibleOwnerId(event)) || USER_COLORS[0];
                    return (
                      <button
                        key={event.id}
                        type="button"
                        onClick={() => openEvent(event)}
                        className="absolute overflow-hidden rounded-3xl border px-3 py-2 text-left shadow-sm transition hover:shadow-md"
                        style={{
                          top,
                          left: `calc(5rem + ${left}% + 0.5rem)`,
                          width: `calc(${width}% - 1rem)`,
                          height,
                          borderColor: `${color}50`,
                          backgroundColor: `${color}18`,
                        }}
                      >
                        <span className="block truncate text-sm font-semibold text-foreground">
                          {event.title}
                        </span>
                        <span className="mt-1 block truncate text-xs text-muted-foreground">
                          {formatTimeRange(event)}
                        </span>
                        <span className="mt-2 block truncate text-xs text-muted-foreground">
                          {profilesById.get(event.created_by)?.display_name || "Équipe"}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {Array.from({ length: 12 }).map((_, monthIndex) => {
                const monthDate = new Date(selectedDate.getFullYear(), monthIndex, 1);
                const monthDays = getMonthGrid(monthDate);
                return (
                  <div
                    key={monthIndex}
                    className="rounded-[28px] border border-border/60 bg-white p-4 shadow-sm dark:bg-zinc-950"
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedDate(monthDate);
                        setView("month");
                      }}
                      className="mb-4 text-left text-base font-semibold text-foreground transition hover:text-black/70 dark:hover:text-white/70"
                    >
                      {monthDate.toLocaleDateString("fr-FR", { month: "long" })}
                    </button>
                    <div className="mb-2 grid grid-cols-7 text-center text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                      {["L", "M", "M", "J", "V", "S", "D"].map((label, index) => (
                        <div key={`${label}-${index}`}>{label}</div>
                      ))}
                    </div>
                    <div className="grid grid-cols-7 gap-y-1">
                      {monthDays.map((day) => {
                        const key = dateKey(day);
                        const count = (eventsByDay.get(key) ?? []).length;
                        const inMonth = day.getMonth() === monthDate.getMonth();
                        const isToday = isSameDay(day, new Date());
                        return (
                          <button
                            key={key}
                            type="button"
                            onClick={() => {
                              setSelectedDate(day);
                              setView("day");
                            }}
                            className={`flex flex-col items-center rounded-2xl px-1 py-2 text-xs transition ${
                              inMonth
                                ? "hover:bg-[#f5f5f7] dark:hover:bg-zinc-900"
                                : "text-muted-foreground/40"
                            }`}
                          >
                            <span
                              className={`flex h-7 w-7 items-center justify-center rounded-full ${
                                isToday
                                  ? "bg-[#111827] text-white dark:bg-white dark:text-black"
                                  : ""
                              }`}
                            >
                              {day.getDate()}
                            </span>
                            <span className="mt-1 flex h-2 items-center gap-1">
                              {count > 0 ? (
                                <>
                                  <span className="h-1.5 w-1.5 rounded-full bg-[#3b82f6]" />
                                  {count > 1 ? (
                                    <span className="h-1.5 w-1.5 rounded-full bg-[#ec4899]" />
                                  ) : null}
                                  {count > 2 ? (
                                    <span className="h-1.5 w-1.5 rounded-full bg-[#10b981]" />
                                  ) : null}
                                </>
                              ) : null}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </main>

      <aside className="flex w-full shrink-0 flex-col border-t border-border/60 bg-white/90 lg:w-[360px] lg:border-l lg:border-t-0 dark:bg-zinc-950/90">
        <div className="border-b border-border/60 px-5 py-4">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            Inspecteur
          </p>
          <h2 className="mt-1 text-lg font-semibold text-foreground">
            {draft ? (draft.id ? "Modifier l'événement" : "Créer un événement") : "Journée sélectionnée"}
          </h2>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5">
          {draft ? (
            <>
              <div className="space-y-3">
                <input
                  value={draft.title}
                  onChange={(event) =>
                    setDraft((current) =>
                      current ? { ...current, title: event.target.value } : current
                    )
                  }
                  disabled={!canEditDraft}
                  placeholder="Titre"
                  className="w-full rounded-2xl border border-border/70 bg-[#f8f8fa] px-4 py-3 text-base text-foreground outline-none transition focus:border-[#94a3b8] disabled:cursor-not-allowed disabled:opacity-70 dark:bg-zinc-900"
                />
                <textarea
                  value={draft.description}
                  onChange={(event) =>
                    setDraft((current) =>
                      current ? { ...current, description: event.target.value } : current
                    )
                  }
                  disabled={!canEditDraft}
                  placeholder="Notes, agenda, contexte..."
                  rows={4}
                  className="w-full rounded-2xl border border-border/70 bg-[#f8f8fa] px-4 py-3 text-sm text-foreground outline-none transition focus:border-[#94a3b8] disabled:cursor-not-allowed disabled:opacity-70 dark:bg-zinc-900"
                />
              </div>

              <div className="rounded-[28px] border border-border/70 bg-[#f8f8fa] p-4 dark:bg-zinc-900">
                <div className="mb-3 flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                    <Clock3 className="h-4 w-4" />
                    Horaire
                  </div>
                  <button
                    type="button"
                    disabled={!canEditDraft}
                    onClick={() =>
                      setDraft((current) =>
                        current ? { ...current, allDay: !current.allDay } : current
                      )
                    }
                    className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                      draft.allDay
                        ? "bg-[#111827] text-white dark:bg-white dark:text-black"
                        : "border border-border/70 text-muted-foreground"
                    } ${!canEditDraft ? "opacity-60" : ""}`}
                  >
                    Toute la journée
                  </button>
                </div>
                <div className="grid gap-3">
                  <input
                    type={draft.allDay ? "date" : "datetime-local"}
                    value={draft.startsAt}
                    disabled={!canEditDraft}
                    onChange={(event) =>
                      setDraft((current) =>
                        current ? { ...current, startsAt: event.target.value } : current
                      )
                    }
                    className="w-full rounded-2xl border border-border/70 bg-white px-4 py-3 text-sm outline-none transition focus:border-[#94a3b8] disabled:cursor-not-allowed disabled:opacity-70 dark:bg-zinc-950"
                  />
                  <input
                    type={draft.allDay ? "date" : "datetime-local"}
                    value={draft.endsAt}
                    disabled={!canEditDraft}
                    onChange={(event) =>
                      setDraft((current) =>
                        current ? { ...current, endsAt: event.target.value } : current
                      )
                    }
                    className="w-full rounded-2xl border border-border/70 bg-white px-4 py-3 text-sm outline-none transition focus:border-[#94a3b8] disabled:cursor-not-allowed disabled:opacity-70 dark:bg-zinc-950"
                  />
                </div>
              </div>

              <div className="rounded-[28px] border border-border/70 bg-[#f8f8fa] p-4 dark:bg-zinc-900">
                <div className="mb-3 flex items-center gap-2 text-sm font-medium text-foreground">
                  <Users2 className="h-4 w-4" />
                  Participants
                </div>
                <div className="flex flex-wrap gap-2">
                  {profilesWithSelf.map((profile) => {
                    const active = draft.attendeeIds.includes(profile.user_id);
                    const color = colorByUserId.get(profile.user_id) || USER_COLORS[0];
                    return (
                      <button
                        key={profile.user_id}
                        type="button"
                        disabled={!canEditDraft}
                        onClick={() =>
                          setDraft((current) => {
                            if (!current) return current;
                            const exists = current.attendeeIds.includes(profile.user_id);
                            return {
                              ...current,
                              attendeeIds: exists
                                ? current.attendeeIds.filter((id) => id !== profile.user_id)
                                : [...current.attendeeIds, profile.user_id],
                            };
                          })
                        }
                        className={`rounded-full border px-3 py-2 text-xs font-medium transition ${
                          active
                            ? "text-foreground"
                            : "border-border/70 text-muted-foreground"
                        } ${!canEditDraft ? "opacity-60" : ""}`}
                        style={{
                          backgroundColor: active ? `${color}22` : "transparent",
                          borderColor: active ? `${color}60` : undefined,
                        }}
                      >
                        {profile.user_id === user?.id ? "Moi" : profile.display_name || "Sans nom"}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="rounded-[28px] border border-border/70 bg-[#f8f8fa] p-4 dark:bg-zinc-900">
                  <p className="mb-3 text-sm font-medium text-foreground">Type</p>
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(EVENT_TYPE_LABELS).map(([value, label]) => (
                      <button
                        key={value}
                        type="button"
                        disabled={!canEditDraft}
                        onClick={() =>
                          setDraft((current) =>
                            current ? { ...current, eventType: value } : current
                          )
                        }
                        className={`rounded-full px-3 py-2 text-xs font-medium transition ${
                          draft.eventType === value
                            ? "bg-[#111827] text-white dark:bg-white dark:text-black"
                            : "border border-border/70 text-muted-foreground"
                        } ${!canEditDraft ? "opacity-60" : ""}`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="rounded-[28px] border border-border/70 bg-[#f8f8fa] p-4 dark:bg-zinc-900">
                  <p className="mb-3 text-sm font-medium text-foreground">Visibilité</p>
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(VISIBILITY_LABELS).map(([value, label]) => (
                      <button
                        key={value}
                        type="button"
                        disabled={!canEditDraft}
                        onClick={() =>
                          setDraft((current) =>
                            current ? { ...current, visibility: value } : current
                          )
                        }
                        className={`rounded-full px-3 py-2 text-xs font-medium transition ${
                          draft.visibility === value
                            ? "bg-[#111827] text-white dark:bg-white dark:text-black"
                            : "border border-border/70 text-muted-foreground"
                        } ${!canEditDraft ? "opacity-60" : ""}`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <div className="relative">
                  <MapPin className="pointer-events-none absolute left-4 top-3.5 h-4 w-4 text-muted-foreground" />
                  <input
                    value={draft.location}
                    onChange={(event) =>
                      setDraft((current) =>
                        current ? { ...current, location: event.target.value } : current
                      )
                    }
                    disabled={!canEditDraft}
                    placeholder="Lieu"
                    className="w-full rounded-2xl border border-border/70 bg-[#f8f8fa] py-3 pl-11 pr-4 text-sm outline-none transition focus:border-[#94a3b8] disabled:cursor-not-allowed disabled:opacity-70 dark:bg-zinc-900"
                  />
                </div>
                <div className="relative">
                  <Video className="pointer-events-none absolute left-4 top-3.5 h-4 w-4 text-muted-foreground" />
                  <input
                    value={draft.videoLink}
                    onChange={(event) =>
                      setDraft((current) =>
                        current ? { ...current, videoLink: event.target.value } : current
                      )
                    }
                    disabled={!canEditDraft}
                    placeholder="Lien visio"
                    className="w-full rounded-2xl border border-border/70 bg-[#f8f8fa] py-3 pl-11 pr-4 text-sm outline-none transition focus:border-[#94a3b8] disabled:cursor-not-allowed disabled:opacity-70 dark:bg-zinc-900"
                  />
                </div>
              </div>

              {!canEditDraft ? (
                <p className="rounded-2xl border border-border/70 bg-[#f8f8fa] px-4 py-3 text-sm text-muted-foreground dark:bg-zinc-900">
                  Cet événement a été créé par un autre membre de l’équipe. Il reste visible ici, mais seule la personne qui l’a créé peut le modifier ou le supprimer.
                </p>
              ) : null}

              <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setDraft(null)}
                  className="rounded-full border border-border/70 px-4 py-2 text-sm font-medium text-foreground transition hover:bg-[#f5f5f7] dark:hover:bg-zinc-900"
                >
                  Fermer
                </button>
                <div className="flex items-center gap-2">
                  {draft.id ? (
                    <button
                      type="button"
                      onClick={() => void deleteDraft()}
                      disabled={!canEditDraft || saving}
                      className="rounded-full border border-red-200 px-4 py-2 text-sm font-medium text-red-600 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-900/60 dark:hover:bg-red-950/40"
                    >
                      <span className="inline-flex items-center gap-2">
                        <Trash2 className="h-4 w-4" />
                        Supprimer
                      </span>
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => void saveDraft()}
                    disabled={!canEditDraft || saving}
                    className="rounded-full bg-[#111827] px-5 py-2.5 text-sm font-medium text-white transition hover:bg-black disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white dark:text-black"
                  >
                    {saving ? "Enregistrement..." : draft.id ? "Mettre à jour" : "Créer"}
                  </button>
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="rounded-[28px] border border-border/70 bg-[#f8f8fa] p-4 dark:bg-zinc-900">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                  Sélection
                </p>
                <p className="mt-2 text-lg font-semibold capitalize text-foreground">
                  {selectedDayLabel}
                </p>
                <p className="mt-2 text-sm text-muted-foreground">
                  Cliquez dans la grille pour créer un événement directement, ou ouvrez un rendez-vous existant pour le modifier.
                </p>
              </div>

              <div className="space-y-3">
                {selectedDayEvents.length === 0 ? (
                  <p className="rounded-[28px] border border-dashed border-border/70 px-4 py-6 text-sm text-muted-foreground">
                    Aucun événement sur cette journée.
                  </p>
                ) : (
                  selectedDayEvents.map((event) => {
                    const color = colorByUserId.get(getVisibleOwnerId(event)) || USER_COLORS[0];
                    return (
                      <button
                        key={event.id}
                        type="button"
                        onClick={() => openEvent(event)}
                        className="block w-full rounded-[28px] border border-border/70 px-4 py-4 text-left transition hover:bg-[#f8f8fa] dark:hover:bg-zinc-900"
                        style={{ borderLeft: `4px solid ${color}` }}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-foreground">
                              {event.title}
                            </p>
                            <p className="mt-1 text-xs text-muted-foreground">
                              {formatTimeRange(event)}
                            </p>
                          </div>
                          <span className="rounded-full bg-[#f5f5f7] px-2.5 py-1 text-[11px] text-muted-foreground dark:bg-zinc-800">
                            {EVENT_TYPE_LABELS[event.event_type] || event.event_type}
                          </span>
                        </div>
                        {event.location ? (
                          <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                            <MapPin className="h-3.5 w-3.5" />
                            {event.location}
                          </p>
                        ) : null}
                        {event.video_link ? (
                          <p className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                            <Link2 className="h-3.5 w-3.5" />
                            Lien visio disponible
                          </p>
                        ) : null}
                      </button>
                    );
                  })
                )}
              </div>
            </>
          )}
        </div>
      </aside>
    </div>
  );
}
