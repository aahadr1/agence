import type { Page } from "playwright-core";
import {
  screenshotAndAsk,
  safeGoto,
  normalizeUrl,
  randomDelay,
  dismissConsent,
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

/**
 * Extract organic Google result URLs from the current SERP page.
 * Unwraps google.com/url?q= redirects and returns raw destination URLs.
 */
async function extractSerpLinks(page: Page, limit = 10): Promise<string[]> {
  try {
    return await page.evaluate((lim) => {
      const seen = new Set<string>();
      const out: string[] = [];

      const tryAdd = (raw: string | null | undefined) => {
        if (!raw || !raw.startsWith("http") || out.length >= lim) return;

        let finalUrl = raw;
        try {
          const u = new URL(raw);
          const host = u.hostname.replace(/^www\./, "");
          if (
            host === "google.com" ||
            host === "google.fr" ||
            host.endsWith(".google.com") ||
            host.endsWith(".google.fr")
          ) {
            if (u.pathname.startsWith("/url")) {
              const inner =
                u.searchParams.get("q") ||
                u.searchParams.get("url") ||
                u.searchParams.get("u");
              if (inner && /^https?:\/\//i.test(inner)) {
                finalUrl = inner;
              } else {
                return; // can't unwrap
              }
            } else {
              return; // /maps, /search, /images, etc.
            }
          }
        } catch {
          return;
        }

        if (!seen.has(finalUrl)) {
          seen.add(finalUrl);
          out.push(finalUrl);
        }
      };

      // Multiple selector strategies to handle SERP layout changes
      const selectors = [
        "#rso a[href]",
        "#search a[href]",
        "div.g a[href]",
        "div[data-sokoban-container] a[href]",
        "a[jsname][href]",
        "h3 ~ a[href]",
        "[data-ved] a[href]",
      ];

      const anchors = new Set<HTMLAnchorElement>();
      for (const sel of selectors) {
        document.querySelectorAll<HTMLAnchorElement>(sel).forEach((a) => anchors.add(a));
      }

      for (const a of anchors) {
        tryAdd(a.href);
        if (out.length >= lim) break;
      }

      return out;
    }, limit);
  } catch {
    return [];
  }
}

/**
 * Navigate to a candidate owned-domain URL and ask Gemini if it's the business's official site.
 * Returns the confirmed URL on success, null on failure.
 */
async function verifyOwnedWebsite(
  page: Page,
  url: string,
  businessName: string,
  location: string,
  log: (msg: string) => void
): Promise<string | null> {
  try {
    const ok = await safeGoto(page, url, log, 14000);
    if (!ok) return null;

    const currentUrl = page.url();

    // If we got redirected to a known platform → not owned
    if (classifyUrl(currentUrl) !== null) return null;

    await randomDelay(400, 800);

    // AI vision verification
    try {
      const result = await screenshotAndAsk<{ match: boolean; confidence: string }>(
        page,
        `You are looking at a webpage. Is this the OFFICIAL website of the business named "${businessName}" (located in ${location})?

Rules:
- Return match: true if the business name or brand clearly appears on the page (logo, title, address, service description).
- Be generous: small French businesses often have simple sites. If the name appears anywhere, prefer true.
- Return match: false only if it is clearly a different company, a generic directory, a social network profile, an error page, a domain for sale, or completely unrelated content.

Return JSON only:
{ "match": true or false, "confidence": "high" | "medium" | "low" }`
      );
      if (result.match) {
        log(`[WebFinder] ✅ AI confirmed: ${currentUrl.slice(0, 60)}`);
        return normalizeUrl(currentUrl) || url;
      }
    } catch {
      // AI failed → fall back to title heuristic
      try {
        const title = await page.title();
        if (titleMatchesBusiness(title, businessName)) {
          log(`[WebFinder] ✅ Title match: ${currentUrl.slice(0, 60)}`);
          return normalizeUrl(currentUrl) || url;
        }
      } catch {
        /* ignore */
      }
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
  log: (msg: string) => void
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

  // ── STEP 1: GMB / previously saved URL ─────────────────────────────────────
  if (gmbWebsiteUrl) {
    const platform = classifyUrl(gmbWebsiteUrl);
    if (platform) {
      considerPlatform(gmbWebsiteUrl);
      log(`[WebFinder] GMB → platform detected: ${platform.label}`);
      // Don't return yet — continue searching for an owned domain
    } else {
      const normalized = normalizeUrl(gmbWebsiteUrl) || gmbWebsiteUrl;
      log(`[WebFinder] GMB link: ${normalized.slice(0, 60)} — verifying…`);
      const confirmed = await verifyOwnedWebsite(page, normalized, businessName, location, log);
      if (confirmed) {
        return {
          has_website: true,
          website_url: confirmed,
          website_type: "own_domain",
          platform_url: null,
          platform_label: null,
          found_via: "gmb",
          confidence: "high",
        };
      }
    }
  }

  // ── STEP 2: Three Google search variations × 10 links ──────────────────────

  const queries = [
    `${businessName} ${city}`,
    `"${businessName}" ${city} site web`,
    `${businessName} ${city} contact`,
  ];

  const LINKS_PER_QUERY = 10; // 3 × 10 = 30 total candidates
  const visitedDomains = new Set<string>(); // avoid visiting same domain twice
  let ownedDomainVisits = 0;
  const MAX_OWNED_VISITS = 15; // AI verifications budget

  for (const query of queries) {
    log(`[WebFinder] 🔍 Query: "${query}"`);

    try {
      const ok = await safeGoto(page, googleSearchUrl(query), log);
      if (!ok) {
        log(`[WebFinder] ⚠️ Could not load SERP for "${query}"`);
        continue;
      }

      await dismissConsent(page);
      await randomDelay(1000, 1700);

      const links = await extractSerpLinks(page, LINKS_PER_QUERY);
      log(`[WebFinder] ${links.length} links found`);

      for (const link of links) {
        const platform = classifyUrl(link);

        if (platform) {
          // ── Platform page (Facebook, Planity, TripAdvisor, etc.) ──
          // Record it contextually but don't navigate — no need to open browser
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

        if (visitedDomains.has(domain)) continue; // already checked this domain
        if (ownedDomainVisits >= MAX_OWNED_VISITS) continue; // budget exhausted

        visitedDomains.add(domain);
        ownedDomainVisits++;

        log(`[WebFinder] 🌐 Check #${ownedDomainVisits}: ${link.slice(0, 65)}`);

        // Quick HTTP check first (cheap, no browser navigation)
        const alive = await quickAlive(link);
        if (!alive) {
          log(`[WebFinder] ❌ Unreachable: ${link.slice(0, 50)}`);
          continue;
        }

        // Full Playwright + AI verification
        const confirmed = await verifyOwnedWebsite(page, link, businessName, location, log);
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

      await randomDelay(700, 1400);
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
