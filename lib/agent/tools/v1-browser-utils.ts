import type { BrowserContext, Cookie, Page } from "playwright-core";
import type { AgentContext } from "../types";
import { getAgentDb } from "./_db";

export interface V1BrowserState {
  url: string;
  cookies: Cookie[];
  lastText?: string;
}

export interface V1SearchResult {
  title: string;
  url: string;
  snippet: string;
}

const STATE_KEY = "v1_browser_state";

export async function loadV1BrowserState(
  sessionId: string,
): Promise<V1BrowserState | null> {
  const db = getAgentDb();
  const { data } = await db
    .from("agent_memory")
    .select("value")
    .eq("session_id", sessionId)
    .eq("key", STATE_KEY)
    .maybeSingle();
  return (data?.value as V1BrowserState) || null;
}

export async function saveV1BrowserState(
  sessionId: string,
  state: V1BrowserState,
): Promise<void> {
  const db = getAgentDb();
  await db.from("agent_memory").upsert(
    {
      session_id: sessionId,
      key: STATE_KEY,
      value: state,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "session_id,key" },
  );
}

export async function clearV1BrowserState(sessionId: string): Promise<void> {
  const db = getAgentDb();
  await db
    .from("agent_memory")
    .delete()
    .eq("session_id", sessionId)
    .eq("key", STATE_KEY);
}

export async function withV1Browser<T>(
  context: AgentContext,
  state: V1BrowserState | null,
  fn: (ctx: BrowserContext, page: Page) => Promise<T>,
): Promise<T> {
  const { withBrowserSession } = await import("@/lib/lead-agent/browser");
  return withBrowserSession(
    async (session) => {
      if (state?.cookies?.length) {
        await session.context.addCookies(state.cookies).catch(() => {});
      }
      return fn(session.context, session.page);
    },
    { orgId: context.orgId, attempts: 8 },
  );
}

export async function extractRenderedText(
  page: Page,
  maxChars = 12000,
): Promise<{ title: string; text: string; html: string }> {
  const payload = await page.evaluate(() => {
    const clone = document.documentElement.cloneNode(true) as HTMLElement;
    clone
      .querySelectorAll("script,style,noscript,svg,canvas")
      .forEach((el) => el.remove());
    const body = clone.querySelector("body");
    const text = (body?.textContent || "")
      .replace(/\s+/g, " ")
      .trim();
    return {
      title: document.title || "",
      text,
      html: document.documentElement.outerHTML,
    };
  });

  return {
    title: payload.title,
    text:
      payload.text.length > maxChars
        ? payload.text.slice(0, maxChars) + "\n...(truncated)"
        : payload.text,
    html:
      payload.html.length > maxChars * 3
        ? payload.html.slice(0, maxChars * 3) + "\n<!-- truncated -->"
        : payload.html,
  };
}

async function scrapeGoogle(
  page: Page,
  query: string,
  count: number,
): Promise<V1SearchResult[]> {
  const { navigateForScrape } = await import("@/lib/lead-agent/browser");
  const url = `https://www.google.com/search?q=${encodeURIComponent(query)}&hl=fr&num=${Math.min(
    count * 2,
    30,
  )}`;
  const nav = await navigateForScrape(page, url, undefined, 20000);
  if (!nav.ok) return [];

  return page.evaluate((max) => {
    const out: Array<{ title: string; url: string; snippet: string }> = [];
    const blocks = Array.from(
      document.querySelectorAll<HTMLElement>("div.g, div[data-hveid]"),
    );
    for (const b of blocks) {
      const a = b.querySelector<HTMLAnchorElement>("a[href^='http']");
      const h = b.querySelector("h3");
      if (!a || !h) continue;
      const href = a.href;
      let host = "";
      try {
        host = new URL(href).hostname;
      } catch {
        continue;
      }
      if (!href || /(^|\.)google\./.test(host)) continue;
      const snippetNode =
        b.querySelector<HTMLElement>("div.VwiC3b") ||
        b.querySelector<HTMLElement>("[data-sncf]") ||
        b.querySelector<HTMLElement>("span");
      const title = (h.textContent || "").replace(/\s+/g, " ").trim();
      const snippet = (snippetNode?.textContent || "")
        .replace(/\s+/g, " ")
        .trim();
      if (!title || out.some((r) => r.url === href)) continue;
      out.push({ title, url: href, snippet });
      if (out.length >= max) break;
    }
    return out;
  }, count);
}

async function scrapeDuckDuckGo(
  page: Page,
  query: string,
  count: number,
): Promise<V1SearchResult[]> {
  const { navigateForScrape } = await import("@/lib/lead-agent/browser");
  const url = `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const nav = await navigateForScrape(page, url, undefined, 20000);
  if (!nav.ok) return [];

  return page.evaluate((max) => {
    const out: Array<{ title: string; url: string; snippet: string }> = [];
    const blocks = Array.from(
      document.querySelectorAll<HTMLElement>(".result, .result__body"),
    );
    for (const b of blocks) {
      const a = b.querySelector<HTMLAnchorElement>("a.result__a");
      if (!a) continue;
      let href = a.href;
      try {
        const wrapped = new URL(href).searchParams.get("uddg");
        if (wrapped) href = wrapped;
      } catch {
        /* keep href */
      }
      const title = (a.textContent || "").replace(/\s+/g, " ").trim();
      const snippet = (
        b.querySelector<HTMLElement>(".result__snippet")?.textContent || ""
      )
        .replace(/\s+/g, " ")
        .trim();
      if (!title || !href || out.some((r) => r.url === href)) continue;
      out.push({ title, url: href, snippet });
      if (out.length >= max) break;
    }
    return out;
  }, count);
}

export async function searchWebWithBrowser(
  page: Page,
  query: string,
  count = 8,
  engine: "google" | "duckduckgo" = "google",
): Promise<{ provider: "google" | "duckduckgo"; results: V1SearchResult[] }> {
  const max = Math.min(Math.max(count, 1), 15);
  if (engine === "duckduckgo") {
    const ddg = await scrapeDuckDuckGo(page, query, max);
    if (ddg.length > 0) return { provider: "duckduckgo", results: ddg };
    return { provider: "google", results: await scrapeGoogle(page, query, max) };
  }

  const google = await scrapeGoogle(page, query, max);
  if (google.length > 0) return { provider: "google", results: google };
  return {
    provider: "duckduckgo",
    results: await scrapeDuckDuckGo(page, query, max),
  };
}

export function uniqueByBusinessKey<T extends { business_name?: string | null; address?: string | null }>(
  rows: T[],
): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const row of rows) {
    const key = `${row.business_name || ""}|${row.address || ""}`
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

export function buildQueryVariants(params: {
  niche: string;
  location: string;
  constraints?: string | null;
}): string[] {
  const niche = params.niche.trim();
  const location = params.location.trim();
  const constraints = params.constraints?.trim();
  const base = constraints ? `${niche} ${constraints}` : niche;
  return [
    `${base} ${location}`,
    `${niche} près de ${location}`,
    `${niche} ${location} contact`,
    `${niche} ${location} site officiel`,
    `${niche} ${location} societe.com`,
    `${niche} ${location} pappers dirigeant`,
  ].filter((q, i, a) => q.trim() && a.indexOf(q) === i);
}
