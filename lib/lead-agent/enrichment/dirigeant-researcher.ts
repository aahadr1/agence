import type { Page } from "playwright-core";
import {
  screenshotAndAsk,
  askGeminiText,
  safeGoto,
  normalizeUrl,
  randomDelay,
  dismissConsent,
} from "../browser";

export interface DirigeantResult {
  owner_name: string | null;
  owner_phone: string | null;
  owner_email: string | null;
  owner_role: string | null;
  linkedin_url: string | null;
  linkedin_summary: string | null;
}

function googleUrl(query: string): string {
  return `https://www.google.com/search?q=${encodeURIComponent(query)}&hl=fr&num=10`;
}

function city(location: string): string {
  return location.replace(/\d{5}/g, "").replace(/,.*$/, "").trim();
}

/**
 * Extract organic result links from Google SERP and filter to those
 * that contain the person's name in the URL, title, or snippet text.
 */
async function extractLinksWithName(
  page: Page,
  firstName: string,
  lastName: string
): Promise<string[]> {
  try {
    return await page.evaluate(
      ({ first, last }) => {
        const nameLower = `${first} ${last}`.toLowerCase();
        const firstLower = first.toLowerCase();
        const lastLower = last.toLowerCase();
        const blocked = [
          "google.",
          "gstatic.",
          "accounts.google",
          "policies.google",
          "support.google",
          "maps.google",
          "play.google",
        ];

        const results: string[] = [];
        const anchors = Array.from(document.querySelectorAll("a[href]")) as HTMLAnchorElement[];

        for (const a of anchors) {
          const href = a.href;
          if (!href || !href.startsWith("http")) continue;
          try {
            const u = new URL(href);
            if (blocked.some((b) => u.hostname.includes(b))) continue;
            // Check if the link text, surrounding text, or URL contains the name
            const text = (a.textContent || "").toLowerCase();
            const title = (a.getAttribute("title") || "").toLowerCase();
            const urlStr = href.toLowerCase();
            const parent = a.closest("[data-ved]") || a.parentElement;
            const context = (parent?.textContent || "").toLowerCase();

            const nameInUrl =
              urlStr.includes(firstLower) || urlStr.includes(lastLower);
            const nameInText =
              text.includes(nameLower) ||
              title.includes(nameLower) ||
              context.includes(nameLower) ||
              context.includes(firstLower) ||
              context.includes(lastLower);

            if (nameInUrl || nameInText) {
              if (!results.includes(href)) results.push(href);
              if (results.length >= 12) break;
            }
          } catch {
            /* bad href */
          }
        }

        return results;
      },
      { first: firstName, last: lastName }
    );
  } catch {
    return [];
  }
}

/**
 * Also extract ALL organic links (for broader search on name-less SERPs)
 */
async function extractAllOrganicLinks(page: Page): Promise<string[]> {
  try {
    return await page.evaluate(() => {
      const blocked = [
        "google.",
        "gstatic.",
        "accounts.google",
        "policies.google",
        "support.google",
        "maps.google",
        "play.google",
      ];
      const results: string[] = [];
      const anchors = Array.from(document.querySelectorAll("a[href]")) as HTMLAnchorElement[];
      for (const a of anchors) {
        const href = a.href;
        if (!href || !href.startsWith("http")) continue;
        try {
          const u = new URL(href);
          if (blocked.some((b) => u.hostname.includes(b))) continue;
          if (!results.includes(href)) results.push(href);
          if (results.length >= 15) break;
        } catch {
          /* */
        }
      }
      return results;
    });
  } catch {
    return [];
  }
}

interface PageContactResult {
  owner_phone: string | null;
  owner_email: string | null;
  linkedin_url: string | null;
  owner_role: string | null;
  relevant: boolean;
}

/**
 * Ask Gemini to extract contact info from a page that may mention the dirigeant.
 */
async function extractContactFromPage(
  page: Page,
  ownerName: string,
  businessName: string
): Promise<PageContactResult | null> {
  try {
    return await screenshotAndAsk<PageContactResult>(
      page,
      `You are looking at a webpage. We are searching for contact information about "${ownerName}", who is the owner/dirigeant of "${businessName}".

Extract:
{
  "owner_phone": "personal phone number (06/07 XX XX XX XX) or business phone if linked to this person" or null,
  "owner_email": "personal or professional email address" or null,
  "linkedin_url": "full linkedin.com/in/... profile URL" or null,
  "owner_role": "job title / role (Gérant, PDG, Fondateur, etc.)" or null,
  "relevant": true if this page mentions "${ownerName}" in a meaningful way, false otherwise
}

Only return data if you are confident it belongs to "${ownerName}".
Return JSON only.`
    );
  } catch {
    return null;
  }
}

/**
 * Analyze a LinkedIn profile page to extract role and summary.
 */
async function analyzeLinkedInProfile(
  page: Page,
  ownerName: string
): Promise<{ owner_role: string | null; linkedin_summary: string | null }> {
  try {
    const result = await screenshotAndAsk<{
      owner_role: string | null;
      current_company: string | null;
      linkedin_summary: string | null;
    }>(
      page,
      `You are looking at a LinkedIn profile page for "${ownerName}".

Extract:
{
  "owner_role": "current job title / role as shown on LinkedIn" or null,
  "current_company": "current company name" or null,
  "linkedin_summary": "1-2 sentence summary of their professional background from the profile" or null
}

Return JSON only.`
    );
    return {
      owner_role: result.owner_role,
      linkedin_summary: result.linkedin_summary,
    };
  } catch {
    return { owner_role: null, linkedin_summary: null };
  }
}

/**
 * Try to find the owner name if not already known from Societe.com.
 */
async function findOwnerName(
  page: Page,
  businessName: string,
  location: string,
  niche: string | null,
  log: (msg: string) => void
): Promise<string | null> {
  const c = city(location);
  const query = `"${businessName}" ${c} gérant dirigeant fondateur responsable`;
  log(`[Dirigeant] Searching for owner name: "${query}"`);

  try {
    const ok = await safeGoto(page, googleUrl(query), log);
    if (!ok) return null;

    await dismissConsent(page);
    await randomDelay(1000, 2000);

    const result = await screenshotAndAsk<{ owner_name: string | null; owner_role: string | null }>(
      page,
      `You are looking at Google Search results. We need the name of the owner/gérant/dirigeant/fondateur of the business "${businessName}" in ${c}${niche ? ` (${niche})` : ""}.

{
  "owner_name": "full name of the business owner/dirigeant" or null,
  "owner_role": "their role (Gérant, PDG, Fondateur, etc.)" or null
}

Only return a name if you are confident it is the person running "${businessName}". Return JSON only.`
    );

    if (result.owner_name) {
      log(`[Dirigeant] Found owner name: ${result.owner_name}`);
    }
    return result.owner_name;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("closed") || msg.includes("Protocol error")) throw e;
    log(`[Dirigeant] Owner name search error: ${msg.slice(0, 80)}`);
    return null;
  }
}

/**
 * Deep dirigeant researcher:
 * 1. If owner_name unknown → search for it first
 * 2. Run 5-10 varied Google searches for the owner
 * 3. For each SERP → extract links mentioning the name → navigate up to 10 total
 * 4. Extract phone, email, LinkedIn URL from each visited page
 * 5. If LinkedIn found → navigate to it and analyze the profile
 */
export async function researchDirigeant(
  page: Page,
  ownerName: string | null,
  businessName: string,
  location: string,
  niche: string | null,
  log: (msg: string) => void
): Promise<DirigeantResult> {
  const c = city(location);
  const result: DirigeantResult = {
    owner_name: ownerName,
    owner_phone: null,
    owner_email: null,
    owner_role: null,
    linkedin_url: null,
    linkedin_summary: null,
  };

  // ── Find owner name if not provided ──
  if (!ownerName) {
    const found = await findOwnerName(page, businessName, location, niche, log);
    if (!found) {
      log(`[Dirigeant] No owner name available — skipping deep research`);
      return result;
    }
    result.owner_name = found;
    ownerName = found;
  }

  const parts = ownerName.trim().split(/\s+/);
  const firstName = parts[0];
  const lastName = parts[parts.length - 1];

  log(`[Dirigeant] Researching: ${ownerName}`);

  // ── Build search queries (5-10 variants) ──
  const queries = [
    `"${ownerName}" "${businessName}"`,
    `"${ownerName}" ${c} linkedin`,
    `"${ownerName}" ${c} téléphone contact`,
    `"${ownerName}" ${c} dirigeant`,
    `"${ownerName}" gérant ${niche || businessName}`,
    `"${firstName} ${lastName}" ${c} email`,
    `"${firstName} ${lastName}" entrepreneur ${c}`,
    `site:linkedin.com "${ownerName}" ${c}`,
    `"${ownerName}" ${businessName} site`,
    `"${ownerName}" ${c} professionnel`,
  ].filter((q, i, arr) => arr.indexOf(q) === i); // dedupe

  let totalNavigations = 0;
  const MAX_NAVIGATIONS = 10;

  for (const query of queries) {
    if (totalNavigations >= MAX_NAVIGATIONS) break;
    if (result.owner_phone && result.owner_email && result.linkedin_url) break;

    log(`[Dirigeant] Query: "${query}"`);

    try {
      const ok = await safeGoto(page, googleUrl(query), log);
      if (!ok) continue;

      await dismissConsent(page);
      await randomDelay(800, 1800);

      // Extract links that mention the name
      let links = await extractLinksWithName(page, firstName, lastName);

      // Fallback: if not many name-filtered links, use all organic links
      if (links.length < 2) {
        const allLinks = await extractAllOrganicLinks(page);
        links = [...new Set([...links, ...allLinks])].slice(0, 10);
      }

      log(`[Dirigeant] Found ${links.length} relevant links for "${ownerName}"`);

      for (const link of links) {
        if (totalNavigations >= MAX_NAVIGATIONS) break;
        if (result.owner_phone && result.owner_email && result.linkedin_url) break;

        totalNavigations++;
        const isLinkedIn = link.includes("linkedin.com");

        try {
          log(`[Dirigeant] Checking: ${link.slice(0, 80)}`);
          const ok = await safeGoto(page, link, log, 15000);
          if (!ok) continue;

          await dismissConsent(page);
          await randomDelay(800, 1500);

          if (isLinkedIn && link.includes("/in/")) {
            // LinkedIn profile — do targeted analysis
            if (!result.linkedin_url) {
              result.linkedin_url = normalizeUrl(link) || link;
            }
            const profileData = await analyzeLinkedInProfile(page, ownerName);
            result.owner_role = result.owner_role || profileData.owner_role;
            result.linkedin_summary = result.linkedin_summary || profileData.linkedin_summary;
            log(`[Dirigeant] LinkedIn: ${result.owner_role || "role unknown"}`);
          } else if (isLinkedIn && link.includes("/pub/")) {
            // LinkedIn public profile
            if (!result.linkedin_url) {
              result.linkedin_url = normalizeUrl(link) || link;
            }
          } else {
            // General page
            const contact = await extractContactFromPage(page, ownerName, businessName);
            if (contact?.relevant) {
              result.owner_phone = result.owner_phone || contact.owner_phone;
              result.owner_email = result.owner_email || contact.owner_email;
              result.linkedin_url =
                result.linkedin_url || normalizeUrl(contact.linkedin_url);
              result.owner_role = result.owner_role || contact.owner_role;

              if (contact.owner_phone || contact.owner_email) {
                log(
                  `[Dirigeant] Found: phone=${contact.owner_phone || "—"} email=${contact.owner_email || "—"}`
                );
              }
            }
          }

          await randomDelay(400, 900);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          if (msg.includes("closed") || msg.includes("Protocol error")) throw e;
          log(`[Dirigeant] Link error: ${msg.slice(0, 60)}`);
        }
      }

      await randomDelay(1200, 2200);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("closed") || msg.includes("Protocol error")) throw e;
      log(`[Dirigeant] Query error: ${msg.slice(0, 80)}`);
    }
  }

  // ── If we have LinkedIn URL but didn't analyze it yet, do it now ──
  if (result.linkedin_url && !result.linkedin_summary) {
    try {
      log(`[Dirigeant] Analyzing LinkedIn profile: ${result.linkedin_url}`);
      const ok = await safeGoto(page, result.linkedin_url, log, 15000);
      if (ok) {
        await dismissConsent(page);
        await randomDelay(1000, 2000);
        const profileData = await analyzeLinkedInProfile(page, ownerName);
        result.owner_role = result.owner_role || profileData.owner_role;
        result.linkedin_summary = profileData.linkedin_summary;
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("closed") || msg.includes("Protocol error")) throw e;
    }
  }

  // ── PagesJaunes white pages fallback for phone ──
  if (!result.owner_phone) {
    try {
      const c2 = city(location);
      const wpUrl = `https://www.pagesjaunes.fr/pagesblanches/recherche?quoiqui=${encodeURIComponent(firstName + " " + lastName)}&ou=${encodeURIComponent(c2)}`;
      log(`[Dirigeant] White pages: "${firstName} ${lastName}" in ${c2}`);
      const ok = await safeGoto(page, wpUrl, log, 15000);
      if (ok) {
        await dismissConsent(page);
        const wpResult = await screenshotAndAsk<{ owner_phone: string | null }>(
          page,
          `You are looking at PagesJaunes white pages for "${firstName} ${lastName}".
Extract:
{
  "owner_phone": "their personal phone number from the listing" or null
}
Only return a phone if the name matches closely. Return JSON only.`
        );
        if (wpResult.owner_phone) {
          result.owner_phone = wpResult.owner_phone;
          log(`[Dirigeant] White pages phone: ${result.owner_phone}`);
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("closed") || msg.includes("Protocol error")) throw e;
      log(`[Dirigeant] White pages error: ${msg.slice(0, 60)}`);
    }
  }

  log(
    `[Dirigeant] ✓ ${ownerName}: phone=${result.owner_phone || "—"} email=${result.owner_email || "—"} linkedin=${result.linkedin_url ? "✓" : "—"}`
  );

  return result;
}
