/**
 * Wrapper côté Next.js pour parler au serveur OpenCode (sur le VPS).
 *
 * Le client n'est jamais exposé au navigateur — on s'en sert uniquement dans
 * les routes API server-side (`app/api/lead-agent/*`).
 */

import { createOpencodeClient, type OpencodeClient } from "@opencode-ai/sdk";

function required(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

let _client: OpencodeClient | null = null;

export function getOpencodeBaseUrl(): string {
  return required("OPENCODE_URL");
}

export function getOpencodeAuthHeader(): Record<string, string> {
  const user = process.env.OPENCODE_USERNAME?.trim();
  const pass = process.env.OPENCODE_PASSWORD?.trim();
  if (!user || !pass) return {};
  return { Authorization: `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}` };
}

export function opencode(): OpencodeClient {
  if (_client) return _client;
  const baseUrl = getOpencodeBaseUrl();
  const auth = getOpencodeAuthHeader();
  _client = createOpencodeClient({
    baseUrl,
    fetch: ((input, init) =>
      fetch(input, { ...init, headers: { ...(init?.headers ?? {}), ...auth } })) as typeof fetch,
  });
  return _client;
}
