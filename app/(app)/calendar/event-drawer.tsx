"use client";

import type { CalendarEventRow } from "@/lib/calendar/to-fullcalendar";
import { cn } from "@/lib/utils";
import { useEffect, useMemo, useState } from "react";

const EVENT_TYPES = [
  "prospect_call",
  "demo",
  "internal",
  "deadline",
  "focus_block",
  "callback",
  "other",
] as const;

const VISIBILITY = ["private", "org", "selected_users"] as const;

export type EventDraft = {
  id?: string;
  title: string;
  all_day: boolean;
  starts_at: string;
  ends_at: string;
  event_type: string;
  visibility: string;
  timezone: string;
  location: string;
  description: string;
  video_link: string;
  recurrence_rule: string;
  recurrence_until: string;
};

function pad(n: number) {
  return String(n).padStart(2, "0");
}

export function isoToDatetimeLocal(iso: string) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function isoToDateOnly(iso: string) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Inclusive end date for all-day range from exclusive end ISO */
export function exclusiveEndToInclusiveDate(endIso: string) {
  const d = new Date(endIso);
  d.setMilliseconds(d.getMilliseconds() - 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function inclusiveDateRangeToIso(startYmd: string, endYmdInclusive: string) {
  const [ys, ms, ds] = startYmd.split("-").map(Number);
  const [ye, me, de] = endYmdInclusive.split("-").map(Number);
  const start = new Date(ys, ms - 1, ds, 0, 0, 0, 0);
  const endExclusive = new Date(ye, me - 1, de + 1, 0, 0, 0, 0);
  return {
    starts_at: start.toISOString(),
    ends_at: endExclusive.toISOString(),
  };
}

export function emptyDraft(): EventDraft {
  const start = new Date();
  start.setMinutes(0, 0, 0);
  const end = new Date(start.getTime() + 60 * 60 * 1000);
  return {
    title: "",
    all_day: false,
    starts_at: isoToDatetimeLocal(start.toISOString()),
    ends_at: isoToDatetimeLocal(end.toISOString()),
    event_type: "internal",
    visibility: "org",
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    location: "",
    description: "",
    video_link: "",
    recurrence_rule: "",
    recurrence_until: "",
  };
}

export function rowToDraft(row: CalendarEventRow): EventDraft {
  if (row.all_day) {
    const endInc = exclusiveEndToInclusiveDate(row.ends_at);
    return {
      id: row.id,
      title: row.title,
      all_day: true,
      starts_at: isoToDateOnly(row.starts_at),
      ends_at: endInc,
      event_type: row.event_type,
      visibility: row.visibility,
      timezone: row.timezone || "UTC",
      location: row.location || "",
      description: row.description || "",
      video_link: row.video_link || "",
      recurrence_rule: row.recurrence_rule || "",
      recurrence_until: row.recurrence_until
        ? isoToDatetimeLocal(row.recurrence_until)
        : "",
    };
  }
  return {
    id: row.id,
    title: row.title,
    all_day: false,
    starts_at: isoToDatetimeLocal(row.starts_at),
    ends_at: isoToDatetimeLocal(row.ends_at),
    event_type: row.event_type,
    visibility: row.visibility,
    timezone: row.timezone || "UTC",
    location: row.location || "",
    description: row.description || "",
    video_link: row.video_link || "",
    recurrence_rule: row.recurrence_rule || "",
    recurrence_until: row.recurrence_until
      ? isoToDatetimeLocal(row.recurrence_until)
      : "",
  };
}

export function draftToPayload(draft: EventDraft) {
  if (draft.all_day) {
    const { starts_at, ends_at } = inclusiveDateRangeToIso(
      draft.starts_at.slice(0, 10),
      draft.ends_at.slice(0, 10)
    );
    return {
      title: draft.title.trim(),
      starts_at,
      ends_at,
      all_day: true,
      event_type: draft.event_type,
      visibility: draft.visibility,
      timezone: draft.timezone || "UTC",
      location: draft.location.trim() || null,
      description: draft.description.trim() || null,
      video_link: draft.video_link.trim() || null,
      recurrence_rule: draft.recurrence_rule.trim() || null,
      recurrence_until: draft.recurrence_until.trim()
        ? new Date(draft.recurrence_until).toISOString()
        : null,
    };
  }
  return {
    title: draft.title.trim(),
    starts_at: new Date(draft.starts_at).toISOString(),
    ends_at: new Date(draft.ends_at).toISOString(),
    all_day: false,
    event_type: draft.event_type,
    visibility: draft.visibility,
    timezone: draft.timezone || "UTC",
    location: draft.location.trim() || null,
    description: draft.description.trim() || null,
    video_link: draft.video_link.trim() || null,
    recurrence_rule: draft.recurrence_rule.trim() || null,
    recurrence_until: draft.recurrence_until.trim()
      ? new Date(draft.recurrence_until).toISOString()
      : null,
  };
}

type Props = {
  open: boolean;
  onClose: () => void;
  readOnly: boolean;
  draft: EventDraft;
  onChange: (next: EventDraft) => void;
  onSave: () => Promise<void>;
  onDelete?: () => Promise<void>;
  saving: boolean;
};

export function EventDrawer({
  open,
  onClose,
  readOnly,
  draft,
  onChange,
  onSave,
  onDelete,
  saving,
}: Props) {
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!open) setDeleting(false);
  }, [open]);

  const title = useMemo(
    () => (draft.id ? "Détails" : "Nouvel événement"),
    [draft.id]
  );

  if (!open) return null;

  return (
    <>
      <button
        type="button"
        aria-label="Fermer le panneau"
        className="fixed inset-0 z-40 bg-black/20 backdrop-blur-[1px] dark:bg-black/40"
        onClick={onClose}
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="event-drawer-title"
        className={cn(
          "fixed right-0 top-0 z-50 flex h-full w-full max-w-md flex-col rounded-l-[var(--radius)] border-l border-border bg-card shadow-xl",
          "animate-fade-in"
        )}
      >
        <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div>
            <p className="label-eyebrow mb-1">Calendrier</p>
            <h2
              id="event-drawer-title"
              className="font-display text-lg font-medium tracking-tight"
              style={{ color: "var(--blue)" }}
            >
              {title}
            </h2>
            {readOnly ? (
              <p className="mt-1 text-xs text-muted-foreground">
                Lecture seule — calendrier d’un autre membre.
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="btn-outline shrink-0 px-3 py-2 text-xs"
          >
            Fermer
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          <div className="space-y-4">
            <label className="block space-y-1">
              <span className="text-xs font-medium text-muted-foreground">
                Titre
              </span>
              <input
                className="input-minimal"
                value={draft.title}
                disabled={readOnly}
                onChange={(e) => onChange({ ...draft, title: e.target.value })}
              />
            </label>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={draft.all_day}
                disabled={readOnly}
                onChange={(e) => {
                  const allDay = e.target.checked;
                  if (allDay) {
                    const s = new Date(draft.starts_at);
                    const e = new Date(draft.ends_at);
                    onChange({
                      ...draft,
                      all_day: true,
                      starts_at: isoToDateOnly(s.toISOString()),
                      ends_at: isoToDateOnly(e.toISOString()),
                    });
                  } else {
                    const s = new Date();
                    s.setHours(9, 0, 0, 0);
                    const e = new Date(s.getTime() + 3600000);
                    onChange({
                      ...draft,
                      all_day: false,
                      starts_at: isoToDatetimeLocal(s.toISOString()),
                      ends_at: isoToDatetimeLocal(e.toISOString()),
                    });
                  }
                }}
              />
              Journée entière
            </label>

            {draft.all_day ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block space-y-1">
                  <span className="text-xs font-medium text-muted-foreground">
                    Début
                  </span>
                  <input
                    type="date"
                    className="input-minimal"
                    disabled={readOnly}
                    value={draft.starts_at.slice(0, 10)}
                    onChange={(e) =>
                      onChange({ ...draft, starts_at: e.target.value })
                    }
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-xs font-medium text-muted-foreground">
                    Fin (inclus)
                  </span>
                  <input
                    type="date"
                    className="input-minimal"
                    disabled={readOnly}
                    value={draft.ends_at.slice(0, 10)}
                    onChange={(e) =>
                      onChange({ ...draft, ends_at: e.target.value })
                    }
                  />
                </label>
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block space-y-1">
                  <span className="text-xs font-medium text-muted-foreground">
                    Début
                  </span>
                  <input
                    type="datetime-local"
                    className="input-minimal"
                    disabled={readOnly}
                    value={draft.starts_at}
                    onChange={(e) =>
                      onChange({ ...draft, starts_at: e.target.value })
                    }
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-xs font-medium text-muted-foreground">
                    Fin
                  </span>
                  <input
                    type="datetime-local"
                    className="input-minimal"
                    disabled={readOnly}
                    value={draft.ends_at}
                    onChange={(e) =>
                      onChange({ ...draft, ends_at: e.target.value })
                    }
                  />
                </label>
              </div>
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block space-y-1">
                <span className="text-xs font-medium text-muted-foreground">
                  Type
                </span>
                <select
                  className="input-minimal"
                  disabled={readOnly}
                  value={draft.event_type}
                  onChange={(e) =>
                    onChange({ ...draft, event_type: e.target.value })
                  }
                >
                  {EVENT_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block space-y-1">
                <span className="text-xs font-medium text-muted-foreground">
                  Visibilité
                </span>
                <select
                  className="input-minimal"
                  disabled={readOnly}
                  value={draft.visibility}
                  onChange={(e) =>
                    onChange({ ...draft, visibility: e.target.value })
                  }
                >
                  {VISIBILITY.map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <label className="block space-y-1">
              <span className="text-xs font-medium text-muted-foreground">
                Fuseau (IANA)
              </span>
              <input
                className="input-minimal"
                disabled={readOnly}
                value={draft.timezone}
                onChange={(e) =>
                  onChange({ ...draft, timezone: e.target.value })
                }
                placeholder="Europe/Paris"
              />
            </label>

            <label className="block space-y-1">
              <span className="text-xs font-medium text-muted-foreground">
                Lieu
              </span>
              <input
                className="input-minimal"
                disabled={readOnly}
                value={draft.location}
                onChange={(e) =>
                  onChange({ ...draft, location: e.target.value })
                }
              />
            </label>

            <label className="block space-y-1">
              <span className="text-xs font-medium text-muted-foreground">
                Lien visio
              </span>
              <input
                className="input-minimal"
                disabled={readOnly}
                value={draft.video_link}
                onChange={(e) =>
                  onChange({ ...draft, video_link: e.target.value })
                }
              />
            </label>

            <label className="block space-y-1">
              <span className="text-xs font-medium text-muted-foreground">
                Notes
              </span>
              <textarea
                className="input-minimal min-h-[88px] resize-y"
                disabled={readOnly}
                value={draft.description}
                onChange={(e) =>
                  onChange({ ...draft, description: e.target.value })
                }
              />
            </label>

            <div className="border-t border-border pt-4">
              <p className="label-eyebrow mb-2">Récurrence</p>
              <label className="block space-y-1">
                <span className="text-xs font-medium text-muted-foreground">
                  RRULE (ex. FREQ=WEEKLY;BYDAY=MO,WE)
                </span>
                <input
                  className="input-minimal font-mono text-xs"
                  disabled={readOnly}
                  value={draft.recurrence_rule}
                  onChange={(e) =>
                    onChange({ ...draft, recurrence_rule: e.target.value })
                  }
                  placeholder="Laisser vide pour un événement unique"
                />
              </label>
              <label className="mt-2 block space-y-1">
                <span className="text-xs font-medium text-muted-foreground">
                  Fin de récurrence (optionnel)
                </span>
                <input
                  type="datetime-local"
                  className="input-minimal"
                  disabled={readOnly}
                  value={draft.recurrence_until}
                  onChange={(e) =>
                    onChange({ ...draft, recurrence_until: e.target.value })
                  }
                />
              </label>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-border px-5 py-4">
          {!readOnly ? (
            <>
              <button
                type="button"
                className="btn-solid text-sm"
                disabled={saving || !draft.title.trim()}
                onClick={() => onSave()}
              >
                {saving ? "…" : draft.id ? "Enregistrer" : "Créer"}
              </button>
              {draft.id && onDelete ? (
                <button
                  type="button"
                  className="btn-outline border-destructive text-sm text-destructive"
                  disabled={saving || deleting}
                  onClick={async () => {
                    if (!confirm("Supprimer cet événement ?")) return;
                    setDeleting(true);
                    try {
                      await onDelete();
                    } finally {
                      setDeleting(false);
                    }
                  }}
                >
                  {deleting ? "…" : "Supprimer"}
                </button>
              ) : null}
            </>
          ) : null}
        </div>
      </aside>
    </>
  );
}
