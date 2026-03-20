import type { Page } from "playwright-core";
import { screenshotToBase64, askGemini, normalizeUrl } from "../browser";

interface PagesJaunesResult {
  phone: string | null;
  email: string | null;
  address: string | null;
  website_url: string | null;
  owner_name: string | null;
  category: string | null;
}

/**
 * Search PagesJaunes.fr for a business using multiple query variations.
 * Tries both professional directory (annuaire pro) and white pages.
 */
export async function searchPagesJaunes(
  page: Page,
  businessName: string,
  location: string,
  knownPhone: string | null,
  log: (msg: string) => void
): Promise<PagesJaunesResult | null> {
  const city = location
    .replace(/\d{5}/g, "")
    .replace(/,.*$/, "")
    .trim();

  const merged: PagesJaunesResult = {
    phone: null,
    email: null,
    address: null,
    website_url: null,
    owner_name: null,
    category: null,
  };

  // 1. Professional directory search (multiple queries)
  const proQueries = [
    businessName,
    `${businessName} ${city}`,
  ];

  for (const query of proQueries) {
    try {
      log(`[PagesJaunes] Pro search: "${query}"`);
      const proUrl = `https://www.pagesjaunes.fr/annuaire/chercherlespros?quoiqui=${encodeURIComponent(query)}&ou=${encodeURIComponent(city)}`;
      await page.goto(proUrl, {
        waitUntil: "domcontentloaded",
        timeout: 15000,
      });
      await page.waitForTimeout(2000);

      // Handle cookie consent
      await dismissPJConsent(page);

      // Try clicking the first result to get the detail page
      const firstResult = page.locator('a.bi-denomination, a[href*="/pros/"]').first();
      if (await firstResult.isVisible({ timeout: 3000 })) {
        await firstResult.click();
        await page.waitForTimeout(2000);
      }

      const screenshot = await screenshotToBase64(page);

      const result = await askGemini<PagesJaunesResult>(
        `You are looking at PagesJaunes.fr (professional directory) for "${businessName}" in ${location}.

Extract any available information about this specific business:

{
  "phone": "phone number — look for the phone icon or 'Appeler' button",
  "email": "email address if shown — look for envelope icon",
  "address": "full address with street, postal code, city",
  "website_url": "website URL if listed — look for 'Site internet' link",
  "owner_name": "owner/contact name if visible",
  "category": "business category/profession as listed"
}

IMPORTANT: Only extract data for "${businessName}", NOT other businesses in the results.
If you cannot find a matching business, return all null values.

Return JSON only.`,
        screenshot
      );

      // Merge results
      merged.phone = merged.phone || result.phone;
      merged.email = merged.email || result.email;
      merged.address = merged.address || result.address;
      merged.website_url = merged.website_url || normalizeUrl(result.website_url);
      merged.owner_name = merged.owner_name || result.owner_name;
      merged.category = merged.category || result.category;

      if (merged.phone && merged.address) break; // Got the key data
    } catch (e) {
      log(`[PagesJaunes] ✗ Pro search failed for "${query}": ${e}`);
    }
  }

  // 2. If we have a known phone but no address, search by phone
  if (knownPhone && !merged.address) {
    try {
      const cleanPhone = knownPhone.replace(/\s+/g, "").replace(/^\+33/, "0");
      log(`[PagesJaunes] Phone reverse lookup: "${cleanPhone}"`);
      await page.goto(
        `https://www.pagesjaunes.fr/annuaire/chercherlespros?quoiqui=${encodeURIComponent(cleanPhone)}&ou=`,
        { waitUntil: "domcontentloaded", timeout: 15000 }
      );
      await page.waitForTimeout(2000);
      await dismissPJConsent(page);

      const screenshot = await screenshotToBase64(page);
      const result = await askGemini<PagesJaunesResult>(
        `You are looking at PagesJaunes.fr search results for phone number "${cleanPhone}".
We expect this to be the business "${businessName}" in ${location}.

{
  "phone": "${cleanPhone}",
  "email": "email if shown",
  "address": "full address if shown",
  "website_url": "website if shown",
  "owner_name": "contact name if shown",
  "category": "category if shown"
}

Return JSON only.`,
        screenshot
      );

      merged.address = merged.address || result.address;
      merged.email = merged.email || result.email;
      merged.website_url = merged.website_url || normalizeUrl(result.website_url);
      merged.owner_name = merged.owner_name || result.owner_name;
    } catch (e) {
      log(`[PagesJaunes] ✗ Phone lookup failed: ${e}`);
    }
  }

  const hasData = merged.phone || merged.email || merged.address || merged.owner_name;
  return hasData ? merged : null;
}

async function dismissPJConsent(page: Page) {
  try {
    const acceptBtn = page
      .locator(
        '#didomi-notice-agree-button, button:has-text("Accepter"), button:has-text("Tout accepter")'
      )
      .first();
    if (await acceptBtn.isVisible({ timeout: 2000 })) {
      await acceptBtn.click();
      await page.waitForTimeout(1000);
    }
  } catch {
    // No consent popup
  }
}
