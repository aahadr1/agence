import type { Page } from "playwright-core";
import {
  screenshotAndAsk,
  askGeminiText,
  safeGoto,
  normalizeUrl,
  randomDelay,
  dismissConsent,
} from "../browser";

export interface WebsiteFinderResult {
  has_website: boolean;
  website_url: string | null;
  found_via: "gmb" | "google_search" | "pages_jaunes" | "click_through" | "http_verify" | null;
  confidence: "high" | "medium" | "low";
}

const SOCIAL_AND_DIRECTORY_DOMAINS = [
  "facebook.com",
  "instagram.com",
  "twitter.com",
  "x.com",
  "linkedin.com",
  "yelp.com",
  "tripadvisor.com",
  "pagesjaunes.fr",
  "google.com",
  "google.fr",
  "gstatic.com",
  "maps.google",
  "googleusercontent.com",
  "lafourchette.com",
  "thefork.com",
  "booking.com",
  "airbnb.com",
  "just-eat.fr",
  "ubereats.com",
  "deliveroo.fr",
  "societe.com",
  "pappers.fr",
  "annuaire.gouv.fr",
  "wikipedia.org",
  "youtube.com",
  "tiktok.com",
  "pinterest.com",
];

function hostnameBlocked(hostname: string): boolean {
  const h = hostname.replace(/^www\./, "").toLowerCase();
  return SOCIAL_AND_DIRECTORY_DOMAINS.some((d) => h === d || h.endsWith("." + d));
}

function isRealWebsite(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url.startsWith("http") ? url : "https://" + url);
    const hostname = parsed.hostname.replace(/^www\./, "");
    return !hostnameBlocked(hostname);
  } catch {
    return false;
  }
}

/**
 * Google wraps almost all organic results as:
 *   https://www.google.com/url?q=https://example.com/&sa=...
 *   https://www.google.com/url?url=https://example.com/...
 * Without unwrapping, extractGoogleResultLinks() saw hostname "google.com" and skipped everything.
 */
function unwrapGoogleRedirect(href: string): string | null {
  const trimmed = href.trim();
  if (!trimmed.startsWith("http")) return null;

  try {
    const u = new URL(trimmed);
    const host = u.hostname.replace(/^www\./, "");

    if (host === "google.com" || host === "google.fr" || host.endsWith(".google.com")) {
      if (u.pathname === "/url" || u.pathname.startsWith("/url")) {
        const q = u.searchParams.get("q") || u.searchParams.get("url") || u.searchParams.get("u");
        if (q && /^https?:\/\//i.test(q)) return q;
        if (q && q.startsWith("/url?")) {
          /* nested — rare */
        }
      }
      // /imgres, /search — skip
      return null;
    }

    return trimmed;
  } catch {
    return null;
  }
}

function googleUrl(query: string): string {
  return `https://www.google.com/search?q=${encodeURIComponent(query)}&hl=fr&num=10`;
}

function city(location: string): string {
  return location.replace(/\d{5}/g, "").replace(/,.*$/, "").trim();
}

/** Normalise pour comparer titre de page et nom d'enseigne */
function normalizeForMatch(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9\s]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Si au moins 1 mot significatif du nom commerce apparaît dans le titre (ou l'inverse pour noms courts).
 */
function titleLikelyMatchesBusiness(pageTitle: string, businessName: string): boolean {
  const title = normalizeForMatch(pageTitle);
  const name = normalizeForMatch(businessName);
  const words = name.split(" ").filter((w) => w.length > 2);
  if (words.length === 0) return false;
  const hits = words.filter((w) => title.includes(w));
  if (hits.length >= 2) return true;
  if (hits.length === 1 && words.length === 1) return true;
  if (hits.length === 1 && name.length >= 8) return true;
  if (title.length > 0 && name.length > 5 && title.includes(name.slice(0, Math.min(12, name.length))))
    return true;
  return false;
}

async function quickAlive(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      signal: AbortSignal.timeout(6000),
      headers: { "User-Agent": "Mozilla/5.0 (compatible; LeadAgent/2.0)" },
    });
    if (res.ok) return true;
    const res2 = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: AbortSignal.timeout(8000),
      headers: { "User-Agent": "Mozilla/5.0 (compatible; LeadAgent/2.0)" },
    });
    return res2.ok;
  } catch {
    return false;
  }
}

/**
 * Extrait les URLs réelles des résultats Google (déballage /url?q=...).
 * Cible surtout #rso et les h3 > a (résultats organiques).
 */
async function extractGoogleResultLinks(page: Page): Promise<string[]> {
  try {
    return await page.evaluate((blockedList) => {
      const blocked = (host: string) => {
        const h = host.replace(/^www\./, "").toLowerCase();
        return (blockedList as string[]).some((d) => h === d || h.endsWith("." + d));
      };

      const seen = new Set<string>();
      const out: string[] = [];

      const tryAdd = (raw: string | null | undefined) => {
        if (!raw || !raw.startsWith("http")) return;

        let finalUrl = raw;
        try {
          const u = new URL(raw);
          const host = u.hostname.replace(/^www\./, "");
          if (host === "google.com" || host === "google.fr" || host.endsWith(".google.com")) {
            if (u.pathname === "/url" || u.pathname.startsWith("/url")) {
              const inner =
                u.searchParams.get("q") || u.searchParams.get("url") || u.searchParams.get("u");
              if (inner && /^https?:\/\//i.test(inner)) finalUrl = inner;
              else return;
            } else {
              return;
            }
          }
        } catch {
          return;
        }

        try {
          const u2 = new URL(finalUrl);
          const h2 = u2.hostname.replace(/^www\./, "");
          if (blocked(h2)) return;
          if (!seen.has(finalUrl)) {
            seen.add(finalUrl);
            out.push(finalUrl);
          }
        } catch {
          /* */
        }
      };

      // Résultats organiques classiques
      const selectors = [
        "#rso a[href]",
        "#search a[href]",
        "div[data-sokoban-container] a[href]",
        "div.g a[href]",
        "a[jsname][href]",
      ];
      const anchors = new Set<HTMLAnchorElement>();
      for (const sel of selectors) {
        document.querySelectorAll<HTMLAnchorElement>(sel).forEach((a) => anchors.add(a));
      }

      for (const a of anchors) {
        tryAdd(a.href);
        if (out.length >= 20) break;
      }

      return out;
    }, SOCIAL_AND_DIRECTORY_DOMAINS);
  } catch {
    return [];
  }
}

async function isThisTheirWebsite(
  page: Page,
  businessName: string,
  location: string
): Promise<{ match: boolean; confidence: "high" | "medium" | "low" }> {
  try {
    return await screenshotAndAsk<{ match: boolean; confidence: "high" | "medium" | "low" }>(
      page,
      `You are looking at a webpage. We need to know if this is the OFFICIAL website of the business "${businessName}" in ${location} (same brand / same establishment).

Return JSON only:
{
  "match": true if this page is clearly that business's own site (logo, name, address, or activity matches). true even if the design is simple.
  "match": false only if it is clearly a different company, a generic directory, a social network profile, an error page, or unrelated content.
  "confidence": "high" | "medium" | "low"
}

Be generous: local shops often use simple sites; if the business name or brand appears on the page, prefer match: true.
Return JSON only.`
    );
  } catch {
    return { match: false, confidence: "low" };
  }
}

/**
 * Gemini lit l'URL depuis la capture d'écran + contexte texte (double vérification).
 */
async function extractWebsiteFromSerpWithAI(
  businessName: string,
  city: string,
  candidateUrls: string[]
): Promise<string | null> {
  if (candidateUrls.length === 0) return null;
  const list = candidateUrls.slice(0, 15).join("\n");
  const prompt = `Business: "${businessName}" in ${city}.
Below are URLs taken from Google search result links (already filtered to exclude Facebook, Google Maps, directories).

Which URL is most likely the OFFICIAL website of THIS exact business?
If none is clearly their site, return null.

URLs:
${list}

Return JSON only: { "website_url": "https://..." or null, "reason": "one short phrase" }`;

  try {
    const raw = await askGeminiText(prompt);
    const cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    const objStart = cleaned.indexOf("{");
    const jsonSlice = objStart >= 0 ? cleaned.slice(objStart) : cleaned;
    const parsed = JSON.parse(jsonSlice) as { website_url?: string | null };
    const u = parsed.website_url?.trim();
    if (!u || !isRealWebsite(u)) return null;

    const normalized = normalizeUrl(u) || u;
    let origin: string;
    try {
      origin = new URL(normalized).origin;
    } catch {
      return null;
    }
    const fromSerp = candidateUrls.some((c) => {
      try {
        return new URL(c).origin === origin;
      } catch {
        return false;
      }
    });
    if (!fromSerp) return null;

    if (await quickAlive(normalized)) return normalized;
  } catch {
    /* */
  }
  return null;
}

/**
 * 1. GMB: si l'URL charge et n'est pas un réseau social → on fait confiance (Maps est la source).
 * 2. Google: déballage /url?q= + extraction #rso.
 * 3. IA sur liste d'URLs candidates + navigation + vision (match sans exiger confidence !== low).
 * 4. Secours: titre de page ~ nom commerce.
 */
export async function findWebsite(
  page: Page,
  businessName: string,
  location: string,
  gmbWebsiteUrl: string | null,
  log: (msg: string) => void
): Promise<WebsiteFinderResult> {
  const c = city(location);

  // ── Step 1: GMB — confiance si la page charge (évite faux négatifs vision) ──
  if (gmbWebsiteUrl && isRealWebsite(gmbWebsiteUrl)) {
    const normalizedGmb = normalizeUrl(gmbWebsiteUrl) || gmbWebsiteUrl;
    log(`[WebFinder] GMB website: ${normalizedGmb} — loading...`);
    try {
      const ok = await safeGoto(page, normalizedGmb, log, 15000);
      if (ok) {
        const currentUrl = page.url();
        if (isRealWebsite(currentUrl)) {
          const alive = await quickAlive(normalizeUrl(currentUrl) || currentUrl);
          if (alive) {
            const vision = await isThisTheirWebsite(page, businessName, location);
            if (vision.match) {
              log(`[WebFinder] ✓ GMB confirmed (vision): ${currentUrl}`);
              return {
                has_website: true,
                website_url: normalizeUrl(currentUrl) || normalizedGmb,
                found_via: "gmb",
                confidence: vision.confidence,
              };
            }
            let pageTitle = "";
            try {
              pageTitle = (await page.title()) || "";
            } catch {
              /* */
            }
            if (titleLikelyMatchesBusiness(pageTitle, businessName)) {
              log(`[WebFinder] ✓ GMB kept (title matches): ${currentUrl}`);
              return {
                has_website: true,
                website_url: normalizeUrl(currentUrl) || normalizedGmb,
                found_via: "gmb",
                confidence: "medium",
              };
            }
            // Maps pointe souvent vers le bon domaine même si la vision hésite
            log(`[WebFinder] ✓ GMB kept (loaded OK, trust Maps): ${currentUrl}`);
            return {
              has_website: true,
              website_url: normalizeUrl(currentUrl) || normalizedGmb,
              found_via: "gmb",
              confidence: "medium",
            };
          }
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("closed") || msg.includes("Protocol error")) throw e;
      log(`[WebFinder] GMB load error: ${msg.slice(0, 80)}`);
    }
  }

  const queries = [
    `"${businessName}" ${c} site officiel`,
    `"${businessName}" ${c} site web`,
    `${businessName} ${c}`,
    `"${businessName}" ${c} contact`,
  ];

  let totalNavigations = 0;
  const MAX_NAVIGATIONS = 12;

  for (const query of queries) {
    if (totalNavigations >= MAX_NAVIGATIONS) break;

    log(`[WebFinder] Searching: "${query}"`);

    try {
      const ok = await safeGoto(page, googleUrl(query), log);
      if (!ok) continue;

      await dismissConsent(page);
      await randomDelay(1200, 2000);

      const links = await extractGoogleResultLinks(page);
      log(`[WebFinder] ${links.length} organic URLs after unwrap (query: "${query.slice(0, 40)}...")`);

      // IA choisit une URL dans la liste (sans dépendre du screenshot seul)
      const aiPick = await extractWebsiteFromSerpWithAI(businessName, c, links);
      if (aiPick) {
        log(`[WebFinder] ✓ AI picked from link list: ${aiPick}`);
        return {
          has_website: true,
          website_url: aiPick,
          found_via: "google_search",
          confidence: "high",
        };
      }

      // Vision sur la SERP (filet de sécurité)
      try {
        const serpResult = await screenshotAndAsk<{
          has_real_website: boolean;
          website_url: string | null;
        }>(
          page,
          `Google results for "${businessName}" in ${c}. Find the official business website URL (own domain, not Facebook, not PagesJaunes, not Google).

JSON only:
{ "has_real_website": true/false, "website_url": "https://..." or null }`
        );

        if (serpResult.website_url && isRealWebsite(serpResult.website_url)) {
          const n = normalizeUrl(serpResult.website_url);
          if (n && (await quickAlive(n))) {
            log(`[WebFinder] ✓ SERP vision URL: ${n}`);
            return {
              has_website: true,
              website_url: n,
              found_via: "google_search",
              confidence: serpResult.has_real_website ? "medium" : "low",
            };
          }
        }
      } catch {
        /* */
      }

      for (const link of links) {
        if (totalNavigations >= MAX_NAVIGATIONS) break;
        totalNavigations++;

        try {
          log(`[WebFinder] Visit #${totalNavigations}: ${link.slice(0, 72)}`);
          const navOk = await safeGoto(page, link, log, 14000);
          if (!navOk) continue;

          await randomDelay(400, 900);

          const currentUrl = page.url();
          if (!isRealWebsite(currentUrl)) continue;

          const check = await isThisTheirWebsite(page, businessName, location);
          // Toute confirmation match compte (plus d'exclusion "low")
          if (check.match) {
            const finalUrl = normalizeUrl(currentUrl) || link;
            log(`[WebFinder] ✓ Match (${check.confidence}): ${finalUrl}`);
            return {
              has_website: true,
              website_url: finalUrl,
              found_via: "click_through",
              confidence: check.confidence,
            };
          }

          let pageTitle = "";
          try {
            pageTitle = (await page.title()) || "";
          } catch {
            /* */
          }
          if (titleLikelyMatchesBusiness(pageTitle, businessName)) {
            const finalUrl = normalizeUrl(currentUrl) || link;
            log(`[WebFinder] ✓ Title heuristic match: ${finalUrl}`);
            return {
              has_website: true,
              website_url: finalUrl,
              found_via: "click_through",
              confidence: "medium",
            };
          }

          await randomDelay(200, 500);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          if (msg.includes("closed") || msg.includes("Protocol error")) throw e;
          log(`[WebFinder] ✗ ${msg.slice(0, 55)}`);
        }
      }

      await randomDelay(1000, 1800);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("closed") || msg.includes("Protocol error")) throw e;
      log(`[WebFinder] ✗ Query error: ${msg.slice(0, 80)}`);
    }
  }

  log(`[WebFinder] No website for "${businessName}" after ${totalNavigations} visits`);
  return {
    has_website: false,
    website_url: null,
    found_via: null,
    confidence: "high",
  };
}
