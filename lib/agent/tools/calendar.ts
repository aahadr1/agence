import { registerTool } from "../tool-registry";

registerTool(
  {
    name: "calendar_create_event",
    description:
      "Create a Google Calendar event on the user's primary calendar. REQUIRES user approval for external attendees.",
    parameters: {
      summary: { type: "string", description: "Event title" },
      start_iso: {
        type: "string",
        description: "ISO 8601 start datetime (with timezone)",
      },
      end_iso: {
        type: "string",
        description: "ISO 8601 end datetime (with timezone)",
      },
      description: {
        type: "string",
        description: "Optional description",
        required: false,
      },
      location: {
        type: "string",
        description: "Optional location",
        required: false,
      },
      attendees: {
        type: "array",
        items: { type: "string" },
        description: "Optional list of attendee emails",
        required: false,
      },
      time_zone: {
        type: "string",
        description: "IANA timezone (default Europe/Paris)",
        required: false,
      },
    },
    required: ["summary", "start_iso", "end_iso"],
    requiredConnection: "google",
    destructive: true,
    costEstimateCents: 0,
  },
  async (args, context) => {
    const { createCalendarEvent } = await import(
      "@/lib/integrations/google-calendar"
    );
    return createCalendarEvent(context.userId, {
      summary: String(args.summary),
      startIso: String(args.start_iso),
      endIso: String(args.end_iso),
      description: args.description ? String(args.description) : undefined,
      location: args.location ? String(args.location) : undefined,
      attendees: Array.isArray(args.attendees)
        ? (args.attendees as string[])
        : undefined,
      timeZone: args.time_zone ? String(args.time_zone) : undefined,
    });
  },
);

registerTool(
  {
    name: "calendar_list_upcoming",
    description:
      "List the user's upcoming calendar events (default: starting from now).",
    parameters: {
      max: {
        type: "number",
        description: "Max results (default 10, max 25)",
        required: false,
      },
      time_min_iso: {
        type: "string",
        description: "Optional ISO 8601 lower bound (default: now)",
        required: false,
      },
    },
    required: [],
    requiredConnection: "google",
    costEstimateCents: 0,
  },
  async (args, context) => {
    const { listUpcomingEvents } = await import(
      "@/lib/integrations/google-calendar"
    );
    return listUpcomingEvents(context.userId, {
      max: args.max ? Number(args.max) : undefined,
      timeMinIso: args.time_min_iso ? String(args.time_min_iso) : undefined,
    });
  },
);
