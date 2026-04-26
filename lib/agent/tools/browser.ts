import { registerTool } from "../tool-registry";
import type { AgentContext } from "../types";
import {
  clearV1BrowserState,
  extractRenderedText,
  loadV1BrowserState,
  saveV1BrowserState,
  searchWebWithBrowser,
  withV1Browser,
} from "./v1-browser-utils";

registerTool(
  {
    name: "browser",
    description:
      "Unified Playwright browser. Actions: search, open, click, type, press, scroll, extract, screenshot, close. Use it for Google, Google Maps, business websites, Societe.com pages, and general browsing.",
    parameters: {
      action: {
        type: "string",
        description:
          "search | open | click | type | press | scroll | extract | screenshot | close",
        enum: [
          "search",
          "open",
          "click",
          "type",
          "press",
          "scroll",
          "extract",
          "screenshot",
          "close",
        ],
      },
      query: { type: "string", description: "search query", required: false },
      url: { type: "string", description: "URL to open", required: false },
      target: {
        type: "string",
        description: "visible text or CSS selector hint for click/type",
        required: false,
      },
      text: { type: "string", description: "text to type", required: false },
      key: { type: "string", description: "keyboard key for press", required: false },
      question: {
        type: "string",
        description: "specific extraction question",
        required: false,
      },
      count: {
        type: "number",
        description: "search result count, default 8, max 15",
        required: false,
      },
      engine: {
        type: "string",
        description: "search engine preference: google or duckduckgo",
        enum: ["google", "duckduckgo"],
        required: false,
      },
      include_html: {
        type: "boolean",
        description: "open/extract: include truncated HTML",
        required: false,
      },
    },
    required: ["action"],
    costEstimateCents: 1,
  },
  async (args, context: AgentContext) => {
    if (!context.sessionId) throw new Error("browser requires sessionId");

    const action = String(args.action || "").toLowerCase();
    if (action === "close") {
      await clearV1BrowserState(context.sessionId);
      return { ok: true };
    }

    const state = await loadV1BrowserState(context.sessionId);

    return withV1Browser(context, state, async (browserContext, page) => {
      if (state?.url && action !== "open" && action !== "search") {
        const { safeGoto } = await import("@/lib/lead-agent/browser");
        await safeGoto(page, state.url);
      }

      if (action === "search") {
        const query = String(args.query || "").trim();
        if (!query) throw new Error("browser.search requires query");
        const count = Math.min(Math.max(Number(args.count) || 8, 1), 15);
        const engine =
          String(args.engine || "google") === "duckduckgo"
            ? "duckduckgo"
            : "google";
        const { provider, results } = await searchWebWithBrowser(
          page,
          query,
          count,
          engine,
        );
        await saveV1BrowserState(context.sessionId, {
          url: page.url(),
          cookies: await browserContext.cookies(),
          lastText: results.map((r) => `${r.title} ${r.snippet}`).join("\n"),
        });
        return { query, provider, count: results.length, results };
      }

      if (action === "open") {
        const url = String(args.url || "").trim();
        if (!/^https?:\/\//i.test(url)) {
          throw new Error("browser.open requires an absolute http(s) URL");
        }
        const { safeGoto, diagnosePageAccess } = await import(
          "@/lib/lead-agent/browser"
        );
        const loaded = await safeGoto(page, url);
        const diag = loaded ? await diagnosePageAccess(page) : null;
        const payload = loaded
          ? await extractRenderedText(page)
          : { title: "", text: "", html: "" };
        await saveV1BrowserState(context.sessionId, {
          url: page.url(),
          cookies: await browserContext.cookies(),
          lastText: payload.text,
        });
        return {
          url,
          final_url: page.url(),
          loaded,
          title: payload.title,
          content: payload.text,
          length: payload.text.length,
          ...(args.include_html ? { html: payload.html } : {}),
          ...(diag?.captcha || diag?.login_wall
            ? {
                blocked: true,
                credential_required: diag.login_wall,
                credential_hostname: diag.credential_hostname,
                suggested_user_action_fr: diag.suggested_action_fr,
              }
            : {}),
        };
      }

      if (!state?.url) {
        throw new Error("No active browser page. Call browser.open or browser.search first.");
      }

      if (action === "click") {
        const target = String(args.target || "").trim();
        if (!target) throw new Error("browser.click requires target");
        const locator = /^[.#\[]|:has|>>|^xpath=|^css=/i.test(target)
          ? page.locator(target.replace(/^css=/i, ""))
          : page.getByText(target, { exact: false });
        await locator.first().click({ timeout: 10000 });
      } else if (action === "type") {
        const target = String(args.target || "").trim();
        const text = String(args.text || "");
        if (!target || !text) throw new Error("browser.type requires target and text");
        const locator = /^[.#\[]|:has|>>|^xpath=|^css=/i.test(target)
          ? page.locator(target.replace(/^css=/i, ""))
          : page.getByLabel(target, { exact: false });
        await locator.first().fill(text, { timeout: 10000 });
      } else if (action === "press") {
        await page.keyboard.press(String(args.key || "Enter"));
      } else if (action === "scroll") {
        await page.evaluate(() => window.scrollBy(0, window.innerHeight));
      } else if (action !== "extract" && action !== "screenshot") {
        throw new Error(`Unknown browser action: ${action}`);
      }

      await page.waitForTimeout(750).catch(() => {});
      const payload = await extractRenderedText(page);
      const cookies = await browserContext.cookies();
      await saveV1BrowserState(context.sessionId, {
        url: page.url(),
        cookies,
        lastText: payload.text,
      });

      if (action === "screenshot") {
        const buffer = await page.screenshot({ type: "jpeg", quality: 70 });
        return {
          url: page.url(),
          format: "jpeg_base64",
          base64: buffer.toString("base64"),
        };
      }

      if (action === "extract") {
        const question = String(args.question || "").trim();
        if (!question) {
          return {
            url: page.url(),
            title: payload.title,
            content: payload.text,
            ...(args.include_html ? { html: payload.html } : {}),
          };
        }
        try {
          const { screenshotToBase64, askGemini } = await import(
            "@/lib/lead-agent/browser"
          );
          const answer = await askGemini<{ answer: string }>(
            `Answer from the visible page only. Question: ${question}. Return JSON {"answer":"..."}.`,
            await screenshotToBase64(page),
          );
          return {
            url: page.url(),
            title: payload.title,
            answer: answer.answer,
            evidence_text: payload.text.slice(0, 4000),
          };
        } catch (e) {
          return {
            url: page.url(),
            title: payload.title,
            answer: null,
            extraction_error: e instanceof Error ? e.message : String(e),
            evidence_text: payload.text.slice(0, 6000),
          };
        }
      }

      return {
        ok: true,
        action,
        url: page.url(),
        title: payload.title,
        preview: payload.text.slice(0, 2000),
      };
    });
  },
);
