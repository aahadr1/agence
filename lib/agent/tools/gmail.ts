import { registerTool } from "../tool-registry";

registerTool(
  {
    name: "gmail_send",
    description:
      "Send an email through the user's connected Gmail account. REQUIRES user approval — always call request_approval first with the full draft.",
    parameters: {
      to: { type: "string", description: "Primary recipient email" },
      subject: { type: "string", description: "Subject line" },
      body: { type: "string", description: "Plain-text body" },
      cc: {
        type: "array",
        description: "Optional CC recipients",
        required: false,
      },
      bcc: {
        type: "array",
        description: "Optional BCC recipients",
        required: false,
      },
    },
    required: ["to", "subject", "body"],
    requiredConnection: "google",
    destructive: true,
    costEstimateCents: 0,
  },
  async (args, context) => {
    const { sendGmail } = await import("@/lib/integrations/gmail");
    return sendGmail(context.userId, {
      to: String(args.to),
      subject: String(args.subject),
      body: String(args.body),
      cc: Array.isArray(args.cc) ? (args.cc as string[]) : undefined,
      bcc: Array.isArray(args.bcc) ? (args.bcc as string[]) : undefined,
    });
  },
);

registerTool(
  {
    name: "gmail_list_recent",
    description:
      "List the user's most recent inbox emails (from, subject, snippet, date).",
    parameters: {
      query: {
        type: "string",
        description: "Gmail search query (optional, e.g. 'is:unread')",
        required: false,
      },
      max: {
        type: "number",
        description: "Max results (default 10, max 25)",
        required: false,
      },
    },
    required: [],
    requiredConnection: "google",
    costEstimateCents: 0,
  },
  async (args, context) => {
    const { listRecentEmails } = await import("@/lib/integrations/gmail");
    return listRecentEmails(context.userId, {
      query: args.query ? String(args.query) : undefined,
      max: args.max ? Number(args.max) : undefined,
    });
  },
);
