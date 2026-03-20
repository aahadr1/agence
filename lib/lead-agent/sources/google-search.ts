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
 * Google search a business name to verify website existence
 * and find additional contact info.
 */
export async function searchGoogle(
  page: Page,
  businessName: string,
  location: string,
  log: (msg: string) => void
): Promise<GoogleSearchResult | null> {
  const query = `"${businessName}" ${location}`;

  try {
    await page.goto(
      `https://www.google.com/search?q=${encodeURIComponent(query)}&hl=en`,
      { waitUntil: "domcontentloaded", timeout: 15000 }
    );
    await page.waitForTimeout(2000);

    const screenshot = await screenshotToBase64(page);

    const result = await askGemini<GoogleSearchResult>(
      `You are looking at Google Search results for the business "${businessName}" in ${location}.

Analyze the search results carefully:

1. **has_real_website**: Does this business have its OWN website (a real domain like businessname.com)?
   - A Facebook page, Yelp listing, TripAdvisor, PagesJaunes, or Google Maps page is NOT a real website.
   - Only count actual business-owned domains as real websites.
   - If the only results are directories/social media → false

2. **website_url**: The actual business website URL if found
3. **phone**: Phone number if visible in any result snippet
4. **email**: Email if visible in any result snippet
5. **owner_name**: Owner/manager name if mentioned in any result
6. **facebook_url**: Facebook page URL if visible
7. **instagram_url**: Instagram profile URL if visible
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

    return {
      ...result,
      website_url: normalizeUrl(result.website_url),
      facebook_url: normalizeUrl(result.facebook_url),
      instagram_url: normalizeUrl(result.instagram_url),
    };
  } catch (e) {
    log(`[Google] ✗ Search failed for "${businessName}": ${e}`);
    return null;
  }
}
