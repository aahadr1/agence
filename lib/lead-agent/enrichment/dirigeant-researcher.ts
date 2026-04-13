/**
 * Dirigeant researcher — finds business owner name + contact info.
 *
 * Strategy:
 * 1. If owner name unknown: parallel discovery via
 *    - Google SERP text extraction + Gemini TEXT
 *    - Facebook business page (often lists the owner)
 *    - Pappers/Infogreffe SERP text fallback
 *
 * 2. Once name is known: parallel deep search via
 *    - Google: phone, email, role, LinkedIn URL
 *    - Facebook: personal profile or mentions
 *    - LinkedIn: profile page (text extraction)
 *    - PagesJaunes white pages: personal phone
 *
 * All AI calls use Gemini TEXT (not vision screenshots) — 5-10× faster
 * and more reliable on serverless.
 */

import type { Page } from "playwright-core";
import {
  askGeminiText,
  askGemini,
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function googleUrl(query: string): string {
  return `https://www.google.com/search?q=${encodeURIComponent(query)}&hl=fr&num=10&gl=fr`;
}

function cityFromLocation(location: string): string {
  return location.replace(/\d{5}/g, "").replace(/,.*$/, "").trim();
}

/** Get the visible text of a page (body), cleaned up for prompt use */
async function pageText(page: Page, maxChars = 4000): Promise<string> {
  try {
    const raw = await page.evaluate(() => {
      // Remove scripts, styles, nav elements
      const remove = ["script", "style", "nav", "footer", "head"];
      remove.forEach((tag) =>
        document.querySelectorAll(tag).forEach((el) => el.remove())
      );
      return document.body?.innerText || document.body?.textContent || "";
    });
    return raw.replace(/\s{3,}/g, "\n").trim().slice(0, maxChars);
  } catch {
    return "";
  }
}

/** Extract organic SERP result URLs + titles (reuse pattern from website-finder) */
async function serpLinks(page: Page, max = 8): Promise<{ url: string; title: string }[]> {
  try {
    return await page.evaluate((lim) => {
      const out: { url: string; title: string }[] = [];
      const seen = new Set<string>();

      function unwrap(raw: string): string | null {
        if (!raw?.startsWith("http")) return null;
        try {
          const u = new URL(raw);
          const h = u.hostname.replace(/^www\./, "");
          if (h === "google.com" || h === "google.fr" || h.endsWith(".google.com") || h.endsWith(".google.fr")) {
            if (u.pathname.startsWith("/url")) {
              const inner = u.searchParams.get("q") || u.searchParams.get("url") || u.searchParams.get("u");
              return inner && /^https?:\/\//i.test(inner) ? inner : null;
            }
            return null;
          }
          return raw;
        } catch { return null; }
      }

      for (const block of [
        ...Array.from(document.querySelectorAll("div.g")),
        ...Array.from(document.querySelectorAll("div[data-sokoban-container]")),
      ]) {
        if (out.length >= lim) break;
        const anchor = block.querySelector<HTMLAnchorElement>("a[href]");
        if (!anchor) continue;
        const url = unwrap(anchor.href);
        if (!url || seen.has(url)) continue;
        const h3 = block.querySelector("h3");
        seen.add(url);
        out.push({ url, title: h3?.textContent?.trim() || "" });
      }
      return out;
    }, max);
  } catch { return []; }
}

// ---------------------------------------------------------------------------
// Step 1a: Find owner name via Google text + Gemini TEXT
// ---------------------------------------------------------------------------

async function findOwnerViaGoogle(
  page: Page,
  businessName: string,
  location: string,
  niche: string | null,
  log: (msg: string) => void
): Promise<{ owner_name: string | null; owner_role: string | null }> {
  const city = cityFromLocation(location);
  const query = `"${businessName}" ${city} gérant dirigeant propriétaire fondateur`;
  log(`[Dirigeant] Google owner search: "${query}"`);

  try {
    const ok = await safeGoto(page, googleUrl(query), log, 12000);
    if (!ok) return { owner_name: null, owner_role: null };

    await dismissConsent(page);
    await randomDelay(600, 1200);

    const text = await pageText(page, 5000);
    if (!text) return { owner_name: null, owner_role: null };

    const result = await askGemini<{ owner_name: string | null; owner_role: string | null }>(
      `Tu es expert en extraction d'informations. Voici des résultats Google pour "${businessName}" à ${city}${niche ? ` (${niche})` : ""}.

Texte:
${text}

Trouve le prénom et nom du propriétaire/gérant/dirigeant/fondateur de CE commerce spécifique.
{ "owner_name": "prénom nom complet" ou null, "owner_role": "Gérant / PDG / Fondateur / etc." ou null }
Retourne null si tu n'es pas sûr. JSON uniquement.`
    );
    if (result.owner_name) log(`[Dirigeant] Found via Google: ${result.owner_name}`);
    return result;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("closed") || msg.includes("Protocol error")) throw e;
    return { owner_name: null, owner_role: null };
  }
}

// ---------------------------------------------------------------------------
// Step 1b: Find owner name via Facebook business page
// ---------------------------------------------------------------------------

async function findOwnerViaFacebook(
  page: Page,
  businessName: string,
  location: string,
  log: (msg: string) => void
): Promise<{ owner_name: string | null; facebook_page_url: string | null }> {
  const city = cityFromLocation(location);
  const query = `site:facebook.com "${businessName}" ${city}`;
  log(`[Dirigeant] Facebook owner search: "${businessName}"`);

  try {
    const ok = await safeGoto(page, googleUrl(query), log, 12000);
    if (!ok) return { owner_name: null, facebook_page_url: null };

    await dismissConsent(page);
    await randomDelay(500, 1000);

    const links = await serpLinks(page, 5);
    const fbLink = links.find((l) => l.url.includes("facebook.com"));
    if (!fbLink) return { owner_name: null, facebook_page_url: null };

    // Navigate to the Facebook page
    const fbOk = await safeGoto(page, fbLink.url, log, 12000);
    if (!fbOk) return { owner_name: null, facebook_page_url: fbLink.url };

    await dismissConsent(page);
    await randomDelay(600, 1200);

    const text = await pageText(page, 4000);

    const result = await askGemini<{ owner_name: string | null }>(
      `Voici le contenu d'une page Facebook pour "${businessName}".
Texte: ${text}

Trouve le prénom et nom du gérant/propriétaire/fondateur de ce commerce s'il est mentionné.
{ "owner_name": "prénom nom" ou null }
JSON uniquement.`
    );

    if (result.owner_name) log(`[Dirigeant] Found via Facebook: ${result.owner_name}`);
    return { owner_name: result.owner_name, facebook_page_url: fbLink.url };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("closed") || msg.includes("Protocol error")) throw e;
    return { owner_name: null, facebook_page_url: null };
  }
}

// ---------------------------------------------------------------------------
// Step 2: Deep research once owner name is known
// ---------------------------------------------------------------------------

interface ContactResult {
  owner_phone: string | null;
  owner_email: string | null;
  linkedin_url: string | null;
  owner_role: string | null;
  linkedin_summary: string | null;
}

async function extractContactFromText(
  text: string,
  ownerName: string,
  businessName: string
): Promise<ContactResult | null> {
  if (!text.trim()) return null;

  const nameLower = ownerName.toLowerCase();
  if (!text.toLowerCase().includes(nameLower.split(" ")[0].toLowerCase()) &&
      !text.toLowerCase().includes(nameLower.split(" ").pop()!.toLowerCase())) {
    return null; // Page doesn't mention the person at all
  }

  try {
    return await askGemini<ContactResult>(
      `Tu analyses une page web pour trouver des infos sur "${ownerName}", gérant de "${businessName}".

Texte:
${text.slice(0, 3500)}

Extrait:
{
  "owner_phone": "numéro de téléphone personnel ou professionnel (format 06/07...)" ou null,
  "owner_email": "adresse email personnelle ou pro" ou null,
  "linkedin_url": "URL complète linkedin.com/in/..." ou null,
  "owner_role": "titre/poste (Gérant, PDG, Fondateur...)" ou null,
  "linkedin_summary": null
}
Retourne null pour les champs que tu ne trouves pas avec certitude. JSON uniquement.`
    );
  } catch {
    return null;
  }
}

async function searchOwnerOnGoogle(
  page: Page,
  ownerName: string,
  businessName: string,
  location: string,
  log: (msg: string) => void
): Promise<ContactResult> {
  const city = cityFromLocation(location);
  const result: ContactResult = {
    owner_phone: null,
    owner_email: null,
    linkedin_url: null,
    owner_role: null,
    linkedin_summary: null,
  };

  const queries = [
    `"${ownerName}" "${businessName}" contact téléphone`,
    `"${ownerName}" ${city} linkedin`,
    `"${ownerName}" ${city} email gérant`,
  ];

  let navigations = 0;
  const MAX_NAV = 4;

  for (const query of queries) {
    if (navigations >= MAX_NAV) break;
    if (result.owner_phone && result.owner_email && result.linkedin_url) break;

    log(`[Dirigeant] Google: "${query}"`);
    try {
      const ok = await safeGoto(page, googleUrl(query), log, 12000);
      if (!ok) continue;

      await dismissConsent(page);
      await randomDelay(500, 1000);

      const links = await serpLinks(page, 6);

      for (const { url, title } of links) {
        if (navigations >= MAX_NAV) break;
        if (result.owner_phone && result.owner_email && result.linkedin_url) break;

        const nameParts = ownerName.toLowerCase().split(" ");
        const relevant =
          nameParts.some((p) => url.toLowerCase().includes(p)) ||
          nameParts.some((p) => title.toLowerCase().includes(p)) ||
          url.includes("linkedin.com") ||
          url.includes("facebook.com");

        if (!relevant) continue;

        navigations++;
        try {
          const pageOk = await safeGoto(page, url, log, 12000);
          if (!pageOk) continue;

          await dismissConsent(page);
          await randomDelay(500, 1000);

          const text = await pageText(page, 4000);

          if (url.includes("linkedin.com/in/")) {
            if (!result.linkedin_url) result.linkedin_url = normalizeUrl(url) || url;
            const li = await askGemini<{ owner_role: string | null; linkedin_summary: string | null }>(
              `Page LinkedIn de "${ownerName}". Texte:\n${text.slice(0, 3000)}\n
{ "owner_role": "poste actuel" ou null, "linkedin_summary": "résumé pro 1-2 phrases" ou null }
JSON uniquement.`
            ).catch(() => null);
            if (li) {
              result.owner_role = result.owner_role || li.owner_role;
              result.linkedin_summary = result.linkedin_summary || li.linkedin_summary;
            }
          } else {
            const contact = await extractContactFromText(text, ownerName, businessName);
            if (contact) {
              result.owner_phone = result.owner_phone || contact.owner_phone;
              result.owner_email = result.owner_email || contact.owner_email;
              result.linkedin_url = result.linkedin_url || normalizeUrl(contact.linkedin_url);
              result.owner_role = result.owner_role || contact.owner_role;
              if (contact.owner_phone || contact.owner_email) {
                log(`[Dirigeant] Found: phone=${contact.owner_phone || "—"} email=${contact.owner_email || "—"}`);
              }
            }
          }

          await randomDelay(300, 700);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          if (msg.includes("closed") || msg.includes("Protocol error")) throw e;
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("closed") || msg.includes("Protocol error")) throw e;
      log(`[Dirigeant] Query error: ${msg.slice(0, 60)}`);
    }
  }

  return result;
}

async function searchOwnerPhone(
  page: Page,
  firstName: string,
  lastName: string,
  location: string,
  log: (msg: string) => void
): Promise<string | null> {
  const city = cityFromLocation(location);
  const url = `https://www.pagesjaunes.fr/pagesblanches/recherche?quoiqui=${encodeURIComponent(firstName + " " + lastName)}&ou=${encodeURIComponent(city)}`;
  log(`[Dirigeant] PagesJaunes: "${firstName} ${lastName}" à ${city}`);

  try {
    const ok = await safeGoto(page, url, log, 12000);
    if (!ok) return null;

    await dismissConsent(page);
    await randomDelay(500, 1000);

    const text = await pageText(page, 3000);
    if (!text) return null;

    const r = await askGemini<{ owner_phone: string | null }>(
      `PagesJaunes pour "${firstName} ${lastName}" à ${city}.\nTexte: ${text}\n
{ "owner_phone": "numéro de téléphone" ou null }
JSON uniquement.`
    ).catch(() => null);
    return r?.owner_phone ?? null;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("closed") || msg.includes("Protocol error")) throw e;
    return null;
  }
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Deep dirigeant researcher — text-based, no AI screenshots.
 *
 * 1. Owner name unknown → parallel Google + Facebook search
 * 2. Owner name known → Google (contact/LinkedIn), PagesJaunes (phone)
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
  };

  // ── PHASE 1: Discover owner name if not provided ────────────────────────
  if (!ownerName) {
    log(`[Dirigeant] No owner name — running discovery…`);

    // Run Google and Facebook searches for owner name
    const googleResult = await findOwnerViaGoogle(page, businessName, location, niche, log);
    if (googleResult.owner_name) {
      result.owner_name = googleResult.owner_name;
      result.owner_role = googleResult.owner_role;
      ownerName = googleResult.owner_name;
    } else {
      // Try Facebook as second source
      const fbResult = await findOwnerViaFacebook(page, businessName, location, log);
      if (fbResult.owner_name) {
        result.owner_name = fbResult.owner_name;
        ownerName = fbResult.owner_name;
      }
    }

    if (!ownerName) {
      log(`[Dirigeant] Owner name not found — skipping deep research`);
      return result;
    }
  }

  log(`[Dirigeant] Researching: ${ownerName}`);

  // ── PHASE 2: Deep contact research with the owner name ──────────────────
  const parts = ownerName.trim().split(/\s+/);
  const firstName = parts[0];
  const lastName = parts[parts.length - 1];

  // Google search for contact + LinkedIn info
  const googleContact = await searchOwnerOnGoogle(page, ownerName, businessName, location, log);
  result.owner_phone = result.owner_phone || googleContact.owner_phone;
  result.owner_email = result.owner_email || googleContact.owner_email;
  result.owner_role = result.owner_role || googleContact.owner_role;
  result.linkedin_url = result.linkedin_url || googleContact.linkedin_url;
  result.linkedin_summary = result.linkedin_summary || googleContact.linkedin_summary;

  // PagesJaunes white pages for personal phone (if not found yet)
  if (!result.owner_phone) {
    const wpPhone = await searchOwnerPhone(page, firstName, lastName, location, log);
    if (wpPhone) {
      result.owner_phone = wpPhone;
      log(`[Dirigeant] Phone from PagesJaunes: ${wpPhone}`);
    }
  }

  log(
    `[Dirigeant] ✓ ${ownerName}: phone=${result.owner_phone || "—"} email=${result.owner_email || "—"} linkedin=${result.linkedin_url ? "✓" : "—"} role=${result.owner_role || "—"}`
  );

  return result;
}
