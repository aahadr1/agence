import type { Page } from "playwright-core";
import {
  screenshotAndAsk,
  safeGoto,
  dismissConsent,
} from "../browser";

export interface FbAdLibraryResult {
  has_ads: boolean;
  ad_count: number;
  ad_categories: string[];
  sample_ad_descriptions: string[];
}

const NO_ADS: FbAdLibraryResult = {
  has_ads: false,
  ad_count: 0,
  ad_categories: [],
  sample_ad_descriptions: [],
};

/**
 * Check Facebook Ad Library for active ads from a business.
 * Uses Playwright + Gemini vision.
 */
export async function checkFbAdLibrary(
  page: Page,
  businessName: string,
  location: string,
  facebookUrl: string | null,
  log: (msg: string) => void
): Promise<FbAdLibraryResult> {
  let searchQuery = businessName;
  if (facebookUrl) {
    const match = facebookUrl.match(/facebook\.com\/([^/?]+)/);
    if (match) searchQuery = match[1].replace(/\./g, " ");
  }

  const adLibraryUrl = `https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=FR&q=${encodeURIComponent(searchQuery)}&search_type=keyword_unordered`;

  try {
    log(`[AdLibrary] "${searchQuery}"`);
    const ok = await safeGoto(page, adLibraryUrl, log, 20000);
    if (!ok) return NO_ADS;

    await dismissConsent(page);

    // FB-specific consent / login prompt
    try {
      const allow = page
        .locator(
          'button:has-text("Allow"), button:has-text("Autoriser"), [data-cookiebanner="accept_button"]'
        )
        .first();
      if (await allow.isVisible({ timeout: 3000 })) {
        await allow.click();
        await page.waitForTimeout(2000);
      }
    } catch {
      /* */
    }

    const city = location.replace(/\d{5}/g, "").replace(/,.*$/, "").trim();

    const result = await screenshotAndAsk<FbAdLibraryResult>(
      page,
      `You are looking at the Facebook Ad Library page. Searched for "${businessName}" (${city}).

{
  "has_ads": true if active ads visible for this business, false if "no results",
  "ad_count": approximate number of active ads (0 if none),
  "ad_categories": ["type of ads, e.g. 'Local promotion', 'Service ad'"],
  "sample_ad_descriptions": ["brief desc of up to 3 ads"]
}

Only count ads for "${businessName}". If login wall or no results → has_ads: false.
Return JSON only.`
    );

    if (result.has_ads) {
      log(`[AdLibrary] ✓ ${result.ad_count} active ads`);
    } else {
      log(`[AdLibrary] ✗ No active Meta ads`);
    }

    return result;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("closed") || msg.includes("Protocol error")) throw e;
    log(`[AdLibrary] ✗ ${msg.slice(0, 80)}`);
    return NO_ADS;
  }
}
