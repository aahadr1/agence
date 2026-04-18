import type { Page } from "playwright-core";
import {
  screenshotAndAsk,
  normalizeUrl,
  randomDelay,
  navigateForScrape,
  type PageAccessDiagnostics,
} from "../browser";
import type { WebsiteQuality } from "@/lib/types";

export interface DeepWebsiteCheckResult {
  quality: WebsiteQuality;
  score: number;
  is_dead: boolean;
  is_mobile_friendly: boolean;
  is_modern: boolean;
  is_just_social: boolean;
  has_https: boolean;
  has_booking: boolean;
  has_chatbot: boolean;
  has_contact_form: boolean;
  tech_notes: string;
  pain_summary: string;
  credential_required?: boolean;
  page_access?: PageAccessDiagnostics;
  suggested_user_action_fr?: string | null;
  credential_hostname?: string | null;
}

const SOCIAL_DOMAINS = [
  "facebook.com",
  "instagram.com",
  "twitter.com",
  "yelp.com",
  "tripadvisor.com",
  "pagesjaunes.fr",
  "google.com/maps",
];

const NO_SITE: DeepWebsiteCheckResult = {
  quality: "none",
  score: 0,
  is_dead: false,
  is_mobile_friendly: false,
  is_modern: false,
  is_just_social: true,
  has_https: false,
  has_booking: false,
  has_chatbot: false,
  has_contact_form: false,
  tech_notes: "URL is a social media/directory page",
  pain_summary: "No real website",
};

/**
 * Visit the website, take a screenshot, check DOM signals, then
 * ask Gemini to evaluate quality. Also fetches PageSpeed score.
 */
export async function deepCheckWebsite(
  page: Page,
  websiteUrl: string,
  businessName: string,
  log: (msg: string) => void
): Promise<DeepWebsiteCheckResult | null> {
  try {
    websiteUrl = normalizeUrl(websiteUrl) || websiteUrl;

    if (SOCIAL_DOMAINS.some((d) => websiteUrl.includes(d))) return NO_SITE;

    const has_https = websiteUrl.startsWith("https://");

    const nav = await navigateForScrape(page, websiteUrl, log, 15000);
    if (!nav.ok) {
      const diag = nav.diagnostic;
      return {
        quality: "dead",
        score: 0,
        is_dead: true,
        is_mobile_friendly: false,
        is_modern: false,
        is_just_social: false,
        has_https,
        has_booking: false,
        has_chatbot: false,
        has_contact_form: false,
        tech_notes: nav.message || nav.blocked,
        pain_summary:
          nav.blocked === "captcha"
            ? "Page behind captcha — cannot audit"
            : nav.blocked === "auth_wall"
              ? "Page requires login — cannot audit"
              : "Navigation failed — cannot audit",
        credential_required: nav.blocked === "auth_wall",
        page_access: diag,
        suggested_user_action_fr: diag?.suggested_action_fr ?? null,
        credential_hostname: diag?.credential_hostname,
      };
    }

    const response = nav.response;

    if (!response || response.status() >= 400) {
      return {
        quality: "dead",
        score: 0,
        is_dead: true,
        is_mobile_friendly: false,
        is_modern: false,
        is_just_social: false,
        has_https,
        has_booking: false,
        has_chatbot: false,
        has_contact_form: false,
        tech_notes: `HTTP ${response?.status() || "no response"}`,
        pain_summary: "Website is broken/dead — hot lead for web agency",
      };
    }

    await randomDelay(2000, 3500);

    // Check if redirected to social media
    const currentUrl = page.url();
    if (SOCIAL_DOMAINS.some((d) => currentUrl.includes(d))) {
      return { ...NO_SITE, has_https };
    }

    // DOM signals (more reliable than vision for these)
    const dom = await page.evaluate(() => {
      const html = document.documentElement.innerHTML.toLowerCase();
      const bookingRe =
        /calendly|simplybook|setmore|youcanbook|acuityscheduling|planity|treatwell|zenchef|thefork|resengo|bookeo|booksy|agendize|rendez-vous en ligne|prise de rdv|prendre rendez-vous|réserver une table|book a table|schedule.*appointment/i;
      return {
        hasChatWidget:
          html.includes("intercom") ||
          html.includes("crisp.chat") ||
          html.includes("zendesk") ||
          html.includes("zopim") ||
          html.includes("tidio") ||
          html.includes("hubspot") ||
          html.includes("drift") ||
          html.includes("livechat") ||
          html.includes("tawk.to"),
        hasBooking: bookingRe.test(html),
        hasContactForm:
          html.includes("<form") &&
          (html.includes("contact") ||
            html.includes("message") ||
            html.includes("email")),
        hasHttps: window.location.protocol === "https:",
      };
    });

    const result = await screenshotAndAsk<DeepWebsiteCheckResult>(
      page,
      `You are a web design expert evaluating "${businessName}"'s website at ${websiteUrl}.

DOM signals: chat=${dom.hasChatWidget}, booking=${dom.hasBooking}, form=${dom.hasContactForm}, https=${dom.hasHttps}

{
  "quality": "dead" | "outdated" | "poor" | "decent" | "good",
  "score": 0-100,
  "is_dead": true if error/parking page,
  "is_mobile_friendly": true if responsive,
  "is_modern": true if modern design (post-2020),
  "is_just_social": false,
  "has_https": ${dom.hasHttps},
  "has_booking": true if real scheduling/booking flow for this business type,
  "has_chatbot": true if chat widget detected,
  "has_contact_form": true if contact form exists,
  "tech_notes": "CMS, design era, loading feel",
  "pain_summary": "What would a web agency pitch to improve? Be specific."
}

Scoring: 0-20 dead, 20-40 outdated, 40-60 poor, 60-75 decent, 75-100 good.
Return JSON only.`
    );

    // Override with DOM signals (more reliable)
    if (dom.hasChatWidget) result.has_chatbot = true;
    if (dom.hasBooking) result.has_booking = true;
    if (dom.hasContactForm) result.has_contact_form = true;
    result.has_https = dom.hasHttps || has_https;

    log(
      `[WebCheck] ✓ ${businessName}: ${result.quality} (${result.score}/100) HTTPS:${result.has_https} Book:${result.has_booking} Chat:${result.has_chatbot}`
    );

    return result;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("closed") || msg.includes("Protocol error")) throw e;
    log(`[WebCheck] ✗ ${msg.slice(0, 80)}`);
    return {
      quality: "dead",
      score: 0,
      is_dead: true,
      is_mobile_friendly: false,
      is_modern: false,
      is_just_social: false,
      has_https: false,
      has_booking: false,
      has_chatbot: false,
      has_contact_form: false,
      tech_notes: `Could not load: ${msg.slice(0, 100)}`,
      pain_summary: "Website unreachable — potential hot lead",
    };
  }
}

/**
 * PageSpeed Insights score via the free Google API.
 */
export async function fetchPageSpeedScore(
  websiteUrl: string,
  log: (msg: string) => void
): Promise<number | null> {
  try {
    const key = process.env.PAGESPEED_API_KEY;
    const keyParam = key ? `&key=${encodeURIComponent(key)}` : "";
    const apiUrl = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(websiteUrl)}&strategy=mobile&category=performance${keyParam}`;
    const res = await fetch(apiUrl, { signal: AbortSignal.timeout(30000) });
    if (!res.ok) {
      log(`[PageSpeed] ✗ API ${res.status}`);
      return null;
    }
    const data = await res.json();
    const score = data?.lighthouseResult?.categories?.performance?.score;
    if (typeof score === "number") {
      const pct = Math.round(score * 100);
      log(`[PageSpeed] ✓ ${pct}/100`);
      return pct;
    }
    return null;
  } catch (e) {
    log(`[PageSpeed] ✗ ${e instanceof Error ? e.message : e}`);
    return null;
  }
}
