import type { Page } from "playwright";
import { screenshotToBase64, askGemini, normalizeUrl } from "../browser";

interface GoogleSearchResult {
  has_real_website: boolean;
  website_url: string | null;
  phone: string | null;
  email: string | null;
  owner_name: string | null;
  facebook_url: string | null;
  instagram_url: string | null;
  extra_description: string | null;
}

/**
 * Multi-query Google search for a business to verify website existence,
 * find contacts, and discover social profiles.
 * Runs multiple search variations and merges results.
 */
export async function searchGoogle(
  page: Page,
  businessName: string,
  location: string,
  knownPhone: string | null,
  knownAddress: string | null,
  log: (msg: string) => void
): Promise<GoogleSearchResult | null> {
  const city = location
    .replace(/\d{5}/g, "")
    .replace(/,.*$/, "")
    .trim();

  // Multiple search variations for maximum data extraction
  const queries = [
    `"${businessName}" ${location}`,
    `"${businessName}" ${city} site web OR website OR contact`,
    `"${businessName}" ${city} avis OR review OR téléphone`,
  ];

  // If we have a phone number, search with it to find more info
  if (knownPhone) {
    queries.push(`"${knownPhone}" ${city}`);
  }

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

  let searchCount = 0;

  for (const query of queries) {
    // Limit to 2 searches to avoid spending too long
    if (searchCount >= 2 && merged.website_url && merged.phone) break;

    try {
      log(`[Google] Searching: "${query}"`);
      await page.goto(
        `https://www.google.com/search?q=${encodeURIComponent(query)}&hl=fr&num=10`,
        { waitUntil: "domcontentloaded", timeout: 15000 }
      );
      await page.waitForTimeout(2000);
      searchCount++;

      const screenshot = await screenshotToBase64(page);

      const result = await askGemini<GoogleSearchResult>(
        `You are looking at Google Search results for the business "${businessName}" in ${location}.

Analyze the search results carefully:

1. **has_real_website**: Does this business have its OWN website (a real domain like businessname.com)?
   - A Facebook page, Yelp listing, TripAdvisor, PagesJaunes, or Google Maps page is NOT a real website.
   - Only count actual business-owned domains as real websites.
   - If the only results are directories/social media → false

2. **website_url**: The actual business website URL if found (full URL with https://)
3. **phone**: Phone number if visible in any result snippet (format: XX XX XX XX XX)
4. **email**: Email address if visible in any result snippet
5. **owner_name**: Owner/manager/gérant name if mentioned in any result (look for "gérant", "fondateur", "propriétaire", "dirigé par")
6. **facebook_url**: Facebook page URL if visible (full URL)
7. **instagram_url**: Instagram profile URL if visible (full URL)
8. **extra_description**: Any useful business description from search snippets

Return JSON:
{
  "has_real_website": true/false,
  "website_url": "url" or null,
  "phone": "number" or null,
  "email": "email" or null,
  "owner_name": "name" or null,
  "facebook_url": "url" or null,
  "instagram_url": "url" or null,
  "extra_description": "text" or null
}`,
        screenshot
      );

      // Merge: first non-null value wins, except has_real_website which is OR'd
      if (result.has_real_website) merged.has_real_website = true;
      merged.website_url = merged.website_url || normalizeUrl(result.website_url);
      merged.phone = merged.phone || result.phone;
      merged.email = merged.email || result.email;
      merged.owner_name = merged.owner_name || result.owner_name;
      merged.facebook_url = merged.facebook_url || normalizeUrl(result.facebook_url);
      merged.instagram_url = merged.instagram_url || normalizeUrl(result.instagram_url);
      merged.extra_description =
        merged.extra_description || result.extra_description;
    } catch (e) {
      log(`[Google] ✗ Search failed for "${query}": ${e}`);
    }
  }

  // Return null only if we got absolutely nothing
  const hasAnyData =
    merged.website_url ||
    merged.phone ||
    merged.email ||
    merged.owner_name ||
    merged.facebook_url ||
    merged.has_real_website;

  return hasAnyData ? merged : null;
}
