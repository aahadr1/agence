import type { Page } from "playwright-core";
import {
  screenshotAndAsk,
  safeGoto,
  normalizeUrl,
  dismissConsent,
  randomDelay,
} from "../browser";

export interface FacebookResult {
  facebook_url: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  follower_count: number | null;
  description: string | null;
  instagram_url: string | null;
  owner_name: string | null;
  website_url: string | null;
}

function city(location: string): string {
  return location.replace(/\d{5}/g, "").replace(/,.*$/, "").trim();
}

function googleUrl(query: string): string {
  return `https://www.google.com/search?q=${encodeURIComponent(query)}&hl=fr`;
}

/**
 * Find the Facebook page via Google (site:facebook.com) with 3+ queries,
 * then visit it to extract business data.
 */
export async function searchFacebook(
  page: Page,
  businessName: string,
  location: string,
  knownOwnerName: string | null,
  log: (msg: string) => void
): Promise<FacebookResult | null> {
  const c = city(location);

  const queries = [
    `site:facebook.com "${businessName}" ${c}`,
    `site:facebook.com "${businessName}" ${location}`,
    `site:facebook.com "${businessName}" "${c}" contact avis`,
  ];
  if (knownOwnerName) {
    queries.push(
      `site:facebook.com "${knownOwnerName}" "${businessName}" ${c}`
    );
  }

  // Phase 1: find the Facebook page URL via Google
  let bestHref: string | null = null;

  for (const query of queries) {
    try {
      log(`[Facebook] Google: "${query}"`);
      const ok = await safeGoto(page, googleUrl(query), log);
      if (!ok) continue;

      const fbLink = page.locator('a[href*="facebook.com/"]').first();
      if (await fbLink.isVisible({ timeout: 3000 })) {
        const href = await fbLink.getAttribute("href");
        if (
          href &&
          href.includes("facebook.com") &&
          !href.includes("login") &&
          !href.includes("/help/")
        ) {
          bestHref = href;
          break;
        }
      }

      await randomDelay(1500, 3000);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("closed") || msg.includes("Protocol error")) throw e;
      log(`[Facebook] ✗ Google search failed: ${msg.slice(0, 80)}`);
    }
  }

  if (!bestHref) {
    log(`[Facebook] No page found for "${businessName}"`);
    return null;
  }

  /**
   * Dismiss the FB login/popup wall and take a screenshot to ask Gemini.
   * Returns `null` if the page appears to be a full-screen login wall.
   */
  async function visitAndExtract(url: string): Promise<FacebookResult | null> {
    const ok = await safeGoto(page, url, log);
    if (!ok) return null;

    await dismissConsent(page);
    try {
      const close = page
        .locator(
          '[aria-label="Close"], [aria-label="Fermer"], button:has-text("Not now")'
        )
        .first();
      if (await close.isVisible({ timeout: 2000 })) {
        await close.click();
        await randomDelay(400, 800);
      }
    } catch {
      /* */
    }

    return screenshotAndAsk<FacebookResult>(
      page,
      `You are looking at a Facebook page for "${businessName}" in ${location}.
${knownOwnerName ? `Known owner: "${knownOwnerName}".` : ""}

Extract ALL available information:
{
  "facebook_url": "facebook.com/... URL of this page" or null,
  "phone": "phone number from About/Info section" or null,
  "email": "email from About section" or null,
  "address": "address if shown" or null,
  "follower_count": number of followers/likes or null,
  "description": "business description or bio" or null,
  "instagram_url": "instagram link if visible" or null,
  "owner_name": "page owner name if visible (Page transparency section)" or null,
  "website_url": "website URL from About section" or null
}

If this is NOT the right business or Facebook is showing a full-screen login wall with no content, return all nulls.
Return JSON only.`
    );
  }

  // Phase 2: visit the Facebook page (main URL, then /about fallback)
  try {
    log(`[Facebook] Visiting main: ${bestHref}`);
    const main = await visitAndExtract(bestHref);

    // Determine if the main page hit a login wall (all nulls except maybe facebook_url)
    const mainHasData = main && (main.phone || main.email || main.address ||
      main.follower_count || main.description || main.website_url);

    // /about sub-page often exposes contact info without a login wall
    let about: FacebookResult | null = null;
    if (!mainHasData) {
      const aboutUrl = bestHref.replace(/\/$/, "") + "/about";
      log(`[Facebook] Main page limited — trying /about: ${aboutUrl}`);
      try {
        about = await visitAndExtract(aboutUrl);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes("closed") || msg.includes("Protocol error")) throw e;
        log(`[Facebook] ✗ /about failed: ${msg.slice(0, 80)}`);
      }
    }

    // Merge: prefer main page data, fill gaps from /about
    const merged: FacebookResult = {
      facebook_url: main?.facebook_url || about?.facebook_url || bestHref,
      phone: main?.phone || about?.phone || null,
      email: main?.email || about?.email || null,
      address: main?.address || about?.address || null,
      follower_count: main?.follower_count || about?.follower_count || null,
      description: main?.description || about?.description || null,
      instagram_url: main?.instagram_url || about?.instagram_url || null,
      owner_name: main?.owner_name || about?.owner_name || null,
      website_url: main?.website_url || about?.website_url || null,
    };

    return {
      ...merged,
      facebook_url: normalizeUrl(merged.facebook_url),
      instagram_url: normalizeUrl(merged.instagram_url),
      website_url: normalizeUrl(merged.website_url),
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("closed") || msg.includes("Protocol error")) throw e;
    log(`[Facebook] ✗ Page visit failed: ${msg.slice(0, 80)}`);
    return null;
  }
}
