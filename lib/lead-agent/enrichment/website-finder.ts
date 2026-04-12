import type { Page } from "playwright-core";
import {
  screenshotAndAsk,
  safeGoto,
  normalizeUrl,
  randomDelay,
  dismissConsent,
} from "../browser";

export interface WebsiteFinderResult {
  has_website: boolean;
  website_url: string | null;
  found_via: "gmb" | "google_search" | "pages_jaunes" | "click_through" | null;
  confidence: "high" | "medium" | "low";
}

const SOCIAL_AND_DIRECTORY_DOMAINS = [
  "facebook.com",
  "instagram.com",
  "twitter.com",
  "x.com",
  "linkedin.com",
  "yelp.com",
  "tripadvisor.com",
  "pagesjaunes.fr",
  "google.com",
  "maps.google",
  "lafourchette.com",
  "thefork.com",
  "booking.com",
  "airbnb.com",
  "just-eat.fr",
  "ubereats.com",
  "deliveroo.fr",
  "societe.com",
  "pappers.fr",
  "annuaire.gouv.fr",
  "lefigaro.fr",
  "lemonde.fr",
  "wikipedia.org",
  "youtube.com",
  "tiktok.com",
  "pinterest.com",
];

function isRealWebsite(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url.startsWith("http") ? url : "https://" + url);
    const hostname = parsed.hostname.replace(/^www\./, "");
    return !SOCIAL_AND_DIRECTORY_DOMAINS.some((d) => hostname.includes(d));
  } catch {
    return false;
  }
}

function googleUrl(query: string): string {
  return `https://www.google.com/search?q=${encodeURIComponent(query)}&hl=fr&num=10`;
}

function city(location: string): string {
  return location.replace(/\d{5}/g, "").replace(/,.*$/, "").trim();
}

/**
 * Extract all organic result links from a Google SERP via DOM — more reliable
 * than screenshot-only extraction.
 */
async function extractGoogleResultLinks(page: Page): Promise<string[]> {
  try {
    return await page.evaluate((blocked) => {
      const anchors = Array.from(document.querySelectorAll("a[href]")) as HTMLAnchorElement[];
      const results: string[] = [];
      for (const a of anchors) {
        const href = a.href;
        if (!href || !href.startsWith("http")) continue;
        try {
          const u = new URL(href);
          // Skip Google-owned and blocked domains
          if (u.hostname.includes("google.") || u.hostname.includes("gstatic.")) continue;
          if (blocked.some((d: string) => u.hostname.includes(d))) continue;
          // Google wraps organic results in /url?q=... or /search?...
          // Also accept direct hrefs that look like real sites
          if (!results.includes(href)) results.push(href);
          if (results.length >= 15) break;
        } catch {
          /* bad href */
        }
      }
      return results;
    }, SOCIAL_AND_DIRECTORY_DOMAINS);
  } catch {
    return [];
  }
}

/**
 * Ask Gemini vision: is this page the website for {businessName}?
 */
async function isThisTheirWebsite(
  page: Page,
  businessName: string,
  location: string
): Promise<{ match: boolean; confidence: "high" | "medium" | "low" }> {
  try {
    return await screenshotAndAsk<{ match: boolean; confidence: "high" | "medium" | "low" }>(
      page,
      `You are looking at a webpage. Determine if this is the OFFICIAL website for the business "${businessName}" located in ${location}.

{
  "match": true if this appears to be the official business website, false otherwise,
  "confidence": "high" if the business name appears prominently and matches, "medium" if likely but not certain, "low" if uncertain
}

NOT a match if: error page, unrelated business, social media page, directory listing, competitor site.
Return JSON only.`
    );
  } catch {
    return { match: false, confidence: "low" };
  }
}

/**
 * Dedicated website finder that goes beyond a SERP screenshot.
 *
 * Strategy:
 * 1. If GMB already gave us a website_url → validate it's a real domain → return immediately.
 * 2. Run up to 3 Google searches with varied queries.
 * 3. For each SERP → first try Gemini vision on the SERP itself to extract website URL.
 * 4. Then extract all organic links from DOM → navigate to each (skipping social/directories)
 *    → ask Gemini "Is this the website for {businessName}?" → stop at first confident match.
 * 5. Max 10 link navigations total across all queries.
 */
export async function findWebsite(
  page: Page,
  businessName: string,
  location: string,
  gmbWebsiteUrl: string | null,
  log: (msg: string) => void
): Promise<WebsiteFinderResult> {
  const c = city(location);

  // ── Step 1: Validate GMB website ──
  if (gmbWebsiteUrl && isRealWebsite(gmbWebsiteUrl)) {
    log(`[WebFinder] GMB website: ${gmbWebsiteUrl} — validating...`);
    try {
      const ok = await safeGoto(page, gmbWebsiteUrl, log, 12000);
      if (ok) {
        const currentUrl = page.url();
        // Check it didn't redirect to a social media page
        if (isRealWebsite(currentUrl)) {
          const check = await isThisTheirWebsite(page, businessName, location);
          if (check.match) {
            log(`[WebFinder] ✓ GMB website confirmed: ${currentUrl}`);
            return {
              has_website: true,
              website_url: normalizeUrl(currentUrl) || gmbWebsiteUrl,
              found_via: "gmb",
              confidence: check.confidence,
            };
          }
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("closed") || msg.includes("Protocol error")) throw e;
      log(`[WebFinder] GMB validation error: ${msg.slice(0, 80)}`);
    }
  }

  // ── Step 2: Google search with multiple queries ──
  const queries = [
    `"${businessName}" ${c} site officiel`,
    `"${businessName}" ${c} site web`,
    `${businessName} ${c} contact`,
  ];

  let totalNavigations = 0;
  const MAX_NAVIGATIONS = 10;

  for (const query of queries) {
    if (totalNavigations >= MAX_NAVIGATIONS) break;

    log(`[WebFinder] Searching: "${query}"`);

    try {
      const ok = await safeGoto(page, googleUrl(query), log);
      if (!ok) continue;

      await dismissConsent(page);
      await randomDelay(1000, 2000);

      // First: try Gemini vision on SERP directly (fast path)
      try {
        const serpResult = await screenshotAndAsk<{
          has_real_website: boolean;
          website_url: string | null;
        }>(
          page,
          `You are looking at Google Search results for "${businessName}" in ${c}.

Look for the official website of this specific business (NOT Facebook, Instagram, PagesJaunes, TripAdvisor, Yelp, annuaires, or competitors).

{
  "has_real_website": true if you can see their own website URL in the results (own domain),
  "website_url": "full https:// URL of their website" or null
}

Be strict: only return a URL if you are confident it belongs specifically to "${businessName}" in ${c}.
Return JSON only.`
        );

        if (serpResult.has_real_website && serpResult.website_url && isRealWebsite(serpResult.website_url)) {
          const normalized = normalizeUrl(serpResult.website_url);
          log(`[WebFinder] ✓ SERP vision found: ${normalized}`);
          return {
            has_website: true,
            website_url: normalized,
            found_via: "google_search",
            confidence: "medium",
          };
        }
      } catch {
        /* continue to click-through */
      }

      // Second: extract organic links and click through them
      const links = await extractGoogleResultLinks(page);
      log(`[WebFinder] Extracted ${links.length} links from SERP, checking up to ${Math.min(links.length, MAX_NAVIGATIONS - totalNavigations)}...`);

      for (const link of links) {
        if (totalNavigations >= MAX_NAVIGATIONS) break;
        totalNavigations++;

        try {
          log(`[WebFinder] Navigating to: ${link.slice(0, 80)}`);
          const ok = await safeGoto(page, link, log, 12000);
          if (!ok) continue;

          await randomDelay(500, 1200);

          const currentUrl = page.url();
          if (!isRealWebsite(currentUrl)) continue;

          const check = await isThisTheirWebsite(page, businessName, location);
          if (check.match && check.confidence !== "low") {
            const finalUrl = normalizeUrl(currentUrl) || link;
            log(`[WebFinder] ✓ Click-through match (${check.confidence}): ${finalUrl}`);
            return {
              has_website: true,
              website_url: finalUrl,
              found_via: "click_through",
              confidence: check.confidence,
            };
          }

          await randomDelay(300, 800);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          if (msg.includes("closed") || msg.includes("Protocol error")) throw e;
          log(`[WebFinder] ✗ Link error: ${msg.slice(0, 60)}`);
        }
      }

      await randomDelay(1500, 2500);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("closed") || msg.includes("Protocol error")) throw e;
      log(`[WebFinder] ✗ Query error: ${msg.slice(0, 80)}`);
    }
  }

  log(`[WebFinder] No website found for "${businessName}" after ${totalNavigations} navigations`);
  return {
    has_website: false,
    website_url: null,
    found_via: null,
    confidence: "high", // high confidence there is NO website
  };
}
