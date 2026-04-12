import type { Page } from "playwright-core";
import {
  screenshotAndAsk,
  safeGoto,
  normalizeUrl,
  randomDelay,
} from "../browser";

export interface LinkedInResult {
  linkedin_url: string | null;
  owner_name: string | null;
  owner_title: string | null;
  owner_description: string | null;
  company_linkedin_url: string | null;
  phone: string | null;
  email: string | null;
}

function city(location: string): string {
  return location.replace(/\d{5}/g, "").replace(/,.*$/, "").trim();
}

function googleUrl(query: string): string {
  return `https://www.google.com/search?q=${encodeURIComponent(query)}&hl=fr`;
}

/**
 * Search LinkedIn via Google (site:linkedin.com) with 3+ queries.
 * Prioritizes owner profiles when owner name is known from Societe.com.
 */
export async function searchLinkedIn(
  page: Page,
  businessName: string,
  location: string,
  ownerName: string | null,
  log: (msg: string) => void
): Promise<LinkedInResult | null> {
  const c = city(location);

  const queries: string[] = [];

  // Owner-targeted queries first (most valuable)
  if (ownerName) {
    queries.push(
      `site:linkedin.com/in/ "${ownerName}" "${businessName}"`,
      `site:linkedin.com/in/ "${ownerName}" ${c}`,
      `site:linkedin.com/in/ "${ownerName}" "${businessName}" ${c}`
    );
  }

  // Generic business queries
  queries.push(
    `site:linkedin.com "${businessName}" ${c} gérant OR fondateur OR owner OR CEO`,
    `site:linkedin.com/company/ "${businessName}" ${c}`,
    `site:linkedin.com/in/ "${businessName}" ${c} dirigeant founder`
  );

  for (const query of queries) {
    try {
      log(`[LinkedIn] "${query}"`);
      const ok = await safeGoto(page, googleUrl(query), log);
      if (!ok) continue;

      // Check if we got LinkedIn results
      const liLink = page
        .locator(
          'a[href*="linkedin.com/in/"], a[href*="linkedin.com/company/"]'
        )
        .first();
      if (!(await liLink.isVisible({ timeout: 3000 }))) {
        await randomDelay(1500, 3000);
        continue;
      }

      // Analyze Google results page for relevance
      const searchResult = await screenshotAndAsk<{
        linkedin_profile_url: string | null;
        person_name: string | null;
        person_title: string | null;
        is_relevant: boolean;
      }>(
        page,
        `You are looking at Google results for LinkedIn profiles related to "${businessName}" in ${location}.
${ownerName ? `Known owner: "${ownerName}".` : "Owner name unknown."}

Find the LinkedIn profile of the OWNER/FOUNDER/GÉRANT — NOT just any employee.

{
  "linkedin_profile_url": "linkedin.com/in/... URL of the owner" or null,
  "person_name": "full name" or null,
  "person_title": "job title from Google snippet" or null,
  "is_relevant": true if clearly the owner/gérant/fondateur of "${businessName}"
}

Return JSON only.`
      );

      if (!searchResult.is_relevant || !searchResult.linkedin_profile_url) {
        await randomDelay(1500, 3000);
        continue;
      }

      // Visit the LinkedIn profile
      const profileUrl = normalizeUrl(searchResult.linkedin_profile_url);
      if (!profileUrl) continue;

      try {
        log(`[LinkedIn] Visiting profile: ${profileUrl}`);
        const profileOk = await safeGoto(page, profileUrl, log);

        if (profileOk) {
          const profileResult = await screenshotAndAsk<LinkedInResult>(
            page,
            `You are looking at a LinkedIn profile page. This person is likely the owner of "${businessName}" in ${location}.

Extract:
{
  "linkedin_url": "profile URL" or null,
  "owner_name": "full name" or null,
  "owner_title": "headline / job title" or null,
  "owner_description": "About/summary text" or null,
  "company_linkedin_url": "company page URL if visible" or null,
  "phone": "phone if visible" or null,
  "email": "email if visible" or null
}

If LinkedIn shows a login wall with no info, still return URL and name from page title.
Return JSON only.`
          );

          if (profileResult.owner_name || profileResult.linkedin_url) {
            log(
              `[LinkedIn] ✓ ${profileResult.owner_name || "profile"} — ${profileResult.owner_title || "no title"}`
            );
            return {
              ...profileResult,
              linkedin_url:
                normalizeUrl(profileResult.linkedin_url) || profileUrl,
              company_linkedin_url: normalizeUrl(
                profileResult.company_linkedin_url
              ),
            };
          }
        }
      } catch {
        // LinkedIn blocked — use Google snippet data
        log(`[LinkedIn] Profile blocked, using Google snippet`);
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

      await randomDelay(1500, 3000);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("closed") || msg.includes("Protocol error")) throw e;
      log(`[LinkedIn] ✗ ${msg.slice(0, 80)}`);
    }
  }

  log(`[LinkedIn] No profile found for "${businessName}"`);
  return null;
}
