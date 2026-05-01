import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
  type Response,
} from "playwright-core";
import chromiumBinary from "@sparticuz/chromium";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { loadPlaywrightCookiesForOrg } from "@/lib/agent/org-browser-credentials";
import {
  listGeminiApiKeysInOrder,
  shouldRotateGeminiApiKey,
} from "@/lib/ai/gemini-keys";

const IS_SERVERLESS =
  !!process.env.VERCEL || !!process.env.AWS_LAMBDA_FUNCTION_NAME;

const GEMINI_MODEL = "gemini-2.5-flash";

// ---------------------------------------------------------------------------
// Gemini
// ---------------------------------------------------------------------------

/** First key only — prefer askGemini / askGeminiText for automatic fallbacks. */
export function getGemini() {
  const keys = listGeminiApiKeysInOrder();
  if (!keys.length) throw new Error("GEMINI_API_KEY is not set");
  return new GoogleGenerativeAI(keys[0]!).getGenerativeModel({
    model: GEMINI_MODEL,
  });
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
  const keys = listGeminiApiKeysInOrder();
  if (!keys.length) throw new Error("GEMINI_API_KEY is not set");

  let lastError: Error | null = null;
  for (let ki = 0; ki < keys.length; ki++) {
    const key = keys[ki]!;
    const model = new GoogleGenerativeAI(key).getGenerativeModel({
      model: GEMINI_MODEL,
    });
    try {
      const result = await model.generateContent(prompt);
      return result.response.text().trim();
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));
      if (shouldRotateGeminiApiKey(e)) {
        console.warn(
          `[Gemini browser] key #${ki + 1}/${keys.length} rejected — trying next from env`,
        );
        continue;
      }
      throw lastError;
    }
  }
  throw lastError ?? new Error("askGeminiText failed");
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

export interface PageAccessDiagnostics {
  captcha: boolean;
  login_wall: boolean;
  hostname: string;
  /** Host key to use when saving cookies (no leading www). */
  credential_hostname: string;
  suggested_action_fr: string | null;
}

/**
 * After navigation, detect captcha interstitials or obvious login walls so the
 * agent can pause and ask the user to add org-scoped session cookies.
 */
export async function diagnosePageAccess(
  page: Page,
): Promise<PageAccessDiagnostics> {
  let hostname = "";
  try {
    hostname = new URL(page.url()).hostname;
  } catch {
    hostname = "";
  }
  const credentialHostname = hostname.replace(/^www\./, "") || hostname;

  if (await isCaptchaPage(page)) {
    return {
      captcha: true,
      login_wall: false,
      hostname,
      credential_hostname: credentialHostname,
      suggested_action_fr:
        "Interstitiel captcha / trafic inhabituel. Réessayez plus tard, changez de réseau, ou ouvrez le site dans votre navigateur, exportez les cookies pour ce domaine et ajoutez-les dans Identifiants navigateur (session agent).",
    };
  }

  const url = page.url().toLowerCase();
  const authSegments = [
    "/login",
    "/signin",
    "/sign-in",
    "/connexion",
    "/checkpoint",
    "/authwall",
    "/oauth/authorize",
    "/u/login",
    "/login.php",
    "/account/login",
    "/signup",
    "/session/",
  ];
  let login_wall = authSegments.some((s) => url.includes(s));

  try {
    const title = ((await page.title()) || "").toLowerCase();
    const bareHost = hostname.replace(/^www\./, "");
    const social =
      bareHost.startsWith("linkedin.") ||
      bareHost.startsWith("facebook.") ||
      bareHost.startsWith("instagram.");
    if (
      social &&
      (title.includes("sign in") ||
        title.includes("log in") ||
        title.includes("connexion") ||
        title.includes("join linkedin") ||
        title.includes("créer un compte"))
    ) {
      login_wall = true;
    }
    if (!login_wall && bareHost.startsWith("linkedin.")) {
      const n = await page.locator('input[type="password"]:visible').count();
      if (n > 0) login_wall = true;
    }
  } catch {
    /* */
  }

  const suggested = login_wall
    ? `La page (${hostname}) exige une session authentifiée. Dans l’interface Agent → Identifiants navigateur, ajoutez un export cookies (format Playwright / navigateur) pour « ${credentialHostname} » depuis une fenêtre où vous êtes déjà connecté, puis relancez l’outil.`
    : null;

  return {
    captcha: false,
    login_wall,
    hostname,
    credential_hostname: credentialHostname,
    suggested_action_fr: suggested,
  };
}

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

/** Block reason from `navigateForScrape` when navigation did not yield a readable page. */
export type NavigateForScrapeBlocked =
  | "captcha"
  | "auth_wall"
  | "navigation_failed";

export type NavigateForScrapeResult =
  | { ok: true; response: Response | null }
  | {
      ok: false;
      blocked: NavigateForScrapeBlocked;
      diagnostic?: PageAccessDiagnostics;
      message?: string;
    };

/**
 * Single entry for scrape flows: goto, consent, Google consent interstitial,
 * then captcha / login-wall detection so callers can return structured errors
 * instead of empty DOM.
 */
export async function navigateForScrape(
  page: Page,
  url: string,
  log?: (msg: string) => void,
  timeoutMs = 20000,
): Promise<NavigateForScrapeResult> {
  const runGoto = async (target: string): Promise<Response | null> => {
    const response = await page.goto(target, {
      waitUntil: "domcontentloaded",
      timeout: timeoutMs,
    });
    await randomDelay(1500, 2500);
    await dismissConsent(page);
    return response;
  };

  try {
    let response = await runGoto(url);

    if (page.url().includes("consent.google.com")) {
      log?.("[nav] consent.google.com — accepting cookies and reloading target");
      const acceptBtn = page
        .locator(
          'button:has-text("Tout accepter"), button:has-text("Accept all")',
        )
        .first();
      try {
        if (await acceptBtn.isVisible({ timeout: 2500 })) {
          await acceptBtn.click();
          await randomDelay(2000, 3000);
        }
      } catch {
        /* */
      }
      await dismissConsent(page);
      try {
        response = await runGoto(url);
      } catch (e2) {
        const msg2 = e2 instanceof Error ? e2.message : String(e2);
        if (
          msg2.includes("closed") ||
          msg2.includes("Target closed") ||
          msg2.includes("Protocol error")
        ) {
          throw e2;
        }
        log?.(`[nav] reload after consent failed: ${msg2.slice(0, 80)}`);
        return {
          ok: false,
          blocked: "navigation_failed",
          message: msg2.slice(0, 120),
        };
      }
    }

    if (await isCaptchaPage(page)) {
      const diagnostic = await diagnosePageAccess(page);
      log?.("⚠ CAPTCHA detected");
      return { ok: false, blocked: "captcha", diagnostic };
    }

    const diagnostic = await diagnosePageAccess(page);
    if (diagnostic.login_wall) {
      log?.("⚠ Login wall detected");
      return { ok: false, blocked: "auth_wall", diagnostic };
    }

    return { ok: true, response };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (
      msg.includes("closed") ||
      msg.includes("Target closed") ||
      msg.includes("Protocol error")
    ) {
      throw e;
    }
    log?.(`Navigation failed: ${msg.slice(0, 80)}`);
    return {
      ok: false,
      blocked: "navigation_failed",
      message: msg.slice(0, 120),
    };
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
  /** True when the Browser process is owned by the shared browser queue. */
  shared?: boolean;
}

export interface LaunchBrowserOptions {
  /** When set, injects decrypted session cookies from `org_browser_credentials`. */
  orgId?: string;
}

export interface WithBrowserSessionOptions {
  attempts?: number;
  orgId?: string;
}

const SERIALIZE_BROWSER_JOBS =
  String(process.env.PLAYWRIGHT_SERIALIZE_JOBS || "1").trim() !== "0";
const REUSE_SHARED_BROWSER =
  String(process.env.PLAYWRIGHT_REUSE_BROWSER || "1").trim() !== "0";
const BROWSER_JOB_SPACING_MS = Math.max(
  0,
  Number(process.env.PLAYWRIGHT_JOB_SPACING_MS || 350),
);

let browserQueueTail: Promise<void> = Promise.resolve();
let lastBrowserJobFinishedAt = 0;
let sharedBrowser: Browser | null = null;

async function enqueueBrowserJob<T>(job: () => Promise<T>): Promise<T> {
  if (!SERIALIZE_BROWSER_JOBS) return job();

  const run = browserQueueTail.catch(() => undefined).then(async () => {
    const elapsed = Date.now() - lastBrowserJobFinishedAt;
    if (elapsed < BROWSER_JOB_SPACING_MS) {
      await sleep(BROWSER_JOB_SPACING_MS - elapsed);
    }
    try {
      return await job();
    } finally {
      lastBrowserJobFinishedAt = Date.now();
    }
  });

  browserQueueTail = run.then(
    () => undefined,
    () => undefined,
  );

  return run;
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
    await session.context.close().catch(() => {});
  } catch {
    /* */
  }
  try {
    if (!session.shared && session.browser.isConnected()) {
      await session.browser.close();
    }
  } catch {
    /* already dead */
  }
}

async function closeSharedBrowser(): Promise<void> {
  const browser = sharedBrowser;
  sharedBrowser = null;
  try {
    if (browser?.isConnected()) await browser.close();
  } catch {
    /* already dead */
  }
}

/** True when Playwright died mid-call — a fresh browser often recovers. */
export function isTransientPlaywrightFailure(e: unknown): boolean {
  const msg = (e instanceof Error ? e.message : String(e)).toLowerCase();
  if (isPlaywrightResourceExhaustion(e)) return false;
  return (
    (msg.includes("browsercontext") && msg.includes("closed")) ||
    msg.includes("target closed") ||
    msg.includes("target page, context or browser has been closed") ||
    msg.includes("protocol error") ||
    msg.includes("execution context was destroyed") ||
    msg.includes("frame has been detached") ||
    msg.includes("net::err_aborted")
  );
}

/** Disk-full / tmp exhaustion — retrying the same launch usually makes it worse. */
export function isPlaywrightResourceExhaustion(e: unknown): boolean {
  const msg = (e instanceof Error ? e.message : String(e)).toLowerCase();
  return (
    msg.includes("less than 64mb") ||
    msg.includes("64mb of free space") ||
    msg.includes("free space in temporary") ||
    msg.includes("enospc") ||
    msg.includes("no space left on device") ||
    msg.includes("sigtrap") ||
    msg.includes("resource temporarily unavailable")
  );
}

/**
 * Run `runner` through the browser queue and retry transient Playwright
 * crashes. By default, this reuses one Chromium process and creates a fresh
 * isolated context/page per job, which avoids parallel Chromium storms while
 * keeping cookies/storage scoped to each call.
 */
export async function withBrowserSession<T>(
  runner: (session: BrowserSession) => Promise<T>,
  opts?: WithBrowserSessionOptions,
): Promise<T> {
  return enqueueBrowserJob(() => runWithBrowserSession(runner, opts));
}

async function runWithBrowserSession<T>(
  runner: (session: BrowserSession) => Promise<T>,
  opts?: WithBrowserSessionOptions,
): Promise<T> {
  const defaultAttempts = IS_SERVERLESS ? 6 : 4;
  const max = Math.min(Math.max(opts?.attempts ?? defaultAttempts, 1), 8);
  let lastErr: unknown;
  for (let i = 1; i <= max; i++) {
    let session: BrowserSession | null = null;
    try {
      session = REUSE_SHARED_BROWSER
        ? await launchSharedBrowserSession({ orgId: opts?.orgId })
        : await launchBrowser({ orgId: opts?.orgId });
      return await runner(session);
    } catch (e) {
      lastErr = e;
      if (isPlaywrightResourceExhaustion(e)) {
        const msg =
          e instanceof Error
            ? e.message
            : "Playwright: espace disque /tmp insuffisant ou processus tué (SIGTRAP).";
        throw new Error(
          `${msg} [BROWSER_RESOURCE_EXHAUSTED] Sur Vercel, limitez le parallélisme navigateur, augmentez /tmp (plan), ou définissez PLAYWRIGHT_BROWSERS_PATH vers un volume avec assez d’espace. Ne boucle pas 8× sur la même cause.`,
        );
      }
      if (session?.shared && !isBrowserAlive(session)) {
        await closeSharedBrowser();
      }
      if (i < max && isTransientPlaywrightFailure(e)) {
        const backoffMs = IS_SERVERLESS ? 900 + 700 * i : 500 * i;
        await sleep(backoffMs);
        continue;
      }
      throw e;
    } finally {
      await safeClose(session);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

async function launchChromiumProcess(): Promise<Browser> {
  // Vercel Pro (2–4 GB): prefer **multi-process** Chromium — much fewer
  // "BrowserContext closed" flakes than --single-process + --no-zygote.
  // If you hit OOM on tiny plans, set PLAYWRIGHT_SERVERLESS_SINGLE_PROCESS=1.
  const serverlessSingleProcess =
    IS_SERVERLESS &&
    String(process.env.PLAYWRIGHT_SERVERLESS_SINGLE_PROCESS || "")
      .trim()
      .toLowerCase() === "1";

  const baseArgs = [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-blink-features=AutomationControlled",
    "--disable-dev-shm-usage",
    "--disable-gpu",
  ];

  const args = IS_SERVERLESS
    ? serverlessSingleProcess
      ? [...baseArgs, "--single-process", "--no-zygote"]
      : baseArgs
    : baseArgs;

  let browser!: Browser;
  const maxAttempts = 4;

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

  return browser;
}

async function createSessionFromBrowser(
  browser: Browser,
  opts?: LaunchBrowserOptions,
  shared = false,
): Promise<BrowserSession> {
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

  if (opts?.orgId) {
    try {
      const extra = await loadPlaywrightCookiesForOrg(opts.orgId);
      if (extra.length) {
        await context.addCookies(extra);
      }
    } catch (e) {
      console.warn(
        "[browser] org cookie inject failed:",
        e instanceof Error ? e.message : e,
      );
    }
  }

  const page = await context.newPage();
  return { browser, context, page, shared };
}

async function launchSharedBrowserSession(
  opts?: LaunchBrowserOptions,
): Promise<BrowserSession> {
  if (!sharedBrowser || !sharedBrowser.isConnected()) {
    await closeSharedBrowser();
    const browser = await launchChromiumProcess();
    sharedBrowser = browser;
    browser.on("disconnected", () => {
      if (sharedBrowser === browser) {
        sharedBrowser = null;
      }
    });
  }

  const browser = sharedBrowser;
  if (!browser) throw new Error("Shared browser was not initialized");

  try {
    return await createSessionFromBrowser(browser, opts, true);
  } catch (e) {
    await closeSharedBrowser();
    throw e;
  }
}

export async function launchBrowser(
  opts?: LaunchBrowserOptions,
): Promise<BrowserSession> {
  const browser = await launchChromiumProcess();

  return createSessionFromBrowser(browser, opts, false);
}

export async function closeBrowser(session: BrowserSession) {
  await safeClose(session);
}

export async function newPage(session: BrowserSession): Promise<Page> {
  return session.context.newPage();
}
