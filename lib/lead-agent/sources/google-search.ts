import type { Page } from "playwright-core";
import {
  screenshotAndAsk,
  safeGoto,
  normalizeUrl,
  randomDelay,
  isCaptchaPage,
} from "../browser";

export interface GoogleSearchResult {
  has_real_website: boolean;
  website_url: string | null;
  phone: string | null;
  email: string | null;
  owner_name: string | null;
  facebook_url: string | null;
  instagram_url: string | null;
  extra_description: string | null;
}

function city(location: string): string {
  return location.replace(/\d{5}/g, "").replace(/,.*$/, "").trim();
}

function googleUrl(query: string): string {
  return `https://www.google.com/search?q=${encodeURIComponent(query)}&hl=fr&num=10`;
}

function ddgSearchUrl(query: string): string {
  return `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
}

/**
 * Multi-query Google search. Runs 3-6 distinct queries and merges results.
 */
export async function searchGoogle(
  page: Page,
  businessName: string,
  location: string,
  knownPhone: string | null,
  knownAddress: string | null,
  log: (msg: string) => void
): Promise<GoogleSearchResult | null> {
  const c = city(location);

  const queries = [
    `"${businessName}" ${location}`,
    `"${businessName}" ${c} site web contact téléphone email`,
    `"${businessName}" ${c} avis dirigeant gérant fondateur`,
    `"${businessName}" ${c} facebook instagram linkedin`,
  ];
  if (knownPhone) queries.push(`"${knownPhone}" ${c}`);
  if (knownAddress) queries.push(`"${businessName}" "${knownAddress}"`);

  const merged: GoogleSearchResult = {
    has_real_website: false,
    website_url: null,
    phone: null,
    email: null,
    owner_name: null,
    facebook_url: null,
    instagram_url: null,
    extra_description: null,
  };

  for (const query of queries) {
    try {
      log(`[Google] "${query}"`);
      let ok = await safeGoto(page, googleUrl(query), log);
      let engine: "google" | "duckduckgo" = "google";
      if (!ok || (await isCaptchaPage(page))) {
        if (ok) log(`[Google] CAPTCHA on Google — falling back to DuckDuckGo`);
        else log(`[Google] Google SERP failed — trying DuckDuckGo`);
        ok = await safeGoto(page, ddgSearchUrl(query), log);
        if (ok) engine = "duckduckgo";
      }
      if (!ok) continue;

      const serpLabel =
        engine === "duckduckgo"
          ? "DuckDuckGo HTML search results (French locale when available)"
          : "Google Search results";

      const result = await screenshotAndAsk<GoogleSearchResult>(
        page,
        `You are looking at ${serpLabel} for the business "${businessName}" in ${location}.

Extract:
{
  "has_real_website": Does this business have its OWN website (real domain, NOT Facebook/PagesJaunes/Yelp/TripAdvisor)? true/false,
  "website_url": full https URL of the real website or null,
  "phone": phone number from snippets (format: XX XX XX XX XX) or null,
  "email": email address from snippets or null,
  "owner_name": owner/gérant/fondateur name if mentioned or null,
  "facebook_url": full facebook.com URL or null,
  "instagram_url": full instagram.com URL or null,
  "extra_description": useful business description from snippets or null
}

Only extract data clearly belonging to "${businessName}" in ${location}. Return JSON only.`
      );

      if (result.has_real_website) merged.has_real_website = true;
      merged.website_url = merged.website_url || normalizeUrl(result.website_url);
      merged.phone = merged.phone || result.phone;
      merged.email = merged.email || result.email;
      merged.owner_name = merged.owner_name || result.owner_name;
      merged.facebook_url =
        merged.facebook_url || normalizeUrl(result.facebook_url);
      merged.instagram_url =
        merged.instagram_url || normalizeUrl(result.instagram_url);
      merged.extra_description =
        merged.extra_description || result.extra_description;

      await randomDelay(1500, 3000);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("closed") || msg.includes("Protocol error")) throw e;
      log(`[Google] ✗ "${query}": ${msg.slice(0, 80)}`);
    }
  }

  const hasAny =
    merged.website_url ||
    merged.phone ||
    merged.email ||
    merged.owner_name ||
    merged.facebook_url ||
    merged.has_real_website;

  return hasAny ? merged : null;
}
