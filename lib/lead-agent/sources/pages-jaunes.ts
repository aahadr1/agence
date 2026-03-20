import type { Page } from "playwright";
import { screenshotToBase64, askGemini } from "../browser";

interface PagesJaunesResult {
  phone: string | null;
  email: string | null;
  address: string | null;
  website_url: string | null;
  owner_name: string | null;
  category: string | null;
}

/**
 * Search PagesJaunes.fr for a business to find phone/email/address.
 */
export async function searchPagesJaunes(
  page: Page,
  businessName: string,
  location: string,
  log: (msg: string) => void
): Promise<PagesJaunesResult | null> {
  try {
    // Search PagesJaunes directly
    const query = encodeURIComponent(businessName);
    const loc = encodeURIComponent(location);
    const url = `https://www.pagesjaunes.fr/pagesblanches/recherche?quoiqui=${query}&ou=${loc}`;

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 });
    await page.waitForTimeout(2000);

    // Handle cookie consent on PagesJaunes
    try {
      const acceptBtn = page.locator('#didomi-notice-agree-button, button:has-text("Accepter")').first();
      if (await acceptBtn.isVisible({ timeout: 2000 })) {
        await acceptBtn.click();
        await page.waitForTimeout(1000);
      }
    } catch {
      // No consent popup
    }

    // Try the professional search too
    const proUrl = `https://www.pagesjaunes.fr/annuaire/chercherlespros?quoiqui=${query}&ou=${loc}`;
    await page.goto(proUrl, { waitUntil: "domcontentloaded", timeout: 15000 });
    await page.waitForTimeout(2000);

    const screenshot = await screenshotToBase64(page);

    const result = await askGemini<PagesJaunesResult>(
      `You are looking at PagesJaunes.fr search results for "${businessName}" in ${location}.

Extract any available information about this specific business:

{
  "phone": "phone number if visible",
  "email": "email if visible",
  "address": "full address if visible",
  "website_url": "website URL if listed",
  "owner_name": "owner/contact name if visible",
  "category": "business category as listed"
}

If you cannot find a matching business, return all null values. Do NOT confuse with other businesses.

Return JSON only.`,
      screenshot
    );

    return result;
  } catch (e) {
    log(`[PagesJaunes] ✗ Search failed for "${businessName}": ${e}`);
    return null;
  }
}
