import type { Page } from "playwright-core";
import { normalizeUrl, randomDelay, dismissConsent } from "../browser";
import { classifyUrl } from "../../platform-registry";

export interface MapsLead {
  business_name: string;
  description: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  rating: string | null;
  review_count: string | null;
  review_highlights: string[];
  has_website: boolean;
  website_url: string | null;
  google_maps_url: string | null;
}

// ---------------------------------------------------------------------------
// DOM-based detail extraction (no Gemini call needed)
// ---------------------------------------------------------------------------

interface DetailFields {
  phone: string | null;
  website: string | null;
  allWebsites: string[];
  address: string | null;
  rating: string | null;
  reviewCount: string | null;
  category: string | null;
}

// Hosts that must never be picked as the "website" from Maps (they are platform pages)
const MAPS_SKIP_HOSTS = [
  "google.com", "google.fr", "gstatic.com", "maps.app.goo.gl", "g.page", "schema.org",
  "facebook.com", "instagram.com", "twitter.com", "x.com", "linkedin.com",
  "youtube.com", "tiktok.com", "pinterest.com",
];

function mapsHostOk(href: string): boolean {
  try {
    const host = new URL(href).hostname.replace(/^www\./, "").toLowerCase();
    return !MAPS_SKIP_HOSTS.some((h) => host === h || host.endsWith("." + h));
  } catch {
    return false;
  }
}

async function extractDetailFromDOM(page: Page): Promise<DetailFields> {
  const result = await page.evaluate(() => {
    const text = (sel: string) => {
      const el = document.querySelector(sel);
      return el?.textContent?.trim() || null;
    };

    // Phone: look for aria-label containing "Phone" or "Téléphone"
    let phone: string | null = null;
    const phoneBtn = document.querySelector(
      'button[data-item-id^="phone:"], a[data-item-id^="phone:"]'
    );
    if (phoneBtn) {
      const label = phoneBtn.getAttribute("aria-label") || "";
      const match = label.match(/(?:\+?\d[\d\s.\-()]{7,})/);
      phone = match ? match[0].trim() : null;
      if (!phone) {
        const raw = phoneBtn.getAttribute("data-item-id");
        if (raw) phone = raw.replace("phone:tel:", "").replace("phone:", "");
      }
    }

    // ── Website ─────────────────────────────────────────────────────────────
    // Collect ALL candidate website hrefs, then let the caller pick the best one.
    const websiteCandidates: string[] = [];

    const addCandidate = (href: string | null | undefined) => {
      if (href && /^https?:\/\//i.test(href) && !href.includes("google.") && !href.includes("gstatic.") && !href.includes("schema.org")) {
        websiteCandidates.push(href);
      }
    };

    // 1. data-item-id authority selectors (classic + newer variants)
    for (const sel of [
      'a[data-item-id="authority"]',
      'a[data-item-id^="authority:"]',
      'a[data-item-id^="oloc:"]',
    ]) {
      document.querySelectorAll<HTMLAnchorElement>(sel).forEach((a) =>
        addCandidate(a.getAttribute("href"))
      );
    }

    // 2. aria-label matching (works regardless of data-item-id changes)
    const websiteKeywords = [
      "site web", "website", "site internet", "open website",
      "ouvrir le site", "visiter le site", "visit website",
      "site officiel", "official site",
    ];
    document.querySelectorAll<HTMLAnchorElement>("a[href]").forEach((a) => {
      const href = a.getAttribute("href") || "";
      if (!/^https?:\/\//i.test(href)) return;
      const label = (a.getAttribute("aria-label") || a.getAttribute("data-tooltip") || "").toLowerCase();
      if (websiteKeywords.some((kw) => label.includes(kw))) addCandidate(href);
    });

    // 3. Sections with globe icon / "Web" or "Site" in aria-label
    document.querySelectorAll<HTMLElement>('[aria-label*="Web" i], [aria-label*="Site" i], [data-section-id="apb"]').forEach((section) => {
      section.querySelectorAll<HTMLAnchorElement>('a[href^="http"]').forEach((a) =>
        addCandidate(a.getAttribute("href"))
      );
    });

    // 4. Any <a> in the detail panel that looks like an external domain
    //    (last resort — excludes social, Google, and schema.org)
    const skipHosts = ["google.", "gstatic.", "schema.org", "facebook.", "instagram.", "twitter.", "linkedin.", "youtube.", "tiktok."];
    const main = document.querySelector('[role="main"]') || document.body;
    main.querySelectorAll<HTMLAnchorElement>('a[href^="http"]').forEach((a) => {
      const href = a.getAttribute("href") || "";
      if (skipHosts.some((h) => href.includes(h))) return;
      addCandidate(href);
    });

    // Deduplicate and return all candidates for the caller to pick from
    const website = [...new Set(websiteCandidates)][0] ?? null;
    const allWebsites = [...new Set(websiteCandidates)];

    // Address
    let address: string | null = null;
    const addrBtn = document.querySelector(
      'button[data-item-id="address"], button[data-item-id^="oloc:"]'
    );
    if (addrBtn) {
      address =
        addrBtn
          .getAttribute("aria-label")
          ?.replace(/^Adresse\s*:\s*/i, "")
          .replace(/^Address\s*:\s*/i, "")
          .trim() || null;
    }

    // Rating & review count
    const ratingSpan = document.querySelector("div.fontDisplayLarge, span.fontDisplayLarge");
    const rating = ratingSpan?.textContent?.trim().replace(",", ".") || null;

    let reviewCount: string | null = null;
    const reviewEl = document.querySelector('span[aria-label*="avis"], span[aria-label*="review"]');
    if (reviewEl) {
      const m = (reviewEl.getAttribute("aria-label") || "").match(/(\d[\d\s.,]*)/);
      reviewCount = m ? m[1].replace(/\s/g, "") : null;
    }

    const category =
      text('button[jsaction*="category"]') || text("span.fontBodyMedium > span > span");

    return { phone, website, allWebsites, address, rating, reviewCount, category };
  });

  // ── Playwright locator fallback (runs in Node context, more reliable) ──────
  if (!result.website) {
    try {
      const locatorSelectors = [
        'a[data-item-id="authority"]',
        'a[data-item-id^="authority:"]',
        'a[aria-label*="site web" i]',
        'a[aria-label*="website" i]',
        'a[aria-label*="visiter" i]',
        'a[aria-label*="ouvrir le site" i]',
      ];
      for (const sel of locatorSelectors) {
        const elements = page.locator(sel);
        const count = await elements.count().catch(() => 0);
        for (let i = 0; i < count; i++) {
          const el = elements.nth(i);
          if (await el.isVisible({ timeout: 1000 }).catch(() => false)) {
            const href = await el.getAttribute("href").catch(() => null);
            if (href && /^https?:\/\//i.test(href)) {
              if (!result.allWebsites.includes(href)) result.allWebsites.push(href);
              if (!result.website) result.website = href;
            }
          }
        }
      }
    } catch {
      /* ignore */
    }
  }

  return result as DetailFields;
}

// ---------------------------------------------------------------------------
// List-view extraction (fast, no clicks needed for basic info)
// ---------------------------------------------------------------------------

interface ListItem {
  name: string;
  href: string;
  rating: string | null;
  reviewCount: string | null;
  category: string | null;
  address: string | null;
}

async function extractListItems(page: Page): Promise<ListItem[]> {
  return page.evaluate(() => {
    const items: {
      name: string;
      href: string;
      rating: string | null;
      reviewCount: string | null;
      category: string | null;
      address: string | null;
    }[] = [];

    const links = document.querySelectorAll('a[href*="/maps/place/"]');
    for (const a of links) {
      const label = a.getAttribute("aria-label");
      if (!label) continue;

      const href = a.getAttribute("href") || "";
      const container = a.closest('[jsaction]')?.parentElement;
      let rating: string | null = null;
      let reviewCount: string | null = null;
      let category: string | null = null;
      let address: string | null = null;

      if (container) {
        const spans = container.querySelectorAll("span");
        for (const sp of spans) {
          const t = sp.textContent?.trim() || "";
          if (/^\d[.,]\d$/.test(t) && !rating) {
            rating = t.replace(",", ".");
          }
          if (/^\(\d/.test(t) && !reviewCount) {
            const m = t.match(/\((\d[\d\s.,]*)\)/);
            reviewCount = m ? m[1].replace(/\s/g, "") : null;
          }
        }
        const textParts = container.textContent || "";
        const catMatch = textParts.match(
          /(?:·|•)\s*([A-ZÀ-Ú][a-zà-ú\s,&'()-]{2,40})/
        );
        if (catMatch) category = catMatch[1].trim();

        const addrMatch = textParts.match(
          /(?:·|•)\s*(\d{1,5}\s+(?:rue|avenue|boulevard|place|chemin|route|allée|impasse|cours|quai|passage|bd|av)\b[^·•]{3,60})/i
        );
        if (addrMatch) address = addrMatch[1].trim();
      }

      items.push({ name: label, href, rating, reviewCount, category, address });
    }
    return items;
  });
}

// ---------------------------------------------------------------------------
// Main scraper
// ---------------------------------------------------------------------------

export async function scrapeGoogleMaps(
  page: Page,
  query: string,
  seenNames: Set<string>,
  log: (msg: string) => void,
  maxScrolls: number = 5,
  maxLeads: number = 30,
  deadline: number = Infinity
): Promise<MapsLead[]> {
  const leads: MapsLead[] = [];
  const mapsUrl = `https://www.google.com/maps/search/${encodeURIComponent(query)}`;
  log(`[Maps] Searching: "${query}"`);

  try {
    await page.goto(mapsUrl, { waitUntil: "domcontentloaded", timeout: 20000 });
  } catch {
    log(`[Maps] ✗ Navigation timeout for "${query}"`);
    return leads;
  }
  await randomDelay(2000, 3000);

  // Handle consent redirect
  if (page.url().includes("consent.google.com")) {
    log("[Maps] Handling consent...");
    await dismissConsent(page);
    try {
      const acceptBtn = page.locator('button:has-text("Tout accepter"), button:has-text("Accept all")').first();
      if (await acceptBtn.isVisible({ timeout: 2000 })) {
        await acceptBtn.click();
        await randomDelay(2000, 3000);
      }
    } catch {
      try {
        await page.goto(mapsUrl, { waitUntil: "domcontentloaded", timeout: 20000 });
        await randomDelay(2000, 3000);
      } catch {
        return leads;
      }
    }
  }

  // Wait for results feed
  await page
    .waitForSelector('div[role="feed"], div[role="main"]', { timeout: 15000 })
    .catch(() => {});
  await randomDelay(1500, 2500);

  // Phase 1: Collect business names from list view (fast, no detail clicks)
  const allListItems: ListItem[] = [];
  const collectedNames = new Set<string>();

  for (let scroll = 0; scroll < maxScrolls; scroll++) {
    if (Date.now() >= deadline) break;

    const items = await extractListItems(page);
    let newCount = 0;
    for (const item of items) {
      const key = item.name.toLowerCase();
      if (collectedNames.has(key) || seenNames.has(key)) continue;
      collectedNames.add(key);
      allListItems.push(item);
      newCount++;
    }

    if (newCount === 0 && scroll > 0) break;
    if (allListItems.length >= maxLeads) break;

    // Scroll for more results
    const feed = page.locator('div[role="feed"]').first();
    try {
      if (await feed.isVisible({ timeout: 2000 })) {
        await feed.evaluate((el) => {
          el.scrollTop += el.clientHeight;
        });
      } else {
        await page.mouse.wheel(0, 800);
      }
    } catch {
      await page.mouse.wheel(0, 800);
    }
    await randomDelay(1500, 2500);
  }

  log(`[Maps] Found ${allListItems.length} businesses in list view`);

  // Phase 2: Click into each business to get phone + website (DOM extraction, no Gemini)
  for (const item of allListItems) {
    if (leads.length >= maxLeads) break;
    if (Date.now() >= deadline) {
      log("[Maps] ⏱ Time budget reached");
      break;
    }

    try {
      const link = page
        .locator(`a[aria-label="${CSS.escape(item.name)}"][href*="/maps/place/"]`)
        .first();

      if (!(await link.isVisible({ timeout: 2000 }))) {
        // Business scrolled out of view — add with list-only data
        leads.push(makeLeadFromList(item));
        seenNames.add(item.name.toLowerCase());
        continue;
      }

      await link.click();

      // Wait for the detail panel to fully render. The website section loads
      // LAST (after name, rating, address, phone) so we need to be patient.
      await page.waitForURL(/maps\/place/, { timeout: 8000 }).catch(() => {});

      // First wait for the panel shell (address/phone always render first)
      await page
        .waitForSelector(
          'button[data-item-id="address"], button[data-item-id^="phone:"]',
          { timeout: 6000 }
        )
        .catch(() => {});

      // Then specifically wait for the website link (loads after address/phone)
      await page
        .waitForSelector(
          'a[data-item-id="authority"], a[data-item-id^="authority:"], a[aria-label*="site web" i], a[aria-label*="website" i]',
          { timeout: 5000 }
        )
        .catch(() => {
          // May not have a website at all — that's ok
        });

      // Extra buffer for any remaining JS hydration
      await randomDelay(600, 1200);

      const detail = await extractDetailFromDOM(page);

      // Pick the best website from all candidates:
      // prefer the first non-platform URL; fall back to any platform URL.
      const allCandidates = detail.allWebsites.map((u) => normalizeUrl(u)).filter(Boolean) as string[];
      const ownedUrl = allCandidates.find((u) => classifyUrl(u) === null) ?? null;
      const platformUrl = allCandidates.find((u) => classifyUrl(u) !== null) ?? null;
      const normalizedWebsite = ownedUrl ?? platformUrl ?? normalizeUrl(detail.website);
      const isPlatform = normalizedWebsite ? (ownedUrl === null && classifyUrl(normalizedWebsite) !== null) : false;

      const lead: MapsLead = {
        business_name: item.name,
        description: detail.category || item.category,
        address: detail.address || item.address,
        phone: detail.phone,
        email: null,
        rating: detail.rating || item.rating,
        review_count: detail.reviewCount || item.reviewCount,
        review_highlights: [],
        // Only mark has_website true for owned domains (not Planity, Facebook, etc.)
        has_website: Boolean(normalizedWebsite) && !isPlatform,
        website_url: normalizedWebsite,
        google_maps_url: page.url(),
      };

      leads.push(lead);
      seenNames.add(item.name.toLowerCase());

      const status = lead.has_website
        ? `has website: ${lead.website_url}`
        : normalizedWebsite
          ? `platform only: ${normalizedWebsite.slice(0, 40)}`
          : "NO WEBSITE";
      log(`[Maps] ✓ ${item.name} — ${status}${lead.phone ? ` — ${lead.phone}` : ""}`);

      // Go back to list
      try {
        const backBtn = page
          .locator('button[aria-label="Back"], button[aria-label="Retour"], button[jsaction*="back"]')
          .first();
        if (await backBtn.isVisible({ timeout: 2000 })) {
          await backBtn.click();
        } else {
          await page.goBack();
        }
        await randomDelay(800, 1200);
      } catch {
        await page.goBack().catch(() => {});
        await randomDelay(800, 1200);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("closed") || msg.includes("Protocol error")) throw e;

      // On any other error, add with list-only data
      leads.push(makeLeadFromList(item));
      seenNames.add(item.name.toLowerCase());
      log(`[Maps] ~ ${item.name} — list data only`);
    }
  }

  return leads;
}

function makeLeadFromList(item: ListItem): MapsLead {
  return {
    business_name: item.name,
    description: item.category,
    address: item.address,
    phone: null,
    email: null,
    rating: item.rating,
    review_count: item.reviewCount,
    review_highlights: [],
    has_website: false,
    website_url: null,
    google_maps_url: item.href || null,
  };
}
