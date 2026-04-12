import type { Page } from "playwright-core";
import {
  screenshotAndAsk,
  safeGoto,
  dismissConsent,
  randomDelay,
} from "../browser";

export interface OwnerPhoneResult {
  owner_phone: string | null;
  owner_email: string | null;
  extra_info: string | null;
}

function city(location: string): string {
  return location.replace(/\d{5}/g, "").replace(/,.*$/, "").trim();
}

function googleUrl(query: string): string {
  return `https://www.google.com/search?q=${encodeURIComponent(query)}&hl=fr`;
}

const GOOGLE_PROMPT = (owner: string, biz: string, loc: string) =>
  `You are looking at Google results. We need the PERSONAL phone of "${owner}", owner of "${biz}" in ${loc}.

{
  "owner_phone": "personal phone/mobile (06/07 XX XX XX XX or landline)" or null,
  "owner_email": "personal email" or null,
  "extra_info": "any other useful contact info" or null
}

We want the OWNER's direct number, not the business main line (unless small business where they're the same).
Return JSON only.`;

const WHITEPAGES_PROMPT = (first: string, last: string, biz: string) =>
  `You are looking at PagesJaunes/PagesBlanches (white pages) results for "${first} ${last}".
This person is the owner of "${biz}".

{
  "owner_phone": "their phone number from the listing" or null,
  "owner_email": null,
  "extra_info": "their personal address if listed" or null
}

Only return data if the name matches closely. Return JSON only.`;

/**
 * Dedicated search for the owner's personal phone/email.
 * Uses Google (3 queries) + PagesJaunes white pages (1 query).
 */
export async function searchOwnerPhone(
  page: Page,
  ownerName: string,
  businessName: string,
  location: string,
  log: (msg: string) => void
): Promise<OwnerPhoneResult | null> {
  const c = city(location);

  // --- Google searches (3 queries) ---
  const queries = [
    `"${ownerName}" "${businessName}" téléphone OR phone OR mobile`,
    `"${ownerName}" ${c} téléphone contact`,
    `"${ownerName}" "${businessName}" email OR mail OR contact`,
  ];

  for (const query of queries) {
    try {
      log(`[OwnerSearch] "${query}"`);
      const ok = await safeGoto(page, googleUrl(query), log);
      if (!ok) continue;

      const result = await screenshotAndAsk<OwnerPhoneResult>(
        page,
        GOOGLE_PROMPT(ownerName, businessName, location)
      );

      if (result.owner_phone) {
        log(`[OwnerSearch] ✓ Phone: ${result.owner_phone}`);
        return result;
      }

      await randomDelay(1500, 3000);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("closed") || msg.includes("Protocol error")) throw e;
      log(`[OwnerSearch] ✗ ${msg.slice(0, 80)}`);
    }
  }

  // --- PagesJaunes white pages (1 query) ---
  try {
    const parts = ownerName.split(" ");
    const firstName = parts[0];
    const lastName = parts[parts.length - 1];

    log(`[OwnerSearch] White pages: "${firstName} ${lastName}" in ${c}`);
    const ok = await safeGoto(
      page,
      `https://www.pagesjaunes.fr/pagesblanches/recherche?quoiqui=${encodeURIComponent(firstName + " " + lastName)}&ou=${encodeURIComponent(c)}`,
      log
    );
    if (ok) {
      await dismissConsent(page);

      const result = await screenshotAndAsk<OwnerPhoneResult>(
        page,
        WHITEPAGES_PROMPT(firstName, lastName, businessName)
      );

      if (result.owner_phone) {
        log(`[OwnerSearch] ✓ White pages: ${result.owner_phone}`);
        return result;
      }
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("closed") || msg.includes("Protocol error")) throw e;
    log(`[OwnerSearch] ✗ White pages: ${msg.slice(0, 80)}`);
  }

  log(`[OwnerSearch] No personal phone for "${ownerName}"`);
  return null;
}
