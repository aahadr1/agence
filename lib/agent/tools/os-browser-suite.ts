/**
 * Structured browser façade — delegates to existing Playwright tools where possible.
 * Machine-first JSON per action.
 */

import { getTool, registerTool } from "../tool-registry";
import type { AgentContext } from "../types";

async function delegate(
  name: string,
  args: Record<string, unknown>,
  ctx: AgentContext,
): Promise<unknown> {
  const t = getTool(name);
  if (!t) throw new Error(`browser_suite: missing delegate ${name}`);
  return t.execute(args, ctx);
}

registerTool(
  {
    name: "browser_suite",
    description:
      "Façade navigateur unifiée (JSON). Actions: search | open | click | type | extract | screenshot | markdown | links | close. " +
      "`search` délègue à web_search ; `open` à browser_navigate ; click/type à browser_act ; extract à browser_extract ; close à browser_close. " +
      "Pour screenshot/markdown/links il faut une session navigateur active (open avant).",
    parameters: {
      action: {
        type: "string",
        description:
          "search | open | click | type | extract | screenshot | markdown | links | close",
        enum: [
          "search",
          "open",
          "click",
          "type",
          "extract",
          "screenshot",
          "markdown",
          "links",
          "close",
        ],
      },
      query: { type: "string", description: "search: query", required: false },
      count: { type: "number", description: "search: max results", required: false },
      url: { type: "string", description: "open: URL", required: false },
      target: {
        type: "string",
        description: "click/type: visible text or CSS selector hint",
        required: false,
      },
      text: { type: "string", description: "type: text to enter", required: false },
      schema: {
        type: "string",
        description: "extract: question for vision extraction (JSON answer text)",
        required: false,
      },
    },
    required: ["action"],
    costEstimateCents: 1,
    riskLevel: "green",
  },
  async (args, context: AgentContext) => {
    const action = String(args.action || "").toLowerCase();
    if (!context.sessionId) throw new Error("browser_suite requires sessionId");

    switch (action) {
      case "search": {
        const q = String(args.query || "").trim();
        if (!q) throw new Error("search requires query");
        return delegate(
          "web_search",
          { query: q, count: args.count ?? 8 },
          context,
        );
      }
      case "open": {
        const url = String(args.url || "").trim();
        if (!url) throw new Error("open requires url");
        return delegate("browser_navigate", { url }, context);
      }
      case "click": {
        const target = String(args.target || "").trim();
        if (!target) throw new Error("click requires target");
        return delegate(
          "browser_act",
          { instruction: `Click the element: ${target}` },
          context,
        );
      }
      case "type": {
        const target = String(args.target || "").trim();
        const text = String(args.text || "").trim();
        if (!target || !text) throw new Error("type requires target and text");
        return delegate(
          "browser_act",
          {
            instruction: `Click or focus ${target} then type the following text exactly: ${text}`,
          },
          context,
        );
      }
      case "extract": {
        const schema = String(args.schema || "").trim();
        if (!schema) throw new Error("extract requires schema (question)");
        return delegate("browser_extract", { question: schema }, context);
      }
      case "screenshot": {
        const { loadBrowserStateForSuite, withBrowserFromState, screenshotPage } =
          await import("./os-browser-suite_helpers");
        const state = await loadBrowserStateForSuite(context.sessionId);
        if (!state?.url) throw new Error("screenshot requires browser_navigate first");
        const b64 = await withBrowserFromState(context, state, (ctx) =>
          screenshotPage(ctx, state.url),
        );
        return {
          format: "jpeg_base64",
          length: b64.length,
          preview: b64.slice(0, 120),
        };
      }
      case "markdown": {
        const { loadBrowserStateForSuite, withBrowserFromState, pageAsMarkdown } =
          await import("./os-browser-suite_helpers");
        const state = await loadBrowserStateForSuite(context.sessionId);
        if (!state?.url) throw new Error("markdown requires browser_navigate first");
        const md = await withBrowserFromState(context, state, (ctx) =>
          pageAsMarkdown(ctx, state.url),
        );
        return { markdown: md };
      }
      case "links": {
        const { loadBrowserStateForSuite, withBrowserFromState, pageLinks } =
          await import("./os-browser-suite_helpers");
        const state = await loadBrowserStateForSuite(context.sessionId);
        if (!state?.url) throw new Error("links requires browser_navigate first");
        const links = await withBrowserFromState(context, state, (ctx) =>
          pageLinks(ctx, state.url),
        );
        return { links };
      }
      case "close":
        return delegate("browser_close", {}, context);
      default:
        throw new Error(`unknown action: ${action}`);
    }
  },
);
