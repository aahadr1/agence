import type { Page } from "playwright";
import { screenshotToBase64, askGemini } from "../browser";

export interface OwnerPhoneResult {
  owner_phone: string | null;
  owner_email: string | null;
  extra_info: string | null;
}

/**
 * Dedicated search for the business owner's personal phone number.
 * Uses the owner name (from Societe.com/LinkedIn) + business name
 * to search across multiple query variations on Google.
 */
export async function searchOwnerPhone(
  page: Page,
  ownerName: string,
  businessName: string,
  location: string,
  log: (msg: string) => void
): Promise<OwnerPhoneResult | null> {
  const city = location
    .replace(/\d{5}/g, "")
    .replace(/,.*$/, "")
    .trim();

  // Multiple search queries for maximum chance of finding the phone
  const queries = [
    `"${ownerName}" "${businessName}" téléphone OR phone OR mobile`,
    `"${ownerName}" ${city} téléphone`,
    `"${ownerName}" "${businessName}" contact`,
    `"${ownerName}" ${city} annuaire OR 118712 OR pagesjaunes`,
    // Try the owner name on PagesJaunes white pages directly
  ];

  for (const query of queries) {
    try {
      log(`[OwnerSearch] Searching: "${query}"`);
      await page.goto(
        `https://www.google.com/search?q=${encodeURIComponent(query)}&hl=fr`,
        { waitUntil: "domcontentloaded", timeout: 15000 }
      );
      await page.waitForTimeout(2000);

      const screenshot = await screenshotToBase64(page);

      const result = await askGemini<OwnerPhoneResult>(
        `You are looking at Google Search results. We are trying to find the PERSONAL phone number of "${ownerName}", who is the owner of "${businessName}" in ${location}.

Look carefully at ALL search results, snippets, and knowledge panels:

{
  "owner_phone": "personal phone/mobile number of ${ownerName} if found — NOT the business number",
  "owner_email": "personal email if found",
  "extra_info": "any other useful contact info found"
}

IMPORTANT:
- We want the OWNER's personal number, not the business main line
- Phone numbers look like 06/07 XX XX XX XX (mobile) or 01-05 XX XX XX XX (landline)
- If the same number appears as the business number, it might still be the owner's direct line for a small business — include it
- If you find nothing, return all nulls

Return JSON only.`,
        screenshot
      );

      if (result.owner_phone) {
        log(`[OwnerSearch] ✓ Found phone for ${ownerName}: ${result.owner_phone}`);
        return result;
      }
    } catch (e) {
      log(`[OwnerSearch] ✗ Search failed: ${e}`);
    }
  }

  // Try PagesJaunes white pages (pagesblanches) as last resort
  try {
    const nameParts = ownerName.split(" ");
    const lastName = nameParts[nameParts.length - 1];
    const firstName = nameParts[0];

    log(`[OwnerSearch] Trying PagesJaunes white pages for "${firstName} ${lastName}"...`);
    await page.goto(
      `https://www.pagesjaunes.fr/pagesblanches/recherche?quoiqui=${encodeURIComponent(firstName + " " + lastName)}&ou=${encodeURIComponent(city)}`,
      { waitUntil: "domcontentloaded", timeout: 15000 }
    );
    await page.waitForTimeout(2000);

    // Handle cookie consent
    try {
      const acceptBtn = page
        .locator('#didomi-notice-agree-button, button:has-text("Accepter")')
        .first();
      if (await acceptBtn.isVisible({ timeout: 2000 })) {
        await acceptBtn.click();
        await page.waitForTimeout(1000);
      }
    } catch {
      // No popup
    }

    const screenshot = await screenshotToBase64(page);

    const result = await askGemini<OwnerPhoneResult>(
      `You are looking at PagesJaunes/PagesBlanches (white pages) search results for "${firstName} ${lastName}" in ${city}.

This person is the owner of "${businessName}". Find their personal listing:

{
  "owner_phone": "their phone number from the white pages listing",
  "owner_email": null,
  "extra_info": "their personal address if listed"
}

Only return data if the name matches closely. Return all nulls if no match.

Return JSON only.`,
      screenshot
    );

    if (result.owner_phone) {
      log(`[OwnerSearch] ✓ Found via white pages: ${result.owner_phone}`);
      return result;
    }
  } catch (e) {
    log(`[OwnerSearch] ✗ White pages search failed: ${e}`);
  }

  log(`[OwnerSearch] No personal phone found for "${ownerName}"`);
  return null;
}
