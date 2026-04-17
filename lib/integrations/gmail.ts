import { google } from "googleapis";
import { getGoogleAuthForUser } from "./google-oauth";

export async function sendGmail(
  userId: string,
  params: {
    to: string;
    subject: string;
    body: string;
    cc?: string[];
    bcc?: string[];
    from?: string;
  },
) {
  const auth = await getGoogleAuthForUser(userId);
  if (!auth) throw new Error("Google account not connected");
  const gmail = google.gmail({ version: "v1", auth: auth.oauth });

  const from = params.from || auth.accountEmail || "me";
  const headers: string[] = [
    `From: ${from}`,
    `To: ${params.to}`,
  ];
  if (params.cc?.length) headers.push(`Cc: ${params.cc.join(", ")}`);
  if (params.bcc?.length) headers.push(`Bcc: ${params.bcc.join(", ")}`);
  headers.push(`Subject: ${encodeSubject(params.subject)}`);
  headers.push("MIME-Version: 1.0");
  headers.push('Content-Type: text/plain; charset="UTF-8"');
  headers.push("Content-Transfer-Encoding: 7bit");

  const raw = headers.join("\r\n") + "\r\n\r\n" + params.body;
  const encoded = Buffer.from(raw)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  const res = await gmail.users.messages.send({
    userId: "me",
    requestBody: { raw: encoded },
  });
  return { id: res.data.id, threadId: res.data.threadId };
}

function encodeSubject(s: string): string {
  if (/^[\x20-\x7E]*$/.test(s)) return s;
  return "=?UTF-8?B?" + Buffer.from(s, "utf8").toString("base64") + "?=";
}

export async function listRecentEmails(
  userId: string,
  opts: { query?: string; max?: number } = {},
) {
  const auth = await getGoogleAuthForUser(userId);
  if (!auth) throw new Error("Google account not connected");
  const gmail = google.gmail({ version: "v1", auth: auth.oauth });

  const list = await gmail.users.messages.list({
    userId: "me",
    q: opts.query,
    maxResults: Math.min(opts.max || 10, 25),
  });
  const ids = list.data.messages || [];
  const out: Array<{
    id: string;
    from: string;
    subject: string;
    snippet: string;
    date: string;
  }> = [];
  for (const m of ids) {
    if (!m.id) continue;
    const msg = await gmail.users.messages.get({
      userId: "me",
      id: m.id,
      format: "metadata",
      metadataHeaders: ["From", "Subject", "Date"],
    });
    const h = msg.data.payload?.headers || [];
    const get = (name: string) =>
      h.find((x) => x.name?.toLowerCase() === name.toLowerCase())?.value || "";
    out.push({
      id: m.id,
      from: get("From"),
      subject: get("Subject"),
      date: get("Date"),
      snippet: msg.data.snippet || "",
    });
  }
  return out;
}
