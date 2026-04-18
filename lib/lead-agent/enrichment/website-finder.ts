import type { Page } from "playwright-core";
import {
  safeGoto,
  normalizeUrl,
  randomDelay,
  dismissConsent,
  diagnosePageAccess,
  type PageAccessDiagnostics,
} from "../browser";
import {
  type WebsiteType,
  type PlatformDef,
  PLATFORM_REGISTRY,
  classifyUrl,
} from "../../platform-registry";

export type { WebsiteType, PlatformDef };
export { PLATFORM_REGISTRY, classifyUrl };

/** Priority for showing "best platform" when no owned site found (higher = prefer showing) */
const PLATFORM_PRIORITY: Record<string, number> = {
  planity: 10,
  treatwell: 10,
  doctolib: 10,
  booking: 9,
  thefork: 9,
  facebook_page: 7,
  instagram_page: 6,
  tripadvisor: 5,
  pagesjaunes: 4,
  directory: 3,
  google_maps: 2,
};

// ─────────────────────────────────────────────────────────────────────────────
// Result type
// ─────────────────────────────────────────────────────────────────────────────

export interface WebsiteFinderResult {
  /** true only if an OWNED domain was confirmed */
  has_website: boolean;
  /** Owned website URL, or null */
  website_url: string | null;
  /** Classification of what was found */
  website_type: WebsiteType;
  /** URL of the best platform page found (Planity, Facebook, etc.) if no owned site */
  platform_url: string | null;
  /** Human-readable label for platform_url */
  platform_label: string | null;
  found_via: "gmb" | "google_search" | "click_through" | null;
  confidence: "high" | "medium" | "low";
  /** Same semantics as `web_fetch` when Google SERP is unreadable. */
  credential_required?: boolean;
  page_access?: PageAccessDiagnostics;
  suggested_user_action_fr?: string | null;
  credential_hostname?: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function googleSearchUrl(query: string): string {
  return `https://www.google.fr/search?q=${encodeURIComponent(query)}&hl=fr&num=10&gl=fr`;
}

function cityFromLocation(location: string): string {
  return location
    .replace(/\d{5}/g, "")
    .replace(/,.*$/, "")
    .trim();
}

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
 * Returns true if the URL's domain name contains at least one significant word
 * from the business name (words > 3 chars). A quick pre-filter before navigation.
 */
function domainMatchesBusiness(url: string, businessName: string): boolean {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
    const domainBase = hostname.split(".")[0]; // "lebarbierdenancy" from lebarbierdenancy.fr
    const businessWords = normalizeForMatch(businessName)
      .split(" ")
      .filter((w) => w.length > 3);
    if (businessWords.length === 0) return false;
    const hits = businessWords.filter((w) => domainBase.includes(w));
    return hits.length >= 1; // even one significant word is a strong signal
  } catch {
    return false;
  }
}

function titleMatchesBusiness(pageTitle: string, businessName: string): boolean {
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
    const r1 = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      signal: AbortSignal.timeout(6000),
      headers: { "User-Agent": "Mozilla/5.0 (compatible; LeadAgent/2.0)" },
    });
    if (r1.ok) return true;
    const r2 = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: AbortSignal.timeout(9000),
      headers: { "User-Agent": "Mozilla/5.0 (compatible; LeadAgent/2.0)" },
    });
    return r2.ok;
  } catch {
    return false;
  }
}

interface SerpResult {
  url: string;
  title: string; // page title from SERP snippet — free, no navigation needed
}

/**
 * Extract organic Google result URLs + titles from the current SERP page.
 * Having the title lets us match the business name without ever navigating.
 */
async function extractSerpResults(page: Page, limit = 10): Promise<SerpResult[]> {
  try {
    return await page.evaluate((lim) => {
      const seen = new Set<string>();
      const out: { url: string; title: string }[] = [];

      function unwrapGoogleUrl(raw: string): string | null {
        if (!raw || !raw.startsWith("http")) return null;
        try {
          const u = new URL(raw);
          const host = u.hostname.replace(/^www\./, "");
          if (host === "google.com" || host === "google.fr" ||
              host.endsWith(".google.com") || host.endsWith(".google.fr")) {
            if (u.pathname.startsWith("/url")) {
              const inner = u.searchParams.get("q") || u.searchParams.get("url") || u.searchParams.get("u");
              return inner && /^https?:\/\//i.test(inner) ? inner : null;
            }
            return null; // skip google.com/search etc.
          }
          return raw;
        } catch {
          return null;
        }
      }

      // Walk every organic result block — try to keep url + title together
      const resultBlocks = [
        ...Array.from(document.querySelectorAll("div.g")),
        ...Array.from(document.querySelectorAll("div[data-sokoban-container]")),
        ...Array.from(document.querySelectorAll('[jscontroller][data-hveid]')),
      ];

      for (const block of resultBlocks) {
        if (out.length >= lim) break;
        const anchor = block.querySelector<HTMLAnchorElement>("a[href]");
        if (!anchor) continue;
        const url = unwrapGoogleUrl(anchor.href);
        if (!url || seen.has(url)) continue;
        const h3 = block.querySelector("h3");
        const title = h3?.textContent?.trim() || "";
        seen.add(url);
        out.push({ url, title });
      }

      // Fallback: grab any visible anchor + look for sibling h3
      if (out.length < 3) {
        const fallbackSelectors = ["#rso a[href]", "#search a[href]", "a[jsname][href]"];
        for (const sel of fallbackSelectors) {
          document.querySelectorAll<HTMLAnchorElement>(sel).forEach((a) => {
            if (out.length >= lim) return;
            const url = unwrapGoogleUrl(a.href);
            if (!url || seen.has(url)) return;
            const title = (a.closest("div")?.querySelector("h3")?.textContent || a.textContent || "").trim();
            seen.add(url);
            out.push({ url, title });
          });
          if (out.length >= 3) break;
        }
      }

      return out;
    }, limit);
  } catch {
    return [];
  }
}

/**
 * Verify a candidate URL belongs to the business.
 *
 * FAST path (no browser navigation):
 *  - SERP title matches business name
 *  - Domain name contains business words
 *
 * MEDIUM path (one navigation, no screenshot):
 *  - Navigate to URL, check <title> tag
 *
 * NO AI screenshots in the main SERP loop — they're too slow (10-20s each)
 * and cause 504 timeouts on Vercel. Title + domain matching is 99% accurate
 * for local French businesses.
 */
async function verifyOwnedWebsite(
  page: Page,
  url: string,
  businessName: string,
  _location: string,
  log: (msg: string) => void,
  serpTitle?: string
): Promise<string | null> {
  try {
    // ── Pre-check: SERP title already confirms it ──────────────────────────
    if (serpTitle && titleMatchesBusiness(serpTitle, businessName)) {
      log(`[WebFinder] ✅ SERP title match (no nav): ${url.slice(0, 60)}`);
      return normalizeUrl(url) || url;
    }

    // ── Pre-check: domain name contains business words ─────────────────────
    if (domainMatchesBusiness(url, businessName)) {
      log(`[WebFinder] ✅ Domain match (no nav): ${url.slice(0, 60)}`);
      return normalizeUrl(url) || url;
    }

    // ── Navigate and check page title ──────────────────────────────────────
    const ok = await safeGoto(page, url, log, 12000);
    if (!ok) return null;

    const currentUrl = page.url();
    if (classifyUrl(currentUrl) !== null) return null;

    try {
      const title = await page.title();
      if (titleMatchesBusiness(title, businessName)) {
        log(`[WebFinder] ✅ Title match: "${title.slice(0, 50)}" → ${currentUrl.slice(0, 60)}`);
        return normalizeUrl(currentUrl) || url;
      }
    } catch { /* ignore */ }

    // Domain check on final URL (after redirects)
    if (domainMatchesBusiness(currentUrl, businessName)) {
      log(`[WebFinder] ✅ Domain match (after redirect): ${currentUrl.slice(0, 60)}`);
      return normalizeUrl(currentUrl) || url;
    }

    return null;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes("closed") || msg.includes("Protocol error")) throw e;
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main export
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Thorough website finder for a single business.
 *
 * Strategy:
 * 1. GMB / previously-found URL → verify immediately
 * 2. Three Google search query variations × 10 links = up to 30 candidates
 *    - For each link, classify first (instant, no browser navigation):
 *      • Known platform (Planity, Facebook, etc.) → record contextually, skip navigation
 *      • Unknown domain → queue for Playwright + AI verification
 * 3. Only marks "no website" after exhausting all 30 candidates
 * 4. Returns rich result: website_type + platform_url for UI display
 */
export async function findWebsite(
  page: Page,
  businessName: string,
  location: string,
  gmbWebsiteUrl: string | null,
  log: (msg: string) => void,
  /** Direct Google Maps URL for this business — used to re-scrape GMB if gmbWebsiteUrl is missing */
  googleMapsUrl?: string | null
): Promise<WebsiteFinderResult> {
  const city = cityFromLocation(location);

  // Track the best platform page encountered (shown in UI when no owned site found)
  type PlatformEntry = {
    type: Exclude<WebsiteType, "own_domain" | null>;
    label: string;
    url: string;
  };
  let bestPlatform: PlatformEntry | null = null;

  const considerPlatform = (url: string) => {
    const classification = classifyUrl(url);
    if (!classification) return;
    const incoming = PLATFORM_PRIORITY[classification.type] ?? 0;
    const current = bestPlatform ? (PLATFORM_PRIORITY[bestPlatform.type] ?? 0) : -1;
    if (incoming > current) {
      bestPlatform = { type: classification.type, label: classification.label, url } satisfies PlatformEntry;
    }
  };

  // ── STEP 0: Re-scrape Google Maps directly if we have no website URL yet ───
  // This is free (direct URL navigation) and avoids 3 Google searches entirely.
  // Maps is the most authoritative source — we just may have missed it during discovery.
  if (!gmbWebsiteUrl && googleMapsUrl) {
    log(`[WebFinder] No GMB website saved — re-scraping Maps page…`);
    try {
      const ok = await safeGoto(page, googleMapsUrl, log, 15000);
      if (ok) {
        // Wait for the website section to render (it loads last in the Maps panel)
        await page
          .waitForSelector(
            'a[data-item-id="authority"], a[data-item-id^="authority:"], a[aria-label*="site web" i], a[aria-label*="website" i]',
            { timeout: 8000 }
          )
          .catch(() => {});
        await page.waitForTimeout(800);

        const found = await page.evaluate((): string[] => {
          const skipHosts = ["google.", "gstatic.", "schema.org", "facebook.", "instagram.", "twitter.", "linkedin.", "youtube.", "tiktok."];
          const out: string[] = [];
          const addHref = (href: string | null | undefined) => {
            if (!href || !/^https?:\/\//i.test(href)) return;
            if (skipHosts.some((h) => href.includes(h))) return;
            if (!out.includes(href)) out.push(href);
          };
          // Priority selectors
          for (const sel of ['a[data-item-id="authority"]', 'a[data-item-id^="authority:"]']) {
            document.querySelectorAll<HTMLAnchorElement>(sel).forEach((a) => addHref(a.href));
          }
          // aria-label
          const kws = ["site web", "website", "ouvrir le site", "visiter le site"];
          document.querySelectorAll<HTMLAnchorElement>("a[href]").forEach((a) => {
            const label = (a.getAttribute("aria-label") || "").toLowerCase();
            if (kws.some((k) => label.includes(k))) addHref(a.href);
          });
          // Fallback: any external link in the panel
          const main = document.querySelector('[role="main"]') || document.body;
          main.querySelectorAll<HTMLAnchorElement>('a[href^="http"]').forEach((a) => addHref(a.href));
          return out;
        });

        // Prefer the first non-platform URL
        const ownedFromMaps = found.find((u) => classifyUrl(u) === null) ?? null;
        const platformFromMaps = found.find((u) => classifyUrl(u) !== null) ?? null;

        if (ownedFromMaps) {
          const normalized = normalizeUrl(ownedFromMaps) || ownedFromMaps;
          const alive = await quickAlive(normalized);
          if (alive) {
            log(`[WebFinder] ✅ Re-scraped Maps → owned URL: ${normalized.slice(0, 60)}`);
            return {
              has_website: true,
              website_url: normalized,
              website_type: "own_domain",
              platform_url: null,
              platform_label: null,
              found_via: "gmb",
              confidence: "high",
            };
          }
        }
        if (platformFromMaps) {
          const cl = classifyUrl(platformFromMaps)!;
          considerPlatform(platformFromMaps);
          log(`[WebFinder] Maps only has platform: ${cl.label}`);
          // don't return yet — continue to Google search for owned domain
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("closed") || msg.includes("Protocol error")) throw e;
      log(`[WebFinder] Maps re-scrape failed: ${msg.slice(0, 60)}`);
    }
  }

  // ── STEP 1: GMB / previously saved URL ─────────────────────────────────────
  // Google Maps explicitly surfaces this URL as the business's website.
  // We trust it as long as (a) it's not a known platform, (b) it responds to HTTP.
  // No AI screenshot needed — GMB is authoritative.
  if (gmbWebsiteUrl) {
    const platform = classifyUrl(gmbWebsiteUrl);
    if (platform) {
      considerPlatform(gmbWebsiteUrl);
      log(`[WebFinder] GMB → platform detected: ${platform.label}`);
      // Keep searching for an owned domain
    } else {
      const normalized = normalizeUrl(gmbWebsiteUrl) || gmbWebsiteUrl;
      log(`[WebFinder] GMB link: ${normalized.slice(0, 60)} — HTTP check…`);
      const alive = await quickAlive(normalized);
      if (alive) {
        log(`[WebFinder] ✅ GMB URL alive — accepted: ${normalized.slice(0, 60)}`);
        return {
          has_website: true,
          website_url: normalized,
          website_type: "own_domain",
          platform_url: null,
          platform_label: null,
          found_via: "gmb",
          confidence: "high",
        };
      }
      log(`[WebFinder] GMB URL not responding — will search Google`);
    }
  }

  // ── STEP 2: Google search — 2 queries, fast title/domain matching ─────────
  // Most businesses are found in the first query. The second is a backup.
  // No AI screenshots — only title/domain heuristics + HTTP alive.

  const queries = [
    `${businessName} ${city}`,
    `"${businessName}" ${city} site officiel`,
  ];

  const LINKS_PER_QUERY = 10;
  const visitedDomains = new Set<string>();
  let ownedDomainVisits = 0;
  const MAX_OWNED_VISITS = 5; // max Playwright navigations (title/domain fast-paths don't count)

  for (const query of queries) {
    log(`[WebFinder] 🔍 Query: "${query}"`);

    try {
      const ok = await safeGoto(page, googleSearchUrl(query), log);
      if (!ok) {
        log(`[WebFinder] ⚠️ Could not load SERP for "${query}"`);
        continue;
      }

      const serpDiag = await diagnosePageAccess(page);
      if (serpDiag.captcha || serpDiag.login_wall) {
        log(
          `[WebFinder] SERP blocked (${serpDiag.captcha ? "captcha" : "login"}) — stop`,
        );
        return {
          has_website: false,
          website_url: null,
          website_type: null,
          platform_url:
            (bestPlatform as { url: string; label: string } | null)?.url ??
            null,
          platform_label:
            (bestPlatform as { url: string; label: string } | null)?.label ??
            null,
          found_via: null,
          confidence: "low",
          credential_required: serpDiag.login_wall,
          page_access: serpDiag,
          suggested_user_action_fr: serpDiag.suggested_action_fr,
          credential_hostname: serpDiag.credential_hostname,
        };
      }

      await dismissConsent(page);
      await randomDelay(800, 1400);

      const results = await extractSerpResults(page, LINKS_PER_QUERY);
      log(`[WebFinder] ${results.length} SERP results found`);

      for (const result of results) {
        const { url: link, title: serpTitle } = result;
        const platform = classifyUrl(link);

        if (platform) {
          considerPlatform(link);
          log(`[WebFinder] 📍 Platform: ${platform.label} — ${link.slice(0, 55)}`);
          continue;
        }

        // ── Owned domain candidate ──
        let domain: string;
        try {
          domain = new URL(link).hostname;
        } catch {
          continue;
        }

        if (visitedDomains.has(domain)) continue;
        if (ownedDomainVisits >= MAX_OWNED_VISITS) continue;

        visitedDomains.add(domain);
        ownedDomainVisits++;

        log(`[WebFinder] 🌐 Check #${ownedDomainVisits}: ${link.slice(0, 65)} | SERP title: "${serpTitle.slice(0, 40)}"`);

        // Fast path: SERP title already matches → just HTTP check (no Playwright navigation)
        if (serpTitle && titleMatchesBusiness(serpTitle, businessName)) {
          const alive = await quickAlive(link);
          if (alive) {
            log(`[WebFinder] ✅ SERP title match + alive: ${link.slice(0, 60)}`);
            const bp = bestPlatform as PlatformEntry | null;
            return {
              has_website: true,
              website_url: normalizeUrl(link) || link,
              website_type: "own_domain",
              platform_url: bp?.url ?? null,
              platform_label: bp?.label ?? null,
              found_via: "google_search",
              confidence: "high",
            };
          }
          log(`[WebFinder] ❌ Title matched but URL unreachable`);
          continue;
        }

        // Fast path: domain name clearly contains business name → HTTP check only
        if (domainMatchesBusiness(link, businessName)) {
          const alive = await quickAlive(link);
          if (alive) {
            log(`[WebFinder] ✅ Domain heuristic match + alive: ${link.slice(0, 60)}`);
            const bp = bestPlatform as PlatformEntry | null;
            return {
              has_website: true,
              website_url: normalizeUrl(link) || link,
              website_type: "own_domain",
              platform_url: bp?.url ?? null,
              platform_label: bp?.label ?? null,
              found_via: "google_search",
              confidence: "high",
            };
          }
          continue;
        }

        // Slow path: HTTP check + navigate + title/AI verification
        const alive = await quickAlive(link);
        if (!alive) {
          log(`[WebFinder] ❌ Unreachable: ${link.slice(0, 50)}`);
          continue;
        }

        const confirmed = await verifyOwnedWebsite(page, link, businessName, location, log, serpTitle);
        if (confirmed) {
          const bp = bestPlatform as PlatformEntry | null;
          return {
            has_website: true,
            website_url: confirmed,
            website_type: "own_domain",
            platform_url: bp?.url ?? null,
            platform_label: bp?.label ?? null,
            found_via: "click_through",
            confidence: "high",
          };
        }
      }

      await randomDelay(600, 1200);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("closed") || msg.includes("Protocol error")) throw e;
      log(`[WebFinder] ⚠️ Query error: ${msg.slice(0, 80)}`);
    }
  }

  // ── No owned domain found after all 30 candidates ──────────────────────────
  const bp = bestPlatform as PlatformEntry | null;
  if (bp) {
    log(
      `[WebFinder] ⚠️ No owned site found — best platform: ${bp.label} (${bp.url.slice(0, 50)})`
    );
    return {
      has_website: false,
      website_url: null,
      website_type: bp.type,
      platform_url: bp.url,
      platform_label: bp.label,
      found_via: "google_search",
      confidence: "medium",
    };
  }

  log(
    `[WebFinder] ❌ No website for "${businessName}" after checking ${ownedDomainVisits} domains across 3 queries`
  );
  return {
    has_website: false,
    website_url: null,
    website_type: null,
    platform_url: null,
    platform_label: null,
    found_via: null,
    confidence: "high",
  };
}
