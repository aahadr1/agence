import { google } from "googleapis";
import { getGoogleAuthForUser } from "./google-oauth";

export async function createCalendarEvent(
  userId: string,
  params: {
    summary: string;
    description?: string;
    startIso: string;
    endIso: string;
    attendees?: string[];
    location?: string;
    timeZone?: string;
  },
) {
  const auth = await getGoogleAuthForUser(userId);
  if (!auth) {
    throw new Error(
      "Google Calendar requires a connected Google account. Connect Google in the app settings, then retry.",
    );
  }
  const cal = google.calendar({ version: "v3", auth: auth.oauth });
  const res = await cal.events.insert({
    calendarId: "primary",
    sendUpdates: "all",
    requestBody: {
      summary: params.summary,
      description: params.description,
      location: params.location,
      start: {
        dateTime: params.startIso,
        timeZone: params.timeZone || "Europe/Paris",
      },
      end: {
        dateTime: params.endIso,
        timeZone: params.timeZone || "Europe/Paris",
      },
      attendees: params.attendees?.map((email) => ({ email })),
    },
  });
  return {
    id: res.data.id,
    htmlLink: res.data.htmlLink,
    status: res.data.status,
  };
}

export async function listUpcomingEvents(
  userId: string,
  opts: { max?: number; timeMinIso?: string } = {},
) {
  const auth = await getGoogleAuthForUser(userId);
  if (!auth) {
    throw new Error(
      "Google Calendar requires a connected Google account. Connect Google in the app settings, then retry.",
    );
  }
  const cal = google.calendar({ version: "v3", auth: auth.oauth });
  const res = await cal.events.list({
    calendarId: "primary",
    timeMin: opts.timeMinIso || new Date().toISOString(),
    maxResults: Math.min(opts.max || 10, 25),
    singleEvents: true,
    orderBy: "startTime",
  });
  return (res.data.items || []).map((e) => ({
    id: e.id,
    summary: e.summary,
    start: e.start?.dateTime || e.start?.date,
    end: e.end?.dateTime || e.end?.date,
    attendees: e.attendees?.map((a) => a.email),
    htmlLink: e.htmlLink,
  }));
}
