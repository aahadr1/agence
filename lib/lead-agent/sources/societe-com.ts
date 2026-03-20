import type { Page } from "playwright-core";
import { screenshotToBase64, askGemini, normalizeUrl } from "../browser";

export interface SocieteComResult {
  owner_name: string | null;
  owner_role: string | null;
  siren: string | null;
  siret: string | null;
  company_type: string | null;
  creation_date: string | null;
  revenue_bracket: string | null;
  employee_count: string | null;
  address: string | null;
  phone: string | null;
  website_url: string | null;
  naf_code: string | null;
  capital: string | null;
}

/**
 * Search Societe.com for a business to find its legal representative,
 * SIREN number, and company details.
 * Tries multiple search variations for better match rates.
 */
export async function searchSocieteCom(
  page: Page,
  businessName: string,
  location: string,
  address: string | null,
  log: (msg: string) => void
): Promise<SocieteComResult | null> {
  // Build multiple search queries for better hit rate
  const city = extractCity(location);
  const searchVariations = [
    businessName,
    `${businessName} ${city}`,
    // Try without common suffixes like SARL, SAS etc
    cleanCompanyName(businessName),
  ].filter((q, i, arr) => arr.indexOf(q) === i); // unique

  for (const query of searchVariations) {
    try {
      log(`[Societe.com] Searching: "${query}"`);

      await page.goto(
        `https://www.societe.com/cgi-bin/search?champs=${encodeURIComponent(query)}`,
        { waitUntil: "domcontentloaded", timeout: 15000 }
      );
      await page.waitForTimeout(2000);

      // Handle cookie consent
      try {
        const consentBtn = page
          .locator(
            'button:has-text("Accepter"), button:has-text("Tout accepter"), #didomi-notice-agree-button'
          )
          .first();
        if (await consentBtn.isVisible({ timeout: 2000 })) {
          await consentBtn.click();
          await page.waitForTimeout(1000);
        }
      } catch {
        // No consent popup
      }

      // Check if we landed on a direct company page or search results
      const currentUrl = page.url();
      const isCompanyPage =
        currentUrl.includes("/societe/") || currentUrl.includes("/etablissement/");

      if (!isCompanyPage) {
        // We're on search results — try to click the first matching result
        const firstResult = page
          .locator('a[href*="/societe/"], a[href*="/etablissement/"]')
          .first();
        if (await firstResult.isVisible({ timeout: 3000 })) {
          await firstResult.click();
          await page.waitForTimeout(2000);
        } else {
          log(`[Societe.com] No results for "${query}"`);
          continue;
        }
      }

      // We should be on a company detail page now
      const screenshot = await screenshotToBase64(page);

      const result = await askGemini<SocieteComResult>(
        `You are looking at a Societe.com company page. We are searching for the business "${businessName}" located in "${location}"${address ? ` at "${address}"` : ""}.

IMPORTANT: First verify this is the RIGHT company. Check that the name and location roughly match. If this is clearly a different company, return all null values.

Extract ALL available information about the company's legal representative and details:

{
  "owner_name": "Full name of the dirigeant/gérant/président — this is the legal representative, look for 'Dirigeant' or 'Représentant légal' section",
  "owner_role": "Their role: Gérant, Président, Directeur Général, etc.",
  "siren": "9-digit SIREN number",
  "siret": "14-digit SIRET number",
  "company_type": "Legal form: SARL, SAS, EURL, Auto-entrepreneur, etc.",
  "creation_date": "Date of creation/immatriculation",
  "revenue_bracket": "Chiffre d'affaires / revenue bracket if shown",
  "employee_count": "Number of employees or range",
  "address": "Registered address (siège social)",
  "phone": "Phone number if visible",
  "website_url": "Website URL if listed",
  "naf_code": "NAF/APE code if visible",
  "capital": "Share capital (capital social) if shown"
}

Return JSON only.`,
        screenshot
      );

      // If we found meaningful data, return it
      if (result.owner_name || result.siren) {
        log(
          `[Societe.com] ✓ Found: ${result.owner_name || "no owner"} — ${result.company_type || ""} — SIREN: ${result.siren || "n/a"}`
        );
        return {
          ...result,
          website_url: normalizeUrl(result.website_url),
        };
      }
    } catch (e) {
      log(`[Societe.com] ✗ Search failed for "${query}": ${e}`);
    }
  }

  // If societe.com didn't work, try Pappers.fr as fallback
  try {
    log(`[Pappers] Trying Pappers.fr for "${businessName}"...`);
    await page.goto(
      `https://www.pappers.fr/recherche?q=${encodeURIComponent(businessName + " " + city)}`,
      { waitUntil: "domcontentloaded", timeout: 15000 }
    );
    await page.waitForTimeout(2000);

    // Click first result if on search page
    const firstResult = page.locator("a.company-link, a[href*='/entreprise/']").first();
    if (await firstResult.isVisible({ timeout: 3000 })) {
      await firstResult.click();
      await page.waitForTimeout(2000);
    }

    const screenshot = await screenshotToBase64(page);

    const result = await askGemini<SocieteComResult>(
      `You are looking at a Pappers.fr company page. We are searching for "${businessName}" in "${location}".

Verify this is the right company. Extract:

{
  "owner_name": "Full name of the dirigeant/représentant légal",
  "owner_role": "Their role: Gérant, Président, etc.",
  "siren": "SIREN number",
  "siret": "SIRET number",
  "company_type": "Legal form: SARL, SAS, etc.",
  "creation_date": "Creation date",
  "revenue_bracket": "Revenue bracket if shown",
  "employee_count": "Employee count/range",
  "address": "Registered address",
  "phone": null,
  "website_url": null,
  "naf_code": "NAF code",
  "capital": "Capital social"
}

If wrong company, return all nulls. Return JSON only.`,
      screenshot
    );

    if (result.owner_name || result.siren) {
      log(
        `[Pappers] ✓ Found: ${result.owner_name || "no owner"} — SIREN: ${result.siren || "n/a"}`
      );
      return {
        ...result,
        website_url: normalizeUrl(result.website_url),
      };
    }
  } catch (e) {
    log(`[Pappers] ✗ Failed: ${e}`);
  }

  log(`[Societe.com] No data found for "${businessName}"`);
  return null;
}

/** Extract city name from a location string like "Paris", "Lyon 69000", "13001 Marseille" */
function extractCity(location: string): string {
  return location
    .replace(/\d{5}/g, "")
    .replace(/,.*$/, "")
    .trim();
}

/** Remove common legal suffixes for cleaner search */
function cleanCompanyName(name: string): string {
  return name
    .replace(
      /\b(SARL|SAS|SA|EURL|SCI|SASU|SNC|EI|SELARL|SARLU|AUTO[- ]?ENTREPRENEUR)\b/gi,
      ""
    )
    .replace(/\s+/g, " ")
    .trim();
}
