import type { Page } from "playwright-core";
import {
  screenshotAndAsk,
  askGeminiText,
  safeGoto,
  normalizeUrl,
  randomDelay,
  dismissConsent,
} from "../browser";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RelatedContact {
  name: string;
  title: string | null;
  linkedin_url: string | null;
}

export interface DirigeantResult {
  owner_name: string | null;
  owner_phone: string | null;
  owner_email: string | null;
  owner_role: string | null;
  linkedin_url: string | null;
  linkedin_summary: string | null;
  linkedin_headline: string | null;
  related_contacts: RelatedContact[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function googleUrl(query: string): string {
  return `https://www.google.com/search?q=${encodeURIComponent(query)}&hl=fr&num=10`;
}

function city(location: string): string {
  return location.replace(/\d{5}/g, "").replace(/,.*$/, "").trim();
}

const PHONE_RE = /(?:0[1-9][\s.]?\d{2}[\s.]?\d{2}[\s.]?\d{2}[\s.]?\d{2}|\+33[\s.]?\d[\s.]?\d{2}[\s.]?\d{2}[\s.]?\d{2}[\s.]?\d{2})/g;
const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

/**
 * Extract phones and emails from page text content via DOM (no AI needed).
 */
async function extractContactFromDOM(page: Page): Promise<{
  phones: string[];
  emails: string[];
}> {
  try {
    return await page.evaluate(
      ({ phoneRe, emailRe }) => {
        const text = document.body?.innerText || "";
        const phones = [...new Set(text.match(new RegExp(phoneRe, "g")) || [])];
        const emails = [...new Set(text.match(new RegExp(emailRe, "g")) || [])];
        return { phones: phones.slice(0, 5), emails: emails.slice(0, 5) };
      },
      { phoneRe: PHONE_RE.source, emailRe: EMAIL_RE.source }
    );
  } catch {
    return { phones: [], emails: [] };
  }
}

/**
 * Extract organic SERP links from Google results page.
 */
async function extractSerpLinks(page: Page): Promise<string[]> {
  try {
    return await page.evaluate(() => {
      const blocked = [
        "google.", "gstatic.", "accounts.google", "policies.google",
        "support.google", "maps.google", "play.google", "youtube.com",
      ];
      const results: string[] = [];
      for (const a of document.querySelectorAll<HTMLAnchorElement>("a[href]")) {
        const href = a.href;
        if (!href?.startsWith("http")) continue;
        try {
          const u = new URL(href);
          if (blocked.some((b) => u.hostname.includes(b))) continue;
          if (!results.includes(href)) results.push(href);
          if (results.length >= 10) break;
        } catch { /* bad URL */ }
      }
      return results;
    });
  } catch {
    return [];
  }
}

/**
 * Extract SERP snippet text for contact info using DOM only — no AI.
 */
async function extractContactFromSerpSnippets(
  page: Page,
  ownerName: string
): Promise<{ phone: string | null; email: string | null }> {
  try {
    const result = await page.evaluate(
      ({ phoneRe, emailRe, name }) => {
        const nameLower = name.toLowerCase();
        let phone: string | null = null;
        let email: string | null = null;
        // Look in snippet divs and spans near the owner name
        const containers = document.querySelectorAll(
          "[data-ved], .g, .tF2Cxc, .IsZvec, .VwiC3b"
        );
        for (const el of containers) {
          const text = el.textContent || "";
          if (!text.toLowerCase().includes(nameLower)) continue;
          const phones = text.match(new RegExp(phoneRe, "g"));
          const emails = text.match(new RegExp(emailRe, "g"));
          if (phones?.[0] && !phone) phone = phones[0];
          if (emails?.[0] && !email) email = emails[0];
          if (phone && email) break;
        }
        return { phone, email };
      },
      { phoneRe: PHONE_RE.source, emailRe: EMAIL_RE.source, name: ownerName }
    );
    return result;
  } catch {
    return { phone: null, email: null };
  }
}

/**
 * Find LinkedIn profile URL from a Google SERP.
 */
async function extractLinkedInUrl(page: Page, ownerName: string): Promise<string | null> {
  try {
    return await page.evaluate((name) => {
      const nameParts = name.toLowerCase().split(/\s+/);
      for (const a of document.querySelectorAll<HTMLAnchorElement>("a[href*='linkedin.com/in/']")) {
        const href = a.href;
        const text = (a.textContent || "").toLowerCase();
        const parent = a.closest("[data-ved]") || a.parentElement;
        const context = (parent?.textContent || "").toLowerCase();
        const combined = text + " " + context + " " + href.toLowerCase();
        if (nameParts.every((p) => combined.includes(p))) return href;
      }
      // Fallback: first linkedin.com/in/ link
      const first = document.querySelector<HTMLAnchorElement>("a[href*='linkedin.com/in/']");
      return first?.href || null;
    }, ownerName);
  } catch {
    return null;
  }
}

/**
 * Find a Facebook profile/page URL from a Google SERP.
 */
async function extractFacebookUrl(page: Page, ownerName: string): Promise<string | null> {
  try {
    return await page.evaluate((name) => {
      const nameParts = name.toLowerCase().split(/\s+/);
      for (const a of document.querySelectorAll<HTMLAnchorElement>("a[href*='facebook.com/']")) {
        const href = a.href;
        if (href.includes("facebook.com/policies") || href.includes("facebook.com/help")) continue;
        const text = (a.textContent || "").toLowerCase();
        const parent = a.closest("[data-ved]") || a.parentElement;
        const context = (parent?.textContent || "").toLowerCase();
        const combined = text + " " + context;
        if (nameParts.some((p) => combined.includes(p))) return href;
      }
      return null;
    }, ownerName);
  } catch {
    return null;
  }
}

/**
 * Navigate to a LinkedIn profile and extract structured data using DOM first, AI fallback.
 */
async function analyzeLinkedInProfile(
  page: Page,
  ownerName: string,
  log: (msg: string) => void
): Promise<{
  headline: string | null;
  role: string | null;
  summary: string | null;
  relatedContacts: RelatedContact[];
}> {
  const result = { headline: null as string | null, role: null as string | null, summary: null as string | null, relatedContacts: [] as RelatedContact[] };

  // Try DOM extraction first
  try {
    const domData = await page.evaluate(() => {
      const headline = document.querySelector(".text-body-medium")?.textContent?.trim()
        || document.querySelector("[data-generated-suggestion-target]")?.textContent?.trim()
        || null;
      const name = document.querySelector(".text-heading-xlarge")?.textContent?.trim()
        || document.querySelector("h1")?.textContent?.trim()
        || null;

      // "People also viewed" sidebar
      const related: { name: string; title: string | null; url: string | null }[] = [];
      const cards = document.querySelectorAll(
        ".pv-browsemap-section li, aside li, [data-view-name='profile-browsemap'] li"
      );
      for (const card of cards) {
        const link = card.querySelector("a");
        const cardName = card.querySelector(".discover-person-card__name, .text-body-small, strong")?.textContent?.trim();
        const cardTitle = card.querySelector(".discover-person-card__occupation, .text-body-small:not(:first-child)")?.textContent?.trim();
        if (cardName) {
          related.push({
            name: cardName,
            title: cardTitle || null,
            url: link?.href || null,
          });
        }
      }

      return { headline, name, related };
    });

    if (domData.headline) result.headline = domData.headline;
    if (domData.related.length > 0) {
      result.relatedContacts = domData.related.map((r) => ({
        name: r.name,
        title: r.title,
        linkedin_url: r.url && r.url.includes("linkedin.com") ? r.url : null,
      }));
    }
  } catch {
    log(`[Dirigeant] LinkedIn DOM extraction failed — trying AI`);
  }

  // AI fallback for headline/summary if DOM didn't get it
  if (!result.headline) {
    try {
      const aiData = await screenshotAndAsk<{
        headline: string | null;
        role: string | null;
        summary: string | null;
        related_people: { name: string; title: string | null; linkedin_url: string | null }[];
      }>(
        page,
        `You are looking at a LinkedIn profile page for "${ownerName}".

Extract:
{
  "headline": "their LinkedIn headline/tagline" or null,
  "role": "current job title" or null,
  "summary": "1-2 sentence professional summary" or null,
  "related_people": [{"name": "...", "title": "...", "linkedin_url": "..." or null}] (from "People also viewed" sidebar, max 5)
}

Return JSON only.`
      );

      result.headline = result.headline || aiData.headline;
      result.role = result.role || aiData.role;
      result.summary = result.summary || aiData.summary;
      if (aiData.related_people?.length > 0 && result.relatedContacts.length === 0) {
        result.relatedContacts = aiData.related_people.slice(0, 5).map((r) => ({
          name: r.name,
          title: r.title,
          linkedin_url: r.linkedin_url,
        }));
      }
    } catch {
      log(`[Dirigeant] LinkedIn AI analysis failed`);
    }
  }

  return result;
}

/**
 * Try to find the owner name when not provided — uses Google SERP + AI.
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

// ---------------------------------------------------------------------------
// Sub-tasks: Google / Facebook / LinkedIn — run in parallel
// ---------------------------------------------------------------------------

async function googleOwnerSearch(
  page: Page,
  ownerName: string,
  businessName: string,
  location: string,
  log: (msg: string) => void
): Promise<{ phone: string | null; email: string | null; role: string | null }> {
  const c = city(location);
  const query = `"${ownerName}" "${businessName}" ${c} contact email téléphone`;
  log(`[Dirigeant/Google] "${query}"`);

  try {
    const ok = await safeGoto(page, googleUrl(query), log);
    if (!ok) return { phone: null, email: null, role: null };

    await dismissConsent(page);
    await randomDelay(800, 1500);

    // DOM-based extraction from SERP snippets — no navigation needed
    const contact = await extractContactFromSerpSnippets(page, ownerName);

    // Also extract from all SERP text (broader)
    const { phones, emails } = await extractContactFromDOM(page);

    const phone = contact.phone || phones[0] || null;
    const email = contact.email || emails[0] || null;

    if (phone || email) {
      log(`[Dirigeant/Google] Found: phone=${phone || "—"} email=${email || "—"}`);
    }

    return { phone, email, role: null };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("closed") || msg.includes("Protocol error")) throw e;
    log(`[Dirigeant/Google] ✗ ${msg.slice(0, 60)}`);
    return { phone: null, email: null, role: null };
  }
}

async function facebookOwnerSearch(
  page: Page,
  ownerName: string,
  businessName: string,
  location: string,
  log: (msg: string) => void
): Promise<{ phone: string | null; email: string | null; facebook_url: string | null }> {
  const c = city(location);
  const query = `"${ownerName}" site:facebook.com ${businessName} ${c}`;
  log(`[Dirigeant/Facebook] "${query}"`);

  try {
    const ok = await safeGoto(page, googleUrl(query), log);
    if (!ok) return { phone: null, email: null, facebook_url: null };

    await dismissConsent(page);
    await randomDelay(800, 1500);

    const fbUrl = await extractFacebookUrl(page, ownerName);
    let phone: string | null = null;
    let email: string | null = null;

    // Navigate to Facebook page if found
    if (fbUrl) {
      log(`[Dirigeant/Facebook] Profile: ${fbUrl.slice(0, 60)}`);
      const navOk = await safeGoto(page, fbUrl, log, 12000);
      if (navOk) {
        await dismissConsent(page);
        await randomDelay(800, 1200);
        const contact = await extractContactFromDOM(page);
        phone = contact.phones[0] || null;
        email = contact.emails[0] || null;
      }
    }

    return { phone, email, facebook_url: fbUrl };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("closed") || msg.includes("Protocol error")) throw e;
    log(`[Dirigeant/Facebook] ✗ ${msg.slice(0, 60)}`);
    return { phone: null, email: null, facebook_url: null };
  }
}

async function linkedinOwnerSearch(
  page: Page,
  ownerName: string,
  businessName: string,
  location: string,
  log: (msg: string) => void
): Promise<{
  linkedin_url: string | null;
  headline: string | null;
  role: string | null;
  summary: string | null;
  phone: string | null;
  email: string | null;
  relatedContacts: RelatedContact[];
}> {
  const c = city(location);
  const query = `site:linkedin.com/in/ "${ownerName}" ${c}`;
  log(`[Dirigeant/LinkedIn] "${query}"`);

  const empty = {
    linkedin_url: null as string | null,
    headline: null as string | null,
    role: null as string | null,
    summary: null as string | null,
    phone: null as string | null,
    email: null as string | null,
    relatedContacts: [] as RelatedContact[],
  };

  try {
    const ok = await safeGoto(page, googleUrl(query), log);
    if (!ok) return empty;

    await dismissConsent(page);
    await randomDelay(800, 1500);

    const liUrl = await extractLinkedInUrl(page, ownerName);
    if (!liUrl) {
      log(`[Dirigeant/LinkedIn] No profile found`);
      return empty;
    }

    log(`[Dirigeant/LinkedIn] Profile: ${liUrl.slice(0, 60)}`);
    const navOk = await safeGoto(page, liUrl, log, 15000);
    if (!navOk) return { ...empty, linkedin_url: normalizeUrl(liUrl) };

    await dismissConsent(page);
    await randomDelay(1000, 2000);

    // Scroll down to load "People also viewed"
    try {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight * 0.7));
      await randomDelay(800, 1200);
    } catch { /* may fail */ }

    const profileData = await analyzeLinkedInProfile(page, ownerName, log);

    // Check for contact info on the profile page
    const contact = await extractContactFromDOM(page);

    return {
      linkedin_url: normalizeUrl(liUrl),
      headline: profileData.headline,
      role: profileData.role,
      summary: profileData.summary,
      phone: contact.phones[0] || null,
      email: contact.emails[0] || null,
      relatedContacts: profileData.relatedContacts,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("closed") || msg.includes("Protocol error")) throw e;
    log(`[Dirigeant/LinkedIn] ✗ ${msg.slice(0, 60)}`);
    return empty;
  }
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Focused dirigeant researcher: 3 parallel queries (Google/Facebook/LinkedIn)
 * instead of the old 10-query sequential approach.
 *
 * 1. If owner_name unknown → find it via SERP + AI (single query)
 * 2. Run 3 focused searches in parallel
 * 3. If LinkedIn found → extract profile + related contacts
 */
export async function researchDirigeant(
  page: Page,
  ownerName: string | null,
  businessName: string,
  location: string,
  niche: string | null,
  log: (msg: string) => void
): Promise<DirigeantResult> {
  const result: DirigeantResult = {
    owner_name: ownerName,
    owner_phone: null,
    owner_email: null,
    owner_role: null,
    linkedin_url: null,
    linkedin_summary: null,
    linkedin_headline: null,
    related_contacts: [],
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

  log(`[Dirigeant] Researching: ${ownerName} — 3 parallel queries`);

  // ── Run 3 focused queries in parallel using the same page ──
  // Since we have a single page, we run them sequentially but each is fast
  // (1 SERP + at most 1 navigation = 2 page loads each)

  // Google search — DOM extraction from SERP snippets
  const googleResult = await googleOwnerSearch(page, ownerName, businessName, location, log);

  // Facebook — find profile + extract contact
  const fbResult = await facebookOwnerSearch(page, ownerName, businessName, location, log);

  // LinkedIn — find profile, extract headline/role/summary + related contacts
  const liResult = await linkedinOwnerSearch(page, ownerName, businessName, location, log);

  // ── Merge results ──
  result.owner_phone = googleResult.phone || fbResult.phone || liResult.phone;
  result.owner_email = googleResult.email || fbResult.email || liResult.email;
  result.owner_role = liResult.role || googleResult.role;
  result.linkedin_url = liResult.linkedin_url;
  result.linkedin_headline = liResult.headline;
  result.linkedin_summary = liResult.summary;
  result.related_contacts = liResult.relatedContacts;

  log(
    `[Dirigeant] ✓ ${ownerName}: phone=${result.owner_phone || "—"} email=${result.owner_email || "—"} linkedin=${result.linkedin_url ? "✓" : "—"} related=${result.related_contacts.length}`
  );

  return result;
}
