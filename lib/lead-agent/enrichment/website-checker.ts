import type { Page } from "playwright";
import { screenshotToBase64, askGemini, normalizeUrl } from "../browser";
import type { WebsiteQuality } from "@/lib/types";

interface WebsiteCheckResult {
  quality: WebsiteQuality;
  score: number;
  is_dead: boolean;
  is_mobile_friendly: boolean;
  is_modern: boolean;
  is_just_social: boolean;
  notes: string;
}

/**
 * Visit a website and evaluate its quality using Gemini vision.
 * Returns a quality rating and score.
 */
export async function checkWebsite(
  page: Page,
  websiteUrl: string,
  businessName: string,
  log: (msg: string) => void
): Promise<WebsiteCheckResult | null> {
  try {
    // Normalize URL — Gemini sometimes returns URLs without protocol
    websiteUrl = normalizeUrl(websiteUrl) || websiteUrl;

    // Check if the URL is actually a social media page
    const socialDomains = [
      "facebook.com",
      "instagram.com",
      "twitter.com",
      "yelp.com",
      "tripadvisor.com",
      "pagesjaunes.fr",
      "google.com/maps",
    ];
    const isSocial = socialDomains.some((d) => websiteUrl.includes(d));
    if (isSocial) {
      return {
        quality: "none",
        score: 0,
        is_dead: false,
        is_mobile_friendly: false,
        is_modern: false,
        is_just_social: true,
        notes: "URL is a social media/directory page, not a real website",
      };
    }

    // Try to visit the website
    const response = await page.goto(websiteUrl, {
      waitUntil: "domcontentloaded",
      timeout: 12000,
    });

    if (!response || response.status() >= 400) {
      return {
        quality: "dead",
        score: 0,
        is_dead: true,
        is_mobile_friendly: false,
        is_modern: false,
        is_just_social: false,
        notes: `Website returned HTTP ${response?.status() || "no response"}`,
      };
    }

    await page.waitForTimeout(3000);

    // Check if it redirected to a social page
    const currentUrl = page.url();
    if (socialDomains.some((d) => currentUrl.includes(d))) {
      return {
        quality: "none",
        score: 0,
        is_dead: false,
        is_mobile_friendly: false,
        is_modern: false,
        is_just_social: true,
        notes: "Website redirects to social media page",
      };
    }

    // Screenshot and evaluate
    const screenshot = await screenshotToBase64(page);

    const result = await askGemini<WebsiteCheckResult>(
      `You are a web design expert evaluating the website for "${businessName}" at ${websiteUrl}.

Look at this screenshot and evaluate the website quality:

{
  "quality": one of: "dead" (broken/error page), "outdated" (old design, not responsive, pre-2015 look), "poor" (basic/ugly but functional), "decent" (acceptable, somewhat modern), "good" (modern, professional, responsive),
  "score": 0-100 (0=broken, 50=mediocre, 100=excellent),
  "is_dead": true if the page shows an error, parking page, or is clearly not functional,
  "is_mobile_friendly": true if the design looks responsive/mobile-ready,
  "is_modern": true if it uses modern design patterns (clean typography, proper spacing, good imagery),
  "is_just_social": true if this is actually just a Facebook/Instagram page disguised as a website,
  "notes": "Brief assessment — what's wrong and what would we pitch to improve"
}

Be critical but fair. For a web agency trying to sell redesigns:
- "outdated" and "poor" sites are LEADS (they need a new website)
- "dead" sites are HOT LEADS (their website is literally broken)
- "decent" and "good" sites are probably not worth pursuing

Return JSON only.`,
      screenshot
    );

    return result;
  } catch (e) {
    log(`[WebCheck] ✗ Failed to check "${websiteUrl}": ${e}`);
    return {
      quality: "dead",
      score: 0,
      is_dead: true,
      is_mobile_friendly: false,
      is_modern: false,
      is_just_social: false,
      notes: `Could not load website: ${e instanceof Error ? e.message : "unknown error"}`,
    };
  }
}
