/**
 * Load org-scoped browser cookies for Playwright injection (server-side only).
 * Secrets are stored encrypted (see `encryptSecret` / `decryptSecret`).
 */

import type { Cookie } from "playwright-core";
import { decryptSecret } from "@/lib/integrations/crypto";
import { getAgentDb } from "@/lib/agent/tools/_db";

export type OrgBrowserCredentialKind = "cookies" | "basic_auth";

export interface OrgBrowserCredentialRow {
  id: string;
  org_id: string;
  label: string;
  hostname: string;
  kind: OrgBrowserCredentialKind;
  created_at: string;
  updated_at: string;
}

export function parseHostname(input: string): string {
  const t = input.trim().toLowerCase();
  if (!t) return "";
  try {
    if (t.includes("://")) return new URL(t).hostname;
    return t.replace(/^\.+/, "").split("/")[0] || "";
  } catch {
    return t.replace(/^\.+/, "").split("/")[0] || "";
  }
}

/** Normalize user / export JSON into Playwright `Cookie` objects. */
export function normalizePlaywrightCookies(
  raw: unknown,
  defaultHost: string,
): Cookie[] {
  const host = parseHostname(defaultHost);
  let arr: unknown[] = [];
  if (Array.isArray(raw)) arr = raw;
  else if (raw && typeof raw === "object" && Array.isArray((raw as { cookies?: unknown[] }).cookies)) {
    arr = (raw as { cookies: unknown[] }).cookies;
  } else return [];

  const out: Cookie[] = [];
  for (const item of arr) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const name = String(o.name || "").trim();
    const value = String(o.value ?? "");
    let domain = String(o.domain || "").trim();
    if (!name) continue;
    if (!domain && host) domain = host.startsWith(".") ? host : `.${host}`;
    if (!domain) continue;
    const path = String(o.path || "/") || "/";
    const sameSite = (["Strict", "Lax", "None"].includes(String(o.sameSite))
      ? String(o.sameSite)
      : "Lax") as "Strict" | "Lax" | "None";
    const expiresRaw = o.expires;
    let expires: number | undefined;
    if (typeof expiresRaw === "number" && Number.isFinite(expiresRaw)) {
      expires = expiresRaw > 1e12 ? Math.floor(expiresRaw / 1000) : expiresRaw;
    }
    const c: Cookie = {
      name,
      value,
      domain,
      path,
      sameSite,
      secure: Boolean(o.secure),
      httpOnly: Boolean(o.httpOnly),
      /** Session cookie when unset in export */
      expires: expires !== undefined ? expires : -1,
    };
    out.push(c);
  }
  return out;
}

/**
 * Decrypt stored payload. Expected shapes:
 *  - `{ "cookies": Cookie[] }` or a bare Cookie[] JSON string stored as cookies kind
 *  - `basic_auth` kind: `{ "username": string, "password": string }` (no cookie injection)
 */
export function payloadToPlaywrightCookies(
  kind: OrgBrowserCredentialKind,
  plaintext: string,
  rowHostname: string,
): Cookie[] {
  if (kind !== "cookies") return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(plaintext) as unknown;
  } catch {
    return [];
  }
  if (Array.isArray(parsed)) return normalizePlaywrightCookies(parsed, rowHostname);
  if (parsed && typeof parsed === "object") {
    const c = (parsed as { cookies?: unknown }).cookies;
    if (Array.isArray(c)) return normalizePlaywrightCookies(c, rowHostname);
  }
  return [];
}

/** All Playwright cookies for an org (merged from every `cookies` row). */
export async function loadPlaywrightCookiesForOrg(
  orgId: string,
): Promise<Cookie[]> {
  if (!orgId) return [];
  const db = getAgentDb();
  const { data, error } = await db
    .from("org_browser_credentials")
    .select("id, hostname, kind, secret_ciphertext")
    .eq("org_id", orgId)
    .eq("kind", "cookies");

  if (error || !data?.length) return [];

  const merged: Cookie[] = [];
  const seen = new Set<string>();
  for (const row of data) {
    try {
      const pt = decryptSecret(row.secret_ciphertext as string);
      const cookies = payloadToPlaywrightCookies(
        "cookies",
        pt,
        String(row.hostname || ""),
      );
      for (const c of cookies) {
        const k = `${c.domain}|${c.path}|${c.name}`;
        if (seen.has(k)) continue;
        seen.add(k);
        merged.push(c);
      }
    } catch (e) {
      console.warn(
        "[org_browser_credentials] skip row",
        row.id,
        e instanceof Error ? e.message : e,
      );
    }
  }
  return merged;
}

export async function listOrgBrowserCredentialsMetadata(
  orgId: string,
): Promise<OrgBrowserCredentialRow[]> {
  const db = getAgentDb();
  const { data, error } = await db
    .from("org_browser_credentials")
    .select("id, org_id, label, hostname, kind, created_at, updated_at")
    .eq("org_id", orgId)
    .order("updated_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data || []) as OrgBrowserCredentialRow[];
}
