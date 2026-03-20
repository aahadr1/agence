import type { Page } from "playwright";
import { screenshotToBase64, askGemini, normalizeUrl } from "../browser";

interface FacebookResult {
  facebook_url: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  follower_count: number | null;
  description: string | null;
  instagram_url: string | null;
}

/**
 * Search for a business on Facebook to find their page and contact info.
 * Uses Google to find the Facebook page (avoids Facebook login walls).
 */
export async function searchFacebook(
  page: Page,
  businessName: string,
  location: string,
  log: (msg: string) => void
): Promise<FacebookResult | null> {
  try {
    // Use Google to find the Facebook page (more reliable than FB search)
    const query = `site:facebook.com "${businessName}" ${location}`;
    await page.goto(
      `https://www.google.com/search?q=${encodeURIComponent(query)}&hl=en`,
      { waitUntil: "domcontentloaded", timeout: 15000 }
    );
    await page.waitForTimeout(2000);

    // Check if we found a Facebook page
    const fbLink = page.locator('a[href*="facebook.com/"]').first();
    if (!(await fbLink.isVisible({ timeout: 3000 }))) {
      log(`[Facebook] No page found for "${businessName}"`);
      return null;
    }

    // Get the Facebook URL from Google results
    const href = await fbLink.getAttribute("href");
    if (!href || !href.includes("facebook.com")) {
      return null;
    }

    // Visit the Facebook page
    await page.goto(href, { waitUntil: "domcontentloaded", timeout: 15000 });
    await page.waitForTimeout(3000);

    // Handle Facebook cookie/login popup
    try {
      const closeBtn = page.locator('[aria-label="Close"], [data-testid="cookie-policy-manage-dialog-accept-button"]').first();
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

Extract ALL available information:

{
  "facebook_url": "the current page URL",
  "phone": "phone number if shown in the About/Info section",
  "email": "email if shown",
  "address": "address if shown",
  "follower_count": number of followers/likes if visible (just the number, no text),
  "description": "business description or bio if visible",
  "instagram_url": "Instagram link if visible on the page"
}

If this is NOT the right business or if Facebook is blocking content (login wall), return all nulls.

Return JSON only.`,
      screenshot
    );

    if (result.facebook_url === null && href) {
      result.facebook_url = href;
    }

    return {
      ...result,
      facebook_url: normalizeUrl(result.facebook_url),
      instagram_url: normalizeUrl(result.instagram_url),
    };
  } catch (e) {
    log(`[Facebook] ✗ Search failed for "${businessName}": ${e}`);
    return null;
  }
}
