/**
 * Helpers partagés par tous les tools custom.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";

let _supabase: SupabaseClient | null = null;
export function supabase(): SupabaseClient {
  if (_supabase) return _supabase;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing");
  }
  _supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return _supabase;
}

let _browser: Browser | null = null;

export async function getBrowser(): Promise<Browser> {
  if (_browser && _browser.isConnected()) return _browser;
  _browser = await chromium.launch({
    headless: true,
    args: [
      "--disable-blink-features=AutomationControlled",
      "--disable-dev-shm-usage",
      "--no-sandbox",
    ],
  });
  return _browser;
}

export async function newPage(): Promise<{ page: Page; ctx: BrowserContext }> {
  const browser = await getBrowser();
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    locale: "fr-FR",
  });
  const page = await ctx.newPage();
  return { page, ctx };
}

export async function closePage(ctx: BrowserContext) {
  try {
    await ctx.close();
  } catch {
    /* dead */
  }
}

export function stripAccents(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

export function normalizeName(name: string): string {
  return stripAccents(name)
    .toLowerCase()
    .replace(/\b(sarl|sas|sa|eurl|sci|sasu|snc|ei|selarl|sarlu)\b/gi, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function cityFromLocation(location: string): string {
  return stripAccents(location.replace(/\b\d{5}\b/g, "").replace(/^[^,]*,/, "").trim())
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function postalFromLocation(location: string): string | null {
  const m = location.match(/\b(\d{5})\b/);
  return m ? m[1] : null;
}

export async function fetchJson<T>(
  url: string,
  init?: RequestInit & { timeoutMs?: number },
): Promise<{ ok: true; data: T } | { ok: false; error: string; status?: number }> {
  const timeoutMs = init?.timeoutMs ?? 12_000;
  try {
    const res = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return {
        ok: false,
        error: `HTTP ${res.status}: ${text.slice(0, 200)}`,
        status: res.status,
      };
    }
    const data = (await res.json()) as T;
    return { ok: true, data };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

export const PAPPERS_TRANCHE: Record<string, string> = {
  NN: "Non renseigné",
  "00": "0",
  "01": "1-2",
  "02": "3-5",
  "03": "6-9",
  "11": "10-19",
  "12": "20-49",
  "21": "50-99",
  "22": "100-199",
  "31": "200-249",
  "32": "250-499",
  "41": "500-999",
  "42": "1 000-1 999",
  "51": "2 000-4 999",
  "52": "5 000-9 999",
  "53": "10 000+",
};
