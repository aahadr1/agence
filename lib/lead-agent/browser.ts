import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
} from "playwright-core";
import chromiumBinary from "@sparticuz/chromium";
import { GoogleGenerativeAI } from "@google/generative-ai";

const IS_SERVERLESS =
  !!process.env.VERCEL || !!process.env.AWS_LAMBDA_FUNCTION_NAME;

const GEMINI_MODEL = "gemini-2.5-flash";

// ---------------------------------------------------------------------------
// Gemini
// ---------------------------------------------------------------------------

let genAIInstance: GoogleGenerativeAI | null = null;

export function getGemini() {
  if (!genAIInstance) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("GEMINI_API_KEY is not set");
    genAIInstance = new GoogleGenerativeAI(apiKey);
  }
  return genAIInstance.getGenerativeModel({ model: GEMINI_MODEL });
}

function extractJson(raw: string): string {
  let s = raw.trim();
  s = s.replace(/<\/?(?:think|thinking)(?:\s[^>]*)?>/gi, "");
  s = s.replace(/^```(?:json)?\s*\n?/m, "").replace(/\n?\s*```\s*$/m, "");

  const objStart = s.indexOf("{");
  const arrStart = s.indexOf("[");

  if (objStart === -1 && arrStart === -1) return s.trim();

  let start: number;
  let end: number;
  if (arrStart === -1 || (objStart !== -1 && objStart < arrStart)) {
    start = objStart;
    end = s.lastIndexOf("}");
  } else {
    start = arrStart;
    end = s.lastIndexOf("]");
  }

  if (end <= start) return s.trim();
  return s.slice(start, end + 1);
}

const MAX_RETRIES = 2;

export async function askGemini<T>(
  prompt: string,
  imageBase64?: string
): Promise<T> {
  const model = getGemini();
  const parts: Array<
    { text: string } | { inlineData: { mimeType: string; data: string } }
  > = [{ text: prompt }];
  if (imageBase64) {
    parts.push({
      inlineData: { mimeType: "image/jpeg", data: imageBase64 },
    });
  }

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const result = await model.generateContent(parts);
      const text = result.response.text().trim();
      if (!text) throw new Error("Gemini returned empty response");
      const jsonStr = extractJson(text);
      return JSON.parse(jsonStr) as T;
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));
      const msg = lastError.message.toLowerCase();
      if (
        msg.includes("api key") ||
        msg.includes("quota") ||
        msg.includes("permission")
      ) {
        throw lastError;
      }
      if (attempt < MAX_RETRIES) {
        await sleep(1000 * (attempt + 1));
      }
    }
  }

  throw lastError!;
}

export async function askGeminiText(prompt: string): Promise<string> {
  const model = getGemini();
  const result = await model.generateContent(prompt);
  return result.response.text().trim();
}

// ---------------------------------------------------------------------------
// URL helpers
// ---------------------------------------------------------------------------

export function normalizeUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  let u = url.trim();
  if (!u) return null;
  u = u.replace(/^https?:\/\/localhost(:\d+)?\/?/, "");
  if (!u) return null;
  if (!/^https?:\/\//i.test(u)) u = "https://" + u;
  return u;
}

// ---------------------------------------------------------------------------
// Stealth helpers
// ---------------------------------------------------------------------------

const USER_AGENTS = [
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Safari/605.1.15",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
];

function randomUA(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

const STEALTH_SCRIPT = `
Object.defineProperty(navigator,'webdriver',{get:()=>undefined});
window.chrome={runtime:{},loadTimes:()=>({}),csi:()=>({}),app:{}};
Object.defineProperty(navigator,'plugins',{get:()=>[1,2,3,4,5]});
Object.defineProperty(navigator,'languages',{get:()=>['fr-FR','fr','en-US','en']});
const _pq=window.navigator.permissions.query.bind(window.navigator.permissions);
window.navigator.permissions.query=(p)=>p.name==='notifications'
  ?Promise.resolve({state:Notification.permission}):_pq(p);
`;

// ---------------------------------------------------------------------------
// Timing helpers (exported for source files)
// ---------------------------------------------------------------------------

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function randomDelay(min: number, max: number): Promise<void> {
  return sleep(min + Math.floor(Math.random() * (max - min)));
}

// ---------------------------------------------------------------------------
// CAPTCHA & consent helpers (exported for source files)
// ---------------------------------------------------------------------------

export async function isCaptchaPage(page: Page): Promise<boolean> {
  const url = page.url();
  if (
    url.includes("/sorry/") ||
    url.includes("captcha") ||
    url.includes("/challenge/")
  )
    return true;

  try {
    const body = await page.textContent("body", { timeout: 2000 });
    if (!body) return false;
    const lower = body.toLowerCase();
    return (
      lower.includes("unusual traffic") ||
      lower.includes("pas un robot") ||
      lower.includes("not a robot") ||
      lower.includes("solve this puzzle") ||
      (lower.includes("captcha") && !lower.includes("recaptcha"))
    );
  } catch {
    return false;
  }
}

const CONSENT_SELECTORS = [
  "#didomi-notice-agree-button",
  'button:has-text("Tout accepter")',
  'button:has-text("Accepter")',
  'button:has-text("Accept all")',
  'button:has-text("Accepter et fermer")',
  "button:has-text(\"J'accepte\")",
  'button:has-text("Allow all cookies")',
  'button:has-text("Autoriser")',
  '[data-testid="cookie-policy-manage-dialog-accept-button"]',
];

export async function dismissConsent(page: Page): Promise<void> {
  for (const sel of CONSENT_SELECTORS) {
    try {
      const btn = page.locator(sel).first();
      if (await btn.isVisible({ timeout: 1500 })) {
        await btn.click();
        await randomDelay(400, 800);
        return;
      }
    } catch {
      /* */
    }
  }
}

// ---------------------------------------------------------------------------
// Navigation helpers
// ---------------------------------------------------------------------------

/** Navigate to a URL, dismiss consent, return true if page loaded */
export async function safeGoto(
  page: Page,
  url: string,
  log?: (msg: string) => void,
  timeoutMs = 18000
): Promise<boolean> {
  try {
    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: timeoutMs,
    });
    await randomDelay(1500, 2500);
    await dismissConsent(page);

    if (await isCaptchaPage(page)) {
      log?.("⚠ CAPTCHA detected — skipping");
      return false;
    }
    return true;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (
      msg.includes("closed") ||
      msg.includes("Target closed") ||
      msg.includes("Protocol error")
    ) {
      throw e; // re-throw browser-dead errors
    }
    log?.(`Navigation failed: ${msg.slice(0, 80)}`);
    return false;
  }
}

/** Take a screenshot and ask Gemini to extract structured data */
export async function screenshotAndAsk<T>(
  page: Page,
  prompt: string
): Promise<T> {
  const base64 = await screenshotToBase64(page);
  return askGemini<T>(prompt, base64);
}

// ---------------------------------------------------------------------------
// Screenshot
// ---------------------------------------------------------------------------

export async function screenshotToBase64(page: Page): Promise<string> {
  const buffer = await page.screenshot({
    type: "jpeg",
    quality: IS_SERVERLESS ? 50 : 70,
  });
  return buffer.toString("base64");
}

// ---------------------------------------------------------------------------
// Browser lifecycle
// ---------------------------------------------------------------------------

export interface BrowserSession {
  browser: Browser;
  context: BrowserContext;
  page: Page;
}

export function isBrowserAlive(session: BrowserSession): boolean {
  try {
    return session.browser.isConnected();
  } catch {
    return false;
  }
}

export async function safeClose(
  session: BrowserSession | null
): Promise<void> {
  if (!session) return;
  try {
    if (session.browser.isConnected()) await session.browser.close();
  } catch {
    /* already dead */
  }
}

export async function launchBrowser(): Promise<BrowserSession> {
  const args = [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-blink-features=AutomationControlled",
    "--disable-dev-shm-usage",
    "--disable-gpu",
    "--single-process",
    "--no-zygote",
  ];

  let browser!: Browser;
  const maxAttempts = 2;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      if (IS_SERVERLESS) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const cb = chromiumBinary as any;
        cb.setHeadlessMode = true;
        cb.setGraphicsMode = false;
        const executablePath = await chromiumBinary.executablePath();
        browser = await chromium.launch({
          executablePath,
          headless: cb.headless ?? true,
          args: [...chromiumBinary.args, ...args],
        });
      } else {
        browser = await chromium.launch({ headless: true, args });
      }
      break;
    } catch (e) {
      if (attempt === maxAttempts) {
        throw new Error(
          `Browser launch failed after ${maxAttempts} attempts: ${e instanceof Error ? e.message : e}`
        );
      }
      await sleep(2000);
    }
  }

  const vw = IS_SERVERLESS
    ? 1024
    : 1280 + Math.floor(Math.random() * 80);
  const vh = IS_SERVERLESS ? 768 : 900 + Math.floor(Math.random() * 60);

  const context = await browser.newContext({
    viewport: { width: vw, height: vh },
    userAgent: randomUA(),
    locale: "fr-FR",
    timezoneId: "Europe/Paris",
  });

  await context.addInitScript(STEALTH_SCRIPT);

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
  await safeClose(session);
}

export async function newPage(session: BrowserSession): Promise<Page> {
  return session.context.newPage();
}
