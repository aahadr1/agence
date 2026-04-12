import type { Page } from "playwright-core";
import {
  screenshotAndAsk,
  safeGoto,
  normalizeUrl,
  dismissConsent,
  randomDelay,
} from "../browser";

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

function extractCity(loc: string): string {
  return loc.replace(/\d{5}/g, "").replace(/,.*$/, "").trim();
}

function cleanName(name: string): string {
  return name
    .replace(
      /\b(SARL|SAS|SA|EURL|SCI|SASU|SNC|EI|SELARL|SARLU|AUTO[- ]?ENTREPRENEUR)\b/gi,
      ""
    )
    .replace(/\s+/g, " ")
    .trim();
}

function hasUseful(r: SocieteComResult): boolean {
  const s = (x: string | null | undefined) => (x || "").trim();
  return !!(
    s(r.owner_name) ||
    s(r.siren) ||
    s(r.siret) ||
    s(r.company_type) ||
    s(r.creation_date) ||
    s(r.revenue_bracket) ||
    s(r.naf_code) ||
    s(r.capital) ||
    s(r.address).length > 12
  );
}

const PROMPT_SOCIETE = (biz: string, loc: string, addr: string | null) =>
  `You are looking at a Societe.com company page. We searched for "${biz}" near "${loc}"${addr ? ` (address hint: ${addr})` : ""}.

MATCHING: Google Maps shows the TRADE NAME (enseigne); Societe.com shows the LEGAL NAME (raison sociale). They often differ. If city/activity is plausible, EXTRACT the data. Only return all nulls if clearly wrong business or captcha/error page.

Extract:
{
  "owner_name": "dirigeant/gérant/président full name" or null,
  "owner_role": "Gérant, Président, etc." or null,
  "siren": "9-digit SIREN" or null,
  "siret": "14-digit SIRET" or null,
  "company_type": "SARL, SAS, etc." or null,
  "creation_date": "date of creation" or null,
  "revenue_bracket": "revenue/CA bracket" or null,
  "employee_count": "number or range" or null,
  "address": "registered address (siège social)" or null,
  "phone": "phone if visible" or null,
  "website_url": "website if listed" or null,
  "naf_code": "NAF/APE code" or null,
  "capital": "capital social" or null
}

Return JSON only.`;

const PROMPT_PAPPERS = (biz: string, loc: string) =>
  `You are looking at a Pappers.fr page. Searched for "${biz}" in "${loc}".
Same rules: trade name vs legal name is OK if location/activity fits.

Extract:
{
  "owner_name": "dirigeant full name" or null,
  "owner_role": "role" or null,
  "siren": "SIREN" or null,
  "siret": "SIRET" or null,
  "company_type": "legal form" or null,
  "creation_date": "creation date" or null,
  "revenue_bracket": "revenue" or null,
  "employee_count": "employees" or null,
  "address": "registered address" or null,
  "phone": null,
  "website_url": null,
  "naf_code": "NAF code" or null,
  "capital": "capital social" or null
}

Only return all nulls if no company data visible. Return JSON only.`;

/**
 * Search Societe.com and Pappers.fr for legal/owner data.
 * Tries 3+ queries on Societe.com, then falls back to Pappers.
 */
export async function searchSocieteCom(
  page: Page,
  businessName: string,
  location: string,
  address: string | null,
  log: (msg: string) => void
): Promise<SocieteComResult | null> {
  const c = extractCity(location);
  const clean = cleanName(businessName);

  // --- Societe.com (3 queries) ---
  const societeQueries = [
    businessName,
    `${businessName} ${c}`,
    clean !== businessName ? clean : `${clean} ${c}`,
  ];

  for (const query of societeQueries) {
    try {
      log(`[Societe.com] "${query}"`);
      const ok = await safeGoto(
        page,
        `https://www.societe.com/cgi-bin/search?champs=${encodeURIComponent(query)}`,
        log,
        22000
      );
      if (!ok) continue;

      await dismissConsent(page);

      // Wait for real content to load (anti-bot interstitial)
      await page
        .waitForSelector(
          "main, .resultat, a[href*='/societe/'], a[href*='/etablissement/']",
          { timeout: 10000 }
        )
        .catch(() => {});
      await randomDelay(1000, 2000);

      // If not on a company page, click first result
      const url = page.url();
      if (!url.includes("/societe/") && !url.includes("/etablissement/")) {
        const first = page
          .locator('a[href*="/societe/"], a[href*="/etablissement/"]')
          .first();
        try {
          if (await first.isVisible({ timeout: 5000 })) {
            await first.scrollIntoViewIfNeeded().catch(() => {});
            await first.click({ timeout: 8000 });
            await randomDelay(2000, 3000);
            await dismissConsent(page);
          } else {
            continue;
          }
        } catch {
          continue;
        }
      }

      // Scroll down to reveal dirigeant section
      try {
        await page.evaluate(() => window.scrollTo(0, 400));
        await randomDelay(500, 1000);
      } catch {
        /* */
      }

      const result = await screenshotAndAsk<SocieteComResult>(
        page,
        PROMPT_SOCIETE(businessName, location, address)
      );

      if (hasUseful(result)) {
        log(
          `[Societe.com] ✓ ${result.owner_name || "—"} | ${result.company_type || "—"} | SIREN: ${result.siren || "—"}`
        );
        return { ...result, website_url: normalizeUrl(result.website_url) };
      }

      await randomDelay(1000, 2000);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("closed") || msg.includes("Protocol error")) throw e;
      log(`[Societe.com] ✗ ${msg.slice(0, 80)}`);
    }
  }

  // --- Pappers fallback (3 queries) ---
  const pappersQueries = [
    `${businessName} ${c}`,
    clean !== businessName ? `${clean} ${c}` : businessName,
    businessName,
  ].filter((q, i, a) => a.indexOf(q) === i);

  for (const pq of pappersQueries) {
    try {
      log(`[Pappers] "${pq}"`);
      const ok = await safeGoto(
        page,
        `https://www.pappers.fr/recherche?q=${encodeURIComponent(pq)}`,
        log,
        22000
      );
      if (!ok) continue;

      await dismissConsent(page);

      const first = page
        .locator(
          "a[href*='/entreprise/'], a.company-link, a[href*='pappers.fr/entreprise']"
        )
        .first();
      if (await first.isVisible({ timeout: 5000 })) {
        await first.scrollIntoViewIfNeeded().catch(() => {});
        await first.click({ timeout: 8000 });
        await randomDelay(2000, 3000);
      }

      await dismissConsent(page);

      try {
        await page.evaluate(() => window.scrollTo(0, 350));
        await randomDelay(400, 800);
      } catch {
        /* */
      }

      const result = await screenshotAndAsk<SocieteComResult>(
        page,
        PROMPT_PAPPERS(businessName, location)
      );

      if (hasUseful(result)) {
        log(
          `[Pappers] ✓ ${result.owner_name || "—"} | SIREN: ${result.siren || result.siret || "—"}`
        );
        return { ...result, website_url: normalizeUrl(result.website_url) };
      }

      await randomDelay(1000, 2000);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("closed") || msg.includes("Protocol error")) throw e;
      log(`[Pappers] ✗ ${msg.slice(0, 80)}`);
    }
  }

  log(`[Societe/Pappers] No legal data found for "${businessName}"`);
  return null;
}
