/**
 * agentic_browse — stateful web browsing for the agent.
 *
 * Each call launches a fresh headless Chromium (via the existing Sparticuz
 * setup), restores the session's cookies + last URL from Supabase, performs
 * one action, persists updated state, and returns observations (page text +
 * optional Gemini-extracted answer).
 *
 * Tools:
 *  - browser_navigate(url) : go to URL, return text (truncated)
 *  - browser_act(instruction): take screenshot, ask Gemini what to do next,
 *    execute one action (click/type/scroll), return result
 *  - browser_extract(question): screenshot current page, ask Gemini to answer
 *  - browser_close(): wipe session state
 *
 * State is stored in agent_memory under key "browser_state":
 *   { url: string, cookies: Cookie[], lastText?: string }
 */

import { registerTool } from "../tool-registry";
import { getAgentDb } from "./_db";
import type { AgentContext } from "../types";
import type { BrowserContext, Cookie } from "playwright-core";

interface BrowserState {
  url: string;
  cookies: Cookie[];
  lastText?: string;
}

const STATE_KEY = "browser_state";

async function loadState(sessionId: string): Promise<BrowserState | null> {
  const db = getAgentDb();
  const { data } = await db
    .from("agent_memory")
    .select("value")
    .eq("session_id", sessionId)
    .eq("key", STATE_KEY)
    .maybeSingle();
  return (data?.value as BrowserState) || null;
}

async function saveState(sessionId: string, state: BrowserState) {
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

async function clearState(sessionId: string) {
  const db = getAgentDb();
  await db
    .from("agent_memory")
    .delete()
    .eq("session_id", sessionId)
    .eq("key", STATE_KEY);
}

async function withBrowser<T>(
  state: BrowserState | null,
  fn: (ctx: BrowserContext) => Promise<T>,
): Promise<T> {
  const { withBrowserSession } = await import("@/lib/lead-agent/browser");
  return withBrowserSession(async (session) => {
    if (state?.cookies?.length) {
      try {
        await session.context.addCookies(state.cookies);
      } catch {
        /* ignore invalid cookies from previous sessions */
      }
    }
    return fn(session.context);
  });
}

async function extractPageText(ctx: BrowserContext, url: string): Promise<{
  text: string;
  finalUrl: string;
  cookies: Cookie[];
}> {
  const page = ctx.pages()[0] || (await ctx.newPage());
  const { safeGoto, dismissConsent } = await import("@/lib/lead-agent/browser");
  const loaded = await safeGoto(page, url);
  if (!loaded) throw new Error(`Failed to load ${url}`);
  await dismissConsent(page);
  const finalUrl = page.url();
  const raw = await page.evaluate(() => {
    const body = document.body?.innerText || "";
    return body.replace(/\s+/g, " ").trim();
  });
  const cookies = await ctx.cookies();
  return {
    text: raw.length > 8000 ? raw.slice(0, 8000) + "...(truncated)" : raw,
    finalUrl,
    cookies,
  };
}

// ---------------------------------------------------------------------------
// browser_navigate
// ---------------------------------------------------------------------------
registerTool(
  {
    name: "browser_navigate",
    description:
      "Open a URL in the agent's headless browser and return its visible text. Use for pages that require JavaScript or are not static. State (URL + cookies) persists across subsequent browser_* calls in this session.",
    parameters: {
      url: { type: "string", description: "Absolute http(s) URL" },
    },
    required: ["url"],
    costEstimateCents: 1,
  },
  async (args, context: AgentContext) => {
    if (!context.sessionId)
      throw new Error("browser_navigate requires a session");
    const url = String(args.url);
    if (!/^https?:\/\//i.test(url))
      throw new Error("absolute http(s) URL required");

    const prev = await loadState(context.sessionId);
    const result = await withBrowser(prev, (ctx) => extractPageText(ctx, url));

    await saveState(context.sessionId, {
      url: result.finalUrl,
      cookies: result.cookies,
      lastText: result.text,
    });

    return {
      url: result.finalUrl,
      text: result.text,
      length: result.text.length,
    };
  },
);

// ---------------------------------------------------------------------------
// browser_extract
// ---------------------------------------------------------------------------
registerTool(
  {
    name: "browser_extract",
    description:
      "Take a screenshot of the current browser page and ask a vision model to answer a specific question about it. You must call browser_navigate first.",
    parameters: {
      question: {
        type: "string",
        description: "What you want to know about the current page",
      },
    },
    required: ["question"],
    costEstimateCents: 2,
  },
  async (args, context: AgentContext) => {
    if (!context.sessionId)
      throw new Error("browser_extract requires a session");
    const state = await loadState(context.sessionId);
    if (!state?.url)
      throw new Error("No active browser page. Call browser_navigate first.");

    const { screenshotToBase64, askGemini } = await import(
      "@/lib/lead-agent/browser"
    );

    return withBrowser(state, async (ctx) => {
      const page = ctx.pages()[0] || (await ctx.newPage());
      const { safeGoto } = await import("@/lib/lead-agent/browser");
      await safeGoto(page, state.url);
      const base64 = await screenshotToBase64(page);
      const answer = await askGemini<{ answer: string }>(
        `You are looking at a web page. Answer the user's question based ONLY on what is visible.\n\n` +
          `Question: ${args.question}\n\n` +
          `Return JSON: {"answer": "<concise answer>"}`,
        base64,
      );
      const cookies = await ctx.cookies();
      await saveState(context.sessionId, {
        ...state,
        cookies,
        url: page.url(),
      });
      return { url: page.url(), answer: answer.answer };
    });
  },
);

// ---------------------------------------------------------------------------
// browser_act — vision-guided single action
// ---------------------------------------------------------------------------
registerTool(
  {
    name: "browser_act",
    description:
      "Perform one browser action described in natural language ('click the Contact link', 'type \"agence\" in the search box and press Enter'). Uses vision to locate targets. Prefer browser_navigate for pure URL changes and web_fetch for static reads.",
    parameters: {
      instruction: {
        type: "string",
        description: "What to do on the current page, in plain language",
      },
    },
    required: ["instruction"],
    costEstimateCents: 3,
  },
  async (args, context: AgentContext) => {
    if (!context.sessionId)
      throw new Error("browser_act requires a session");
    const state = await loadState(context.sessionId);
    if (!state?.url)
      throw new Error("No active browser page. Call browser_navigate first.");

    const { screenshotToBase64, askGemini, safeGoto, randomDelay } =
      await import("@/lib/lead-agent/browser");

    return withBrowser(state, async (ctx) => {
      const page = ctx.pages()[0] || (await ctx.newPage());
      await safeGoto(page, state.url);

      const base64 = await screenshotToBase64(page);
      const plan = await askGemini<{
        action:
          | "click_text"
          | "click_selector"
          | "type"
          | "press"
          | "scroll"
          | "done";
        text?: string;
        selector?: string;
        value?: string;
        key?: string;
        reason?: string;
      }>(
        `You control a web browser. Given the screenshot and instruction, emit ONE action JSON.\n\n` +
          `Instruction: ${args.instruction}\n\n` +
          `Schema: {\n` +
          `  "action": "click_text|click_selector|type|press|scroll|done",\n` +
          `  "text": "<visible text to click (for click_text)>",\n` +
          `  "selector": "<CSS selector (for click_selector)>",\n` +
          `  "value": "<text to type (for type)>",\n` +
          `  "key": "<keyboard key (for press, e.g. Enter)>",\n` +
          `  "reason": "<one-sentence why>"\n` +
          `}\n` +
          `Prefer click_text when the target has visible label.`,
        base64,
      );

      let actionTaken = plan.action;
      let ok = true;
      let error: string | null = null;

      try {
        switch (plan.action) {
          case "click_text":
            if (!plan.text) throw new Error("missing text");
            await page.getByText(plan.text, { exact: false }).first().click({
              timeout: 8000,
            });
            break;
          case "click_selector":
            if (!plan.selector) throw new Error("missing selector");
            await page.locator(plan.selector).first().click({ timeout: 8000 });
            break;
          case "type":
            if (!plan.value) throw new Error("missing value");
            if (plan.selector) {
              await page
                .locator(plan.selector)
                .first()
                .fill(plan.value, { timeout: 8000 });
            } else {
              await page.keyboard.type(plan.value, { delay: 25 });
            }
            break;
          case "press":
            await page.keyboard.press(plan.key || "Enter");
            break;
          case "scroll":
            await page.evaluate(() => window.scrollBy(0, window.innerHeight));
            break;
          case "done":
            break;
          default:
            throw new Error(`unknown action ${plan.action}`);
        }
        await randomDelay(600, 1200);
      } catch (e) {
        ok = false;
        error = e instanceof Error ? e.message : String(e);
      }

      const cookies = await ctx.cookies();
      const finalUrl = page.url();
      const text = await page
        .evaluate(() => (document.body?.innerText || "").slice(0, 4000))
        .catch(() => "");

      await saveState(context.sessionId, {
        url: finalUrl,
        cookies,
        lastText: text,
      });

      return {
        ok,
        action: actionTaken,
        reason: plan.reason || null,
        url: finalUrl,
        error,
        preview: text.slice(0, 800),
      };
    });
  },
);

// ---------------------------------------------------------------------------
// browser_close
// ---------------------------------------------------------------------------
registerTool(
  {
    name: "browser_close",
    description:
      "Wipe the browser session state (cookies + last URL). Use when done with a browsing task or before starting a fresh flow.",
    parameters: {},
    required: [],
    costEstimateCents: 0,
  },
  async (_args, context: AgentContext) => {
    if (context.sessionId) await clearState(context.sessionId);
    return { ok: true };
  },
);
