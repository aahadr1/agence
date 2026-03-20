import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";
import chromiumBinary from "@sparticuz/chromium";
import { GoogleGenerativeAI } from "@google/generative-ai";

const IS_SERVERLESS = !!process.env.VERCEL || !!process.env.AWS_LAMBDA_FUNCTION_NAME;

const GEMINI_MODEL = "gemini-2.5-flash";

let genAIInstance: GoogleGenerativeAI | null = null;

export function getGemini() {
  if (!genAIInstance) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("GEMINI_API_KEY is not set");
    genAIInstance = new GoogleGenerativeAI(apiKey);
  }
  return genAIInstance.getGenerativeModel({ model: GEMINI_MODEL });
}

export async function screenshotToBase64(page: Page): Promise<string> {
  const buffer = await page.screenshot({ type: "jpeg", quality: 70 });
  return buffer.toString("base64");
}

export async function askGemini<T>(prompt: string, imageBase64?: string): Promise<T> {
  const model = getGemini();
  const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [
    { text: prompt },
  ];
  if (imageBase64) {
    parts.push({
      inlineData: { mimeType: "image/jpeg", data: imageBase64 },
    });
  }

  const result = await model.generateContent(parts);
  const text = result.response.text().trim();
  let jsonStr = text;
  if (jsonStr.startsWith("```")) {
    jsonStr = jsonStr.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
  }
  return JSON.parse(jsonStr) as T;
}

export async function askGeminiText(prompt: string): Promise<string> {
  const model = getGemini();
  const result = await model.generateContent(prompt);
  return result.response.text().trim();
}

/**
 * Normalize a URL extracted by Gemini — ensures it has a protocol
 * so Playwright doesn't resolve it relative to the current page (localhost).
 */
export function normalizeUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  let u = url.trim();
  if (!u) return null;
  // Remove accidental localhost prefix that may have leaked in
  u = u.replace(/^https?:\/\/localhost(:\d+)?\/?/, "");
  if (!u) return null;
  // Add protocol if missing
  if (!/^https?:\/\//i.test(u)) {
    u = "https://" + u;
  }
  return u;
}

export interface BrowserSession {
  browser: Browser;
  context: BrowserContext;
  page: Page;
}

export async function launchBrowser(): Promise<BrowserSession> {
  const launchArgs = [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-blink-features=AutomationControlled",
  ];

  let browser: Browser;

  if (IS_SERVERLESS) {
    // On Vercel/Lambda: use @sparticuz/chromium's bundled binary
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cb = chromiumBinary as any;
    cb.setHeadlessMode = true;
    cb.setGraphicsMode = false;
    const executablePath = await chromiumBinary.executablePath();
    browser = await chromium.launch({
      executablePath,
      headless: cb.headless ?? true,
      args: [...chromiumBinary.args, ...launchArgs],
    });
  } else {
    // Local dev: use Playwright's own Chromium
    browser = await chromium.launch({
      headless: true,
      args: launchArgs,
    });
  }

  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    locale: "en-US",
  });

  // Pre-set Google consent cookies
  await context.addCookies([
    {
      name: "CONSENT",
      value: "YES+cb.20240101-00-p0.en+FX+999",
      domain: ".google.com",
      path: "/",
    },
    {
      name: "SOCS",
      value: "CAISHAgBEhJnd3NfMjAyNDAxMDEtMF9SQzIaAmVuIAEaBgiA_LyuBg",
      domain: ".google.com",
      path: "/",
    },
  ]);

  const page = await context.newPage();
  return { browser, context, page };
}

export async function closeBrowser(session: BrowserSession) {
  await session.browser.close();
}

export async function newPage(session: BrowserSession): Promise<Page> {
  return session.context.newPage();
}
