import type { Page } from "playwright-core";
import { screenshotToBase64, askGemini, normalizeUrl } from "../browser";

interface FacebookResult {
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

/**
 * Search for a business on Facebook using multiple Google query variations.
 * Also checks the About/Info section for owner details.
 */
export async function searchFacebook(
  page: Page,
  businessName: string,
  location: string,
  knownOwnerName: string | null,
  log: (msg: string) => void
): Promise<FacebookResult | null> {
  const city = location
    .replace(/\d{5}/g, "")
    .replace(/,.*$/, "")
    .trim();

  // Multiple search queries to find the Facebook page
  const queries = [
    `site:facebook.com "${businessName}" ${city}`,
    `site:facebook.com "${businessName}" ${location}`,
  ];

  // If we know the owner, also search by their name
  if (knownOwnerName) {
    queries.push(`site:facebook.com "${knownOwnerName}" "${businessName}"`);
  }

  let bestHref: string | null = null;

  for (const query of queries) {
    try {
      log(`[Facebook] Searching: "${query}"`);
      await page.goto(
        `https://www.google.com/search?q=${encodeURIComponent(query)}&hl=fr`,
        { waitUntil: "domcontentloaded", timeout: 15000 }
      );
      await page.waitForTimeout(2000);

      const fbLink = page.locator('a[href*="facebook.com/"]').first();
      if (await fbLink.isVisible({ timeout: 3000 })) {
        const href = await fbLink.getAttribute("href");
        if (href && href.includes("facebook.com") && !href.includes("login")) {
          bestHref = href;
          break;
        }
      }
    } catch (e) {
      log(`[Facebook] ✗ Search failed: ${e}`);
    }
  }

  if (!bestHref) {
    log(`[Facebook] No page found for "${businessName}"`);
    return null;
  }

  try {
    // Visit the Facebook page
    await page.goto(bestHref, { waitUntil: "domcontentloaded", timeout: 15000 });
    await page.waitForTimeout(3000);

    // Handle Facebook cookie/login popup
    try {
      const closeBtn = page
        .locator(
          '[aria-label="Close"], [aria-label="Fermer"], [data-testid="cookie-policy-manage-dialog-accept-button"], button:has-text("Accepter")'
        )
        .first();
      if (await closeBtn.isVisible({ timeout: 2000 })) {
        await closeBtn.click();
        await page.waitForTimeout(1000);
      }
    } catch {
      // No popup
    }

    const screenshot = await screenshotToBase64(page);

    const result = await askGemini<FacebookResult>(
      `You are looking at a Facebook business page for "${businessName}" in ${location}.
${knownOwnerName ? `The known owner is: "${knownOwnerName}".` : ""}

Extract ALL available information:

{
  "facebook_url": "the current page URL (facebook.com/...)",
  "phone": "phone number if shown in About/Info section or page header",
  "email": "email if shown in About/Info section",
  "address": "address if shown",
  "follower_count": number of followers/likes if visible (just the number),
  "description": "business description or bio text",
  "instagram_url": "Instagram link if visible on the page",
  "owner_name": "name of the page admin/owner if visible (look for 'Page transparency' section or 'Created by')",
  "website_url": "website URL if listed in the About section"
}

If this is NOT the right business or if Facebook is blocking content (full login wall), return all nulls.

Return JSON only.`,
      screenshot
    );

    if (result.facebook_url === null && bestHref) {
      result.facebook_url = bestHref;
    }

    return {
      ...result,
      facebook_url: normalizeUrl(result.facebook_url),
      instagram_url: normalizeUrl(result.instagram_url),
      website_url: normalizeUrl(result.website_url),
    };
  } catch (e) {
    log(`[Facebook] ✗ Page visit failed: ${e}`);
    return null;
  }
}
