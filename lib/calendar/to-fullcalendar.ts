import type { EventInput } from "@fullcalendar/core";
import { eventTypeColors } from "./event-colors";

export type CalendarEventRow = {
  id: string;
  created_by: string;
  title: string;
  description: string | null;
  starts_at: string;
  ends_at: string;
  event_type: string;
  visibility: string;
  all_day: boolean;
  timezone: string | null;
  location: string | null;
  video_link: string | null;
  recurrence_rule: string | null;
  recurrence_until: string | null;
};

function durationFromRange(
  startIso: string,
  endIso: string,
  allDay: boolean
): EventInput["duration"] {
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime();
  if (ms <= 0) return { minutes: 30 };
  if (allDay) {
    const days = Math.max(1, Math.round(ms / 86400000));
    return { days };
  }
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  if (hours === 0 && minutes === 0) return { minutes: 1 };
  return { hours, minutes };
}

/** Build RFC5545-ish DTSTART line for FullCalendar rrule plugin */
function toIcsDateTime(iso: string, allDay: boolean): string {
  const d = new Date(iso);
  if (allDay) {
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, "0");
    const day = String(d.getUTCDate()).padStart(2, "0");
    return `${y}${m}${day}`;
  }
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
  );
}

function buildRruleString(row: CalendarEventRow): string | null {
  const raw = row.recurrence_rule?.trim();
  if (!raw) return null;
  const dt = toIcsDateTime(row.starts_at, row.all_day);
  let rule = raw;
  if (!rule.toUpperCase().startsWith("RRULE:")) {
    rule = `RRULE:${rule}`;
  }
  if (row.recurrence_until) {
    const until = toIcsDateTime(row.recurrence_until, row.all_day);
    if (!/;UNTIL=/.test(rule)) {
      rule += `;UNTIL=${until}`;
    }
  }
  const prefix = row.all_day ? `DTSTART;VALUE=DATE:${dt}` : `DTSTART:${dt}`;
  return `${prefix}\n${rule}`;
}

export function rowToEventInput(
  row: CalendarEventRow,
  opts?: { editable?: boolean }
): EventInput {
  const editable = opts?.editable ?? true;
  const canDragResize = editable && !row.recurrence_rule?.trim();
  const { bg, border } = eventTypeColors(row.event_type);
  const extendedProps = {
    description: row.description,
    location: row.location,
    video_link: row.video_link,
    event_type: row.event_type,
    visibility: row.visibility,
    created_by: row.created_by,
    recurrence_rule: row.recurrence_rule,
    recurrence_until: row.recurrence_until,
    timezone: row.timezone,
    raw: row,
  };

  const rruleStr = buildRruleString(row);
  if (rruleStr) {
    return {
      id: row.id,
      title: row.title,
      rrule: rruleStr,
      duration: durationFromRange(row.starts_at, row.ends_at, row.all_day),
      allDay: row.all_day,
      backgroundColor: bg,
      borderColor: border,
      textColor: "#171717",
      extendedProps,
      editable,
      startEditable: false,
      durationEditable: false,
    };
  }

  return {
    id: row.id,
    title: row.title,
    start: row.starts_at,
    end: row.ends_at,
    allDay: row.all_day,
    backgroundColor: bg,
    borderColor: border,
    textColor: "#171717",
    extendedProps,
    editable,
    startEditable: canDragResize,
    durationEditable: canDragResize,
  };
}
