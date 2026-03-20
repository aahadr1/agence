import type { Page } from "playwright-core";
import { screenshotToBase64, askGemini, normalizeUrl } from "../browser";

export interface LinkedInResult {
  linkedin_url: string | null;
  owner_name: string | null;
  owner_title: string | null;
  owner_description: string | null;
  company_linkedin_url: string | null;
  phone: string | null;
  email: string | null;
}

/**
 * Search LinkedIn for the business owner via Google site:linkedin.com.
 * Uses the owner name from Societe.com + business name for precise matching.
 * Falls back to business-name-only search if no owner name is known yet.
 */
export async function searchLinkedIn(
  page: Page,
  businessName: string,
  location: string,
  ownerName: string | null,
  log: (msg: string) => void
): Promise<LinkedInResult | null> {
  const city = location
    .replace(/\d{5}/g, "")
    .replace(/,.*$/, "")
    .trim();

  // Build search queries — prioritize owner name if we have it
  const queries: string[] = [];
  if (ownerName) {
    queries.push(
      `site:linkedin.com/in/ "${ownerName}" "${businessName}"`,
      `site:linkedin.com/in/ "${ownerName}" ${city}`,
    );
  }
  queries.push(
    `site:linkedin.com "${businessName}" ${city} gérant OR fondateur OR owner OR CEO`,
    `site:linkedin.com/company/ "${businessName}" ${city}`,
  );

  for (const query of queries) {
    try {
      log(`[LinkedIn] Searching: "${query}"`);
      await page.goto(
        `https://www.google.com/search?q=${encodeURIComponent(query)}&hl=fr`,
        { waitUntil: "domcontentloaded", timeout: 15000 }
      );
      await page.waitForTimeout(2000);

      // Check if we got results
      const linkedInLink = page
        .locator('a[href*="linkedin.com/in/"], a[href*="linkedin.com/company/"]')
        .first();
      if (!(await linkedInLink.isVisible({ timeout: 3000 }))) {
        continue;
      }

      // Screenshot Google results for context
      const searchScreenshot = await screenshotToBase64(page);

      const searchResult = await askGemini<{
        linkedin_profile_url: string | null;
        person_name: string | null;
        person_title: string | null;
        is_relevant: boolean;
      }>(
        `You are looking at Google Search results for LinkedIn profiles related to "${businessName}" in ${location}.
${ownerName ? `The known owner name is: "${ownerName}".` : "We do not know the owner's name yet."}

Find the LinkedIn profile of the business OWNER/FOUNDER/GÉRANT — NOT just any employee.

{
  "linkedin_profile_url": "the linkedin.com/in/... URL of the owner's profile",
  "person_name": "full name of the person",
  "person_title": "their job title as shown in the Google snippet",
  "is_relevant": true if this person appears to be the owner/gérant/fondateur of "${businessName}", false if unrelated
}

IMPORTANT: Only return data if the person is clearly connected to "${businessName}". If unsure, set is_relevant to false.

Return JSON only.`,
        searchScreenshot
      );

      if (!searchResult.is_relevant || !searchResult.linkedin_profile_url) {
        continue;
      }

      // Visit the LinkedIn profile
      const profileUrl = normalizeUrl(searchResult.linkedin_profile_url);
      if (!profileUrl) continue;

      try {
        await page.goto(profileUrl, {
          waitUntil: "domcontentloaded",
          timeout: 15000,
        });
        await page.waitForTimeout(3000);

        // LinkedIn might show a login wall — screenshot whatever is visible
        const profileScreenshot = await screenshotToBase64(page);

        const profileResult = await askGemini<LinkedInResult>(
          `You are looking at a LinkedIn profile page. We believe this person is the owner of "${businessName}" in ${location}.

Extract ALL available information (even if LinkedIn shows a partial/logged-out view):

{
  "linkedin_url": "the profile URL",
  "owner_name": "full name",
  "owner_title": "current job title / headline",
  "owner_description": "their About/summary if visible",
  "company_linkedin_url": "LinkedIn company page URL if visible",
  "phone": "phone if visible (rare on public profiles)",
  "email": "email if visible (rare on public profiles)"
}

If LinkedIn is completely blocking content (full login wall with no info), still return the URL and name from the page title.

Return JSON only.`,
          profileScreenshot
        );

        if (profileResult.owner_name || profileResult.linkedin_url) {
          log(
            `[LinkedIn] ✓ Found: ${profileResult.owner_name || "profile"} — ${profileResult.owner_title || "no title"}`
          );
          return {
            ...profileResult,
            linkedin_url: normalizeUrl(profileResult.linkedin_url) || profileUrl,
            company_linkedin_url: normalizeUrl(profileResult.company_linkedin_url),
          };
        }
      } catch {
        // LinkedIn blocked or timeout — still return what we got from Google results
        log(`[LinkedIn] Profile page blocked, using Google snippet data`);
        return {
          linkedin_url: profileUrl,
          owner_name: searchResult.person_name,
          owner_title: searchResult.person_title,
          owner_description: null,
          company_linkedin_url: null,
          phone: null,
          email: null,
        };
      }
    } catch (e) {
      log(`[LinkedIn] ✗ Search failed: ${e}`);
    }
  }

  log(`[LinkedIn] No profile found for "${businessName}"`);
  return null;
}
