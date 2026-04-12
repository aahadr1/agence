import type { Page } from "playwright-core";
import {
  screenshotAndAsk,
  safeGoto,
  normalizeUrl,
  dismissConsent,
  randomDelay,
} from "../browser";

export interface PagesJaunesResult {
  phone: string | null;
  email: string | null;
  address: string | null;
  website_url: string | null;
  owner_name: string | null;
  category: string | null;
}

function city(location: string): string {
  return location.replace(/\d{5}/g, "").replace(/,.*$/, "").trim();
}

function proUrl(who: string, where: string): string {
  return `https://www.pagesjaunes.fr/annuaire/chercherlespros?quoiqui=${encodeURIComponent(who)}&ou=${encodeURIComponent(where)}`;
}

const PROMPT = (biz: string, loc: string) =>
  `You are looking at PagesJaunes.fr (French yellow pages) for "${biz}" in ${loc}.

Extract ONLY data matching this specific business:
{
  "phone": "phone number (look for phone icon or 'Appeler' button)" or null,
  "email": "email address if shown" or null,
  "address": "full street address with postal code and city" or null,
  "website_url": "website URL if listed (look for 'Site internet')" or null,
  "owner_name": "owner/contact name if visible" or null,
  "category": "business category/profession as listed" or null
}

If no matching business is found, return all null values. Return JSON only.`;

/**
 * Search PagesJaunes.fr with 3+ query variations.
 * Navigates the pro directory, clicks into detail pages.
 */
export async function searchPagesJaunes(
  page: Page,
  businessName: string,
  location: string,
  knownPhone: string | null,
  log: (msg: string) => void
): Promise<PagesJaunesResult | null> {
  const c = city(location);
  const cleanName = businessName
    .replace(/\b(sarl|sas|eurl|sasu|snc)\b/gi, "")
    .trim();

  const queries: Array<[string, string]> = [
    [businessName, c],
    [`${businessName} ${c}`, c],
    [cleanName, c],
  ];
  if (knownPhone) {
    const clean = knownPhone.replace(/\s+/g, "").replace(/^\+33/, "0");
    queries.push([clean, ""]);
  }

  const merged: PagesJaunesResult = {
    phone: null,
    email: null,
    address: null,
    website_url: null,
    owner_name: null,
    category: null,
  };

  for (const [who, where] of queries) {
    try {
      log(`[PagesJaunes] "${who}" in "${where || "(phone lookup)"}"`);
      const ok = await safeGoto(page, proUrl(who, where), log);
      if (!ok) continue;

      await dismissConsent(page);

      // Try clicking first result to open detail page
      const first = page
        .locator(
          'a.bi-denomination, a[href*="/pros/"], .bi-item h3 a, [class*="businessName"] a'
        )
        .first();
      try {
        if (await first.isVisible({ timeout: 3000 })) {
          await first.click();
          await randomDelay(1500, 2500);
          await dismissConsent(page);

          // Click the "Afficher le numéro" / "Voir le numéro" button so the
          // full phone number is visible in the screenshot (PagesJaunes hides
          // it behind a reveal button for tracking purposes).
          const phoneReveal = page
            .locator(
              [
                'button:has-text("Afficher")',
                'a:has-text("Afficher le numéro")',
                'a:has-text("Voir le numéro")',
                'button:has-text("Appeler")',
                '[class*="phone-reveal"]',
                '[data-action*="phone"]',
              ].join(", ")
            )
            .first();
          try {
            if (await phoneReveal.isVisible({ timeout: 2000 })) {
              await phoneReveal.click();
              await randomDelay(600, 1200);
              log(`[PagesJaunes] Clicked phone reveal button`);
            }
          } catch {
            /* button not found — phone may already be visible */
          }
        }
      } catch {
        /* stay on search page */
      }

      const result = await screenshotAndAsk<PagesJaunesResult>(
        page,
        PROMPT(businessName, location)
      );

      merged.phone = merged.phone || result.phone;
      merged.email = merged.email || result.email;
      merged.address = merged.address || result.address;
      merged.website_url =
        merged.website_url || normalizeUrl(result.website_url);
      merged.owner_name = merged.owner_name || result.owner_name;
      merged.category = merged.category || result.category;

      await randomDelay(1000, 2000);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("closed") || msg.includes("Protocol error")) throw e;
      log(`[PagesJaunes] ✗ ${msg.slice(0, 80)}`);
    }
  }

  const hasData =
    merged.phone || merged.email || merged.address || merged.owner_name;
  return hasData ? merged : null;
}
