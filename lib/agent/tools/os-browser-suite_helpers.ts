import type { BrowserContext, Cookie } from "playwright-core";
import type { AgentContext } from "../types";
import { getAgentDb } from "./_db";

const STATE_KEY = "browser_state";

interface BrowserState {
  url: string;
  cookies: Cookie[];
}

export async function loadBrowserStateForSuite(
  sessionId: string,
): Promise<BrowserState | null> {
  const db = getAgentDb();
  const { data } = await db
    .from("agent_memory")
    .select("value")
    .eq("session_id", sessionId)
    .eq("key", STATE_KEY)
    .maybeSingle();
  return (data?.value as BrowserState) || null;
}

export async function withBrowserFromState<T>(
  context: AgentContext,
  state: BrowserState,
  fn: (ctx: BrowserContext) => Promise<T>,
): Promise<T> {
  const { withBrowserSession } = await import("@/lib/lead-agent/browser");
  return withBrowserSession(
    async (session) => {
      const ctx = session.context;
      if (state?.cookies?.length) {
        try {
          await ctx.addCookies(state.cookies);
        } catch {
          /* */
        }
      }
      return fn(ctx);
    },
    { orgId: context.orgId, attempts: 4 },
  );
}

export async function screenshotPage(
  ctx: BrowserContext,
  url: string,
): Promise<string> {
  const page = ctx.pages()[0] || (await ctx.newPage());
  const { safeGoto, screenshotToBase64 } = await import("@/lib/lead-agent/browser");
  await safeGoto(page, url);
  return screenshotToBase64(page);
}

export async function pageAsMarkdown(
  ctx: BrowserContext,
  url: string,
): Promise<string> {
  const page = ctx.pages()[0] || (await ctx.newPage());
  const { safeGoto } = await import("@/lib/lead-agent/browser");
  await safeGoto(page, url);
  const text = await page.evaluate(() => {
    const t = document.body?.innerText || "";
    return t.replace(/\s+/g, " ").trim();
  });
  return text.length > 24_000 ? text.slice(0, 24_000) + "\n\n…(tronqué)" : text;
}

export async function pageLinks(
  ctx: BrowserContext,
  url: string,
): Promise<Array<{ href: string; text: string }>> {
  const page = ctx.pages()[0] || (await ctx.newPage());
  const { safeGoto } = await import("@/lib/lead-agent/browser");
  await safeGoto(page, url);
  return page.evaluate(() => {
    const out: Array<{ href: string; text: string }> = [];
    for (const a of Array.from(document.querySelectorAll<HTMLAnchorElement>("a[href]"))) {
      const href = a.href;
      if (!href || href.startsWith("javascript:")) continue;
      const text = (a.innerText || "").replace(/\s+/g, " ").trim().slice(0, 200);
      out.push({ href, text });
      if (out.length >= 200) break;
    }
    return out;
  });
}
