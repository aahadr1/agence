import type { Page } from "playwright-core";
import {
  launchBrowser,
  safeClose,
  isBrowserAlive,
  newPage,
  screenshotToBase64,
  askGemini,
  normalizeUrl,
  type BrowserSession,
} from "../lead-agent/browser";
import { searchSocieteCom } from "../lead-agent/sources/societe-com";
import { searchFacebook } from "../lead-agent/sources/facebook";
import { searchLinkedIn } from "../lead-agent/sources/linkedin";
import { searchOwnerPhone } from "../lead-agent/enrichment/owner-search";
import { deepCheckWebsite, fetchPageSpeedScore } from "../lead-agent/enrichment/deep-website-check";
import { checkFbAdLibrary } from "../lead-agent/sources/fb-ad-library";
import { calculatePotentialScore, detectPainPoints, recommendOffers } from "./scoring";
import { runContextualInsights, type InsightDossier } from "./contextual-insights";
import type { CompetitorAnalysis } from "@/lib/types";

export interface AnalysisInput {
  type: "name_city" | "google_maps_url" | "siret";
  value: string;
  city?: string;
}

export interface AnalysisResult {
  business_name: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  google_maps_url: string | null;

  siren: string | null;
  siret: string | null;
  company_type: string | null;
  creation_date: string | null;
  revenue_bracket: string | null;
  employee_count: string | null;
  owner_name: string | null;
  owner_role: string | null;
  owner_phone: string | null;
  owner_email: string | null;
  linkedin_url: string | null;

  website_url: string | null;
  website_score: number | null;
  website_quality: string | null;
  has_https: boolean;
  has_booking: boolean;
  has_chatbot: boolean;

  google_rating: number | null;
  google_review_count: number | null;
  review_trend: string | null;
  review_highlights: string[];

  facebook_url: string | null;
  facebook_followers: number | null;
  instagram_url: string | null;
  instagram_followers: number | null;
  has_meta_ads: boolean;
  meta_ads_count: number;

  potential_score: number;
  pain_points: ReturnType<typeof detectPainPoints>;
  recommended_offers: ReturnType<typeof recommendOffers>;
  competitors: CompetitorAnalysis[];
}

interface MapsBusinessInfo {
  business_name: string;
  description: string | null;
  address: string | null;
  phone: string | null;
  rating: string | null;
  review_count: string | null;
  review_highlights: string[];
  has_website: boolean;
  website_url: string | null;
  google_maps_url: string;
  niche_category: string | null;
}

/**
 * Run a full business analysis. This is the main orchestrator.
 *
 * Flow:
 * 1. Resolve the business on Google Maps (from name+city, URL, or SIRET)
 * 2. Deep-check the website (quality, HTTPS, booking, chatbot)
 * 3. Check Facebook Ad Library
 * 4. Get legal info from Societe.com / Pappers
 * 5. Facebook + Instagram
 * 6. LinkedIn
 * 7. Owner personal contact
 * 8. Find and mini-analyze competitors
 * 9. IA — réflexion métier & pondération secteur
 * 10. IA — lacunes & offres contextualisées, puis score potentiel
 */
export async function runBusinessAnalysis(
  input: AnalysisInput,
  log: (msg: string) => void = console.log
): Promise<AnalysisResult> {
  let session: BrowserSession | null = null;

  async function ensureBrowser(): Promise<BrowserSession> {
    if (session && isBrowserAlive(session)) return session;
    log("[Browser] Launching...");
    await safeClose(session);
    session = await launchBrowser();
    return session;
  }

  async function runStep<T>(label: string, fn: () => Promise<T | null>): Promise<T | null> {
    try {
      return await fn();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("closed") || msg.includes("Protocol error") || msg.includes("Target closed")) {
        log(`[${label}] ✗ Browser crashed — relaunching`);
        session = null;
        return null;
      }
      log(`[${label}] ✗ ${msg}`);
      return null;
    }
  }

  try {
    session = await launchBrowser();
    const page = session.page;

    // ── Step 1: Resolve business on Google Maps ──
    log("Step 1/10: Resolving business...");
    const businessInfo = await resolveBusinessOnMaps(page, input, log);
    if (!businessInfo) {
      throw new Error("Could not find this business on Google Maps");
    }
    log(`✓ Found: ${businessInfo.business_name} — ${businessInfo.address || "no address"}`);

    // Initialize result
    const result: AnalysisResult = {
      business_name: businessInfo.business_name,
      address: businessInfo.address,
      phone: businessInfo.phone,
      email: null,
      google_maps_url: businessInfo.google_maps_url,
      siren: null,
      siret: null,
      company_type: null,
      creation_date: null,
      revenue_bracket: null,
      employee_count: null,
      owner_name: null,
      owner_role: null,
      owner_phone: null,
      owner_email: null,
      linkedin_url: null,
      website_url: businessInfo.website_url,
      website_score: null,
      website_quality: businessInfo.has_website ? null : "none",
      has_https: false,
      has_booking: false,
      has_chatbot: false,
      google_rating: businessInfo.rating ? parseFloat(businessInfo.rating) : null,
      google_review_count: businessInfo.review_count ? parseInt(businessInfo.review_count) : null,
      review_trend: null,
      review_highlights: businessInfo.review_highlights,
      facebook_url: null,
      facebook_followers: null,
      instagram_url: null,
      instagram_followers: null,
      has_meta_ads: false,
      meta_ads_count: 0,
      potential_score: 0,
      pain_points: [],
      recommended_offers: [],
      competitors: [],
    };

    const city = input.city || extractCity(businessInfo.address || input.value);
    const nicheCategory = businessInfo.niche_category || "";

    let websiteTechNotes: string | null = null;
    let websitePainSummary: string | null = null;
    let hasContactForm = false;

    // ── Step 2: Deep website check ──
    if (businessInfo.has_website && businessInfo.website_url) {
      log("Step 2/10: Deep website analysis...");
      const s = await ensureBrowser();
      const webPage = await newPage(s);
      try {
        const webResult = await runStep("DeepCheck", () =>
          deepCheckWebsite(webPage, businessInfo.website_url!, businessInfo.business_name, log)
        );
        if (webResult) {
          result.website_quality = webResult.quality;
          result.website_score = webResult.score;
          result.has_https = webResult.has_https;
          result.has_booking = webResult.has_booking;
          result.has_chatbot = webResult.has_chatbot;
          websiteTechNotes = webResult.tech_notes || null;
          websitePainSummary = webResult.pain_summary || null;
          hasContactForm = webResult.has_contact_form;

          if (webResult.is_just_social) {
            result.website_url = null;
            result.website_quality = "none";
            result.website_score = 0;
          }
        }

        // Also fetch PageSpeed score in parallel (non-browser)
        const pageSpeedScore = await fetchPageSpeedScore(businessInfo.website_url!, log);
        if (pageSpeedScore !== null) {
          // Blend our visual score with PageSpeed (60% visual, 40% PageSpeed)
          const visualScore = result.website_score ?? 50;
          result.website_score = Math.round(visualScore * 0.6 + pageSpeedScore * 0.4);
        }
      } finally {
        try { await webPage.close(); } catch { /* */ }
      }
    } else {
      log("Step 2/10: No website — skipping");
      result.website_quality = "none";
      result.website_score = 0;
    }

    if (!session) { await ensureBrowser(); }

    // ── Step 3: Facebook Ad Library check ──
    log("Step 3/10: Checking Facebook Ad Library...");
    const s3 = await ensureBrowser();
    const adPage = await newPage(s3);
    try {
      const adResult = await runStep("AdLibrary", () =>
        checkFbAdLibrary(adPage, businessInfo.business_name, city, result.facebook_url, log)
      );
      if (adResult) {
        result.has_meta_ads = adResult.has_ads;
        result.meta_ads_count = adResult.ad_count;
      }
    } finally {
      try { await adPage.close(); } catch { /* */ }
    }

    if (!session) { await ensureBrowser(); }

    // ── Step 4: Societe.com / Pappers ──
    log("Step 4/10: Legal info (Societe.com)...");
    const s4 = await ensureBrowser();
    const socPage = await newPage(s4);
    try {
      const socResult = await runStep("Societe", () =>
        searchSocieteCom(socPage, businessInfo.business_name, city, businessInfo.address, log)
      );
      if (socResult) {
        result.owner_name = socResult.owner_name;
        result.owner_role = socResult.owner_role;
        result.siren = socResult.siren;
        result.siret = socResult.siret;
        result.company_type = socResult.company_type;
        result.creation_date = socResult.creation_date;
        result.revenue_bracket = socResult.revenue_bracket;
        result.employee_count = socResult.employee_count;
        result.phone = result.phone || socResult.phone;
        if (socResult.website_url && !result.website_url) {
          result.website_url = socResult.website_url;
        }
      }
    } finally {
      try { await socPage.close(); } catch { /* */ }
    }

    if (!session) { await ensureBrowser(); }

    // ── Step 5: Facebook + Instagram ──
    log("Step 5/10: Social media (Facebook/Instagram)...");
    const s5 = await ensureBrowser();
    const fbPage = await newPage(s5);
    try {
      const fbResult = await runStep("Facebook", () =>
        searchFacebook(fbPage, businessInfo.business_name, city, result.owner_name, log)
      );
      if (fbResult) {
        result.facebook_url = fbResult.facebook_url;
        result.facebook_followers = fbResult.follower_count;
        result.instagram_url = fbResult.instagram_url;
        result.email = result.email || fbResult.email;
        result.phone = result.phone || fbResult.phone;
        result.owner_name = result.owner_name || fbResult.owner_name;
      }
    } finally {
      try { await fbPage.close(); } catch { /* */ }
    }

    if (!session) { await ensureBrowser(); }

    // ── Step 6: LinkedIn ──
    log(`Step 6/10: LinkedIn${result.owner_name ? ` (${result.owner_name})` : ""}...`);
    const s6 = await ensureBrowser();
    const liPage = await newPage(s6);
    try {
      const liResult = await runStep("LinkedIn", () =>
        searchLinkedIn(liPage, businessInfo.business_name, city, result.owner_name, log)
      );
      if (liResult) {
        result.linkedin_url = liResult.linkedin_url;
        result.owner_name = result.owner_name || liResult.owner_name;
        result.owner_email = liResult.email;
        result.phone = result.phone || liResult.phone;
      }
    } finally {
      try { await liPage.close(); } catch { /* */ }
    }

    if (!session) { await ensureBrowser(); }

    // ── Step 7: Owner phone search ──
    if (result.owner_name) {
      log(`Step 7/10: Owner contact (${result.owner_name})...`);
      const s7 = await ensureBrowser();
      const ownerPage = await newPage(s7);
      try {
        const ownerResult = await runStep("OwnerPhone", () =>
          searchOwnerPhone(ownerPage, result.owner_name!, businessInfo.business_name, city, log)
        );
        if (ownerResult) {
          result.owner_phone = ownerResult.owner_phone;
          result.owner_email = result.owner_email || ownerResult.owner_email;
        }
      } finally {
        try { await ownerPage.close(); } catch { /* */ }
      }
    } else {
      log("Step 7/10: Owner contact — skipped (no owner name)");
    }

    if (!session) { await ensureBrowser(); }

    // ── Step 8: Find & mini-analyze competitors ──
    log("Step 8/10: Competitor analysis...");
    result.competitors = await findAndAnalyzeCompetitors(
      ensureBrowser,
      runStep,
      businessInfo.business_name,
      nicheCategory,
      city,
      log
    );

    // ── Steps 9–10: IA — réflexion métier + lacunes / offres contextualisées ──
    const dossier: InsightDossier = {
      business_name: result.business_name,
      niche_category: nicheCategory || null,
      maps_description: businessInfo.description,
      city: city || null,
      address: result.address,
      website_url: result.website_url,
      website_score: result.website_score,
      website_quality: result.website_quality,
      has_https: result.has_https,
      has_booking: result.has_booking,
      has_chatbot: result.has_chatbot,
      has_contact_form: hasContactForm,
      website_tech_notes: websiteTechNotes,
      website_pain_summary: websitePainSummary,
      google_rating: result.google_rating,
      google_review_count: result.google_review_count,
      review_highlights: result.review_highlights,
      has_meta_ads: result.has_meta_ads,
      meta_ads_count: result.meta_ads_count,
      facebook_url: result.facebook_url,
      instagram_url: result.instagram_url,
      facebook_followers: result.facebook_followers,
      linkedin_url: result.linkedin_url,
      owner_name: result.owner_name,
      company_type: result.company_type,
      revenue_bracket: result.revenue_bracket,
      employee_count: result.employee_count,
      creation_date: result.creation_date,
      competitors: result.competitors,
    };

    log("Step 9/10: Synthèse métier & attentes digitales (IA)…");
    const contextual = await runContextualInsights(dossier, log);

    const scoringInput = {
      has_website: result.website_quality !== "none",
      website_score: result.website_score,
      website_quality: result.website_quality,
      has_https: result.has_https,
      has_booking: result.has_booking,
      has_chatbot: result.has_chatbot,
      google_rating: result.google_rating,
      google_review_count: result.google_review_count,
      has_meta_ads: result.has_meta_ads,
      meta_ads_count: result.meta_ads_count,
      facebook_url: result.facebook_url,
      instagram_url: result.instagram_url,
      facebook_followers: result.facebook_followers,
      employee_count: result.employee_count,
      revenue_bracket: result.revenue_bracket,
      creation_date: result.creation_date,
      competitors: result.competitors,
      booking_gap_weight: contextual?.reflection.scoring_weights.missing_booking_gap,
      chatbot_gap_weight: contextual?.reflection.scoring_weights.missing_chatbot_gap,
    };

    log("Step 10/10: Score & consolidation…");
    result.potential_score = calculatePotentialScore(scoringInput);

    if (contextual) {
      result.pain_points = contextual.pain_points;
      result.recommended_offers = contextual.recommended_offers;
    } else {
      log("[Insights] Fallback — lacunes heuristiques");
      result.pain_points = detectPainPoints(scoringInput);
      result.recommended_offers = recommendOffers(result.pain_points, scoringInput);
    }

    const found = [
      result.phone && "phone",
      result.email && "email",
      result.owner_name && `owner:${result.owner_name}`,
      result.siren && "SIREN",
      result.linkedin_url && "LinkedIn",
      result.facebook_url && "Facebook",
      result.has_meta_ads && `${result.meta_ads_count} ads`,
    ].filter(Boolean).join(", ");

    log(`\n═══ Analysis complete ═══`);
    log(`Business: ${result.business_name}`);
    log(`Score: ${result.potential_score}/100`);
    log(`Pain points: ${result.pain_points.length}`);
    log(`Offers: ${result.recommended_offers.length}`);
    log(`Competitors: ${result.competitors.length}`);
    log(`Data found: ${found || "basic info only"}`);

    return result;
  } finally {
    await safeClose(session);
  }
}

/** Decode business name from a /maps/place/... URL slug when Gemini cannot read the UI */
function businessNameFromMapsUrl(url: string): string | null {
  try {
    const m = url.match(/\/maps\/place\/([^/?@]+)/);
    if (!m) return null;
    const raw = m[1];
    const decoded = decodeURIComponent(raw.replace(/\+/g, " "));
    const cleaned = decoded.replace(/\s+/g, " ").trim();
    if (cleaned.length < 2) return null;
    return cleaned;
  } catch {
    return null;
  }
}

async function dismissGoogleConsentIfPresent(page: Page, log: (msg: string) => void) {
  let guard = 0;
  while (page.url().includes("consent.google") && guard++ < 3) {
    log("[Maps] Consent page — trying to accept…");
    const labels = [
      "Tout accepter",
      "Accepter tout",
      "J'accepte",
      "Accept all",
      "I agree",
      "Alle akzeptieren",
      "Aceptar todo",
      "Acceptar todo",
    ];
    let clicked = false;
    for (const t of labels) {
      try {
        const btn = page.locator(`button:has-text("${t}")`).first();
        if (await btn.isVisible({ timeout: 1200 })) {
          await btn.click();
          clicked = true;
          await page.waitForTimeout(3000);
          break;
        }
      } catch {
        /* try next label */
      }
    }
    if (!clicked) {
      log("[Maps] Could not find consent button — continuing");
      break;
    }
  }
}

async function waitForMapsSearchUi(page: Page) {
  await page
    .waitForSelector('div[role="feed"], a[href*="/maps/place/"], div[role="main"]', {
      timeout: 20000,
    })
    .catch(() => {});
  await page.waitForTimeout(2000);
}

/** Open first search result or noop if already on a place detail page */
async function openFirstPlaceFromSearch(page: Page, log: (msg: string) => void) {
  if (page.url().includes("/maps/place/")) {
    log("[Resolve] Already on a /maps/place/ URL");
    return;
  }
  const feed = page.locator('div[role="feed"]').first();
  if (await feed.isVisible({ timeout: 6000 }).catch(() => false)) {
    try {
      await feed.evaluate((el) => {
        el.scrollTop = 0;
      });
    } catch {
      /* */
    }
    await page.waitForTimeout(800);
  }

  const candidates = [
    'div[role="feed"] a[href*="/maps/place/"]',
    'div[role="main"] a[href*="/maps/place/"]',
    'a[href*="/maps/place/"]',
  ];
  for (const sel of candidates) {
    const link = page.locator(sel).first();
    try {
      if (await link.isVisible({ timeout: 5000 })) {
        await link.scrollIntoViewIfNeeded().catch(() => {});
        await link.click({ timeout: 8000 });
        await page.waitForTimeout(4000);
        log(`[Resolve] Opened first result via: ${sel}`);
        return;
      }
    } catch (e) {
      log(`[Resolve] Click failed (${sel}): ${e instanceof Error ? e.message : e}`);
    }
  }
  log("[Resolve] No place link clicked — extracting from current screen anyway");
}

async function gotoMapsSearch(page: Page, query: string, log: (msg: string) => void) {
  const mapsUrl = `https://www.google.com/maps/search/${encodeURIComponent(query)}`;
  await page.goto(mapsUrl, { waitUntil: "domcontentloaded", timeout: 25000 });
  await page.waitForTimeout(2000);
  await dismissGoogleConsentIfPresent(page, log);
  if (page.url().includes("consent.google")) {
    await page.goto(mapsUrl, { waitUntil: "domcontentloaded", timeout: 25000 }).catch(() => {});
    await page.waitForTimeout(2500);
    await dismissGoogleConsentIfPresent(page, log);
  }
  await waitForMapsSearchUi(page);
}

/**
 * Resolve a business on Google Maps from various input types.
 */
async function resolveBusinessOnMaps(
  page: Page,
  input: AnalysisInput,
  log: (msg: string) => void
): Promise<MapsBusinessInfo | null> {
  if (input.type === "google_maps_url") {
    log("[Resolve] Loading Google Maps URL...");
    try {
      let url = input.value.trim();
      if (!/^https?:\/\//i.test(url)) url = "https://" + url;
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 25000 });
      await page.waitForTimeout(2500);
      await dismissGoogleConsentIfPresent(page, log);
      await waitForMapsSearchUi(page);
      if (!page.url().includes("/maps/place/")) {
        await openFirstPlaceFromSearch(page, log);
      }
      return await extractMapsBusinessInfo(page, log);
    } catch (e) {
      log(`[Resolve] ✗ Failed to load Maps URL: ${e}`);
      return null;
    }
  }

  if (input.type === "siret") {
    log("[Resolve] Looking up SIRET...");
    try {
      await page.goto(
        `https://www.societe.com/cgi-bin/search?champs=${encodeURIComponent(input.value)}`,
        { waitUntil: "domcontentloaded", timeout: 18000 }
      );
      await page.waitForTimeout(2500);

      const screenshot = await screenshotToBase64(page);
      const siretResult = await askGemini<{ business_name: string | null; city: string | null }>(
        `You are looking at Societe.com search results for SIRET/SIREN "${input.value}".
Extract the business name and city. Return JSON: { "business_name": "...", "city": "..." }`,
        screenshot
      );

      if (siretResult.business_name) {
        const city = siretResult.city || input.city || "";
        const q = `${siretResult.business_name} ${city}`.trim();
        await gotoMapsSearch(page, q, log);
        await openFirstPlaceFromSearch(page, log);
        return await extractMapsBusinessInfo(page, log);
      }
    } catch (e) {
      log(`[Resolve] ✗ SIRET lookup failed: ${e}`);
    }
    return null;
  }

  // name_city: several query shapes — Maps matching is picky
  const base = input.value.trim();
  const queries = [base];
  if (input.city && !base.toLowerCase().includes(input.city.toLowerCase())) {
    queries.push(`${base} ${input.city.trim()}`);
  }
  if (!/\bfrance\b|\bfr\b/i.test(base)) {
    queries.push(`${base}, France`);
  }
  if (input.city && !queries.some((q) => q.includes("near"))) {
    queries.push(`${base} near ${input.city.trim()}`);
  }

  for (let qi = 0; qi < queries.length; qi++) {
    const q = queries[qi];
    log(`[Resolve] Google Maps search (${qi + 1}/${queries.length}): "${q}"`);
    await gotoMapsSearch(page, q, log);
    await openFirstPlaceFromSearch(page, log);
    const info = await extractMapsBusinessInfo(page, log);
    if (info) return info;
    log(`[Resolve] No data for query "${q}" — retrying…`);
  }

  return null;
}

/**
 * Extract detailed business info from a Google Maps business detail page.
 */
async function extractMapsBusinessInfo(
  page: Page,
  log: (msg: string) => void
): Promise<MapsBusinessInfo | null> {
  const currentUrl = page.url();
  const screenshot = await screenshotToBase64(page);

  const result = await askGemini<{
    business_name: string;
    description: string | null;
    address: string | null;
    phone: string | null;
    rating: string | null;
    review_count: string | null;
    review_highlights: string[];
    has_website: boolean;
    website_url: string | null;
    niche_category: string | null;
  }>(
    `You are looking at Google Maps (either a single business detail side panel OR a search results list with a highlighted/selected business).

Rules:
- If you see ONE business panel (title, reviews, address): extract THAT business.
- If you see a LIST: extract the FIRST / TOP visible business card in the results list (not sponsored ads if clearly labeled).
- If the screen is blank, login wall, or captcha: return business_name as empty string "".

Extract ALL available information:
{
  "business_name": "exact business name as shown in Maps (required if visible)",
  "description": "type/category of business",
  "address": "full street address",
  "phone": "phone number (format: +33 X XX XX XX XX or 0X XX XX XX XX)",
  "rating": "X.X" or null,
  "review_count": "number" or null,
  "review_highlights": ["up to 5 review snippets if visible"],
  "has_website": true if Website/Site web button exists,
  "website_url": "URL if visible" or null,
  "niche_category": "business category — e.g. Restaurant, Plombier, Salon de coiffure, Boulangerie"
}

Return JSON only.`,
    screenshot
  );

  let name = (result.business_name || "").trim();
  if (!name) {
    const fromUrl = businessNameFromMapsUrl(page.url());
    if (fromUrl) {
      log(`[Maps] Name from URL slug: ${fromUrl}`);
      name = fromUrl;
    }
  }

  if (!name) {
    log("[Maps] Could not extract business name (UI + URL)");
    return null;
  }

  return {
    ...result,
    business_name: name,
    website_url: normalizeUrl(result.website_url),
    google_maps_url: currentUrl,
  };
}

/**
 * Find 3-5 competitors via Google Maps and run a mini-analysis on each.
 */
async function findAndAnalyzeCompetitors(
  ensureBrowser: () => Promise<BrowserSession>,
  runStep: <T>(label: string, fn: () => Promise<T | null>) => Promise<T | null>,
  businessName: string,
  niche: string,
  city: string,
  log: (msg: string) => void
): Promise<CompetitorAnalysis[]> {
  const competitors: CompetitorAnalysis[] = [];

  if (!niche) {
    log("[Competitors] No niche category detected — skipping");
    return competitors;
  }

  try {
    const s = await ensureBrowser();
    const compPage = await newPage(s);

    try {
      // Search Google Maps for similar businesses
      const query = `${niche} ${city}`;
      log(`[Competitors] Searching: "${query}"`);
      await compPage.goto(
        `https://www.google.com/maps/search/${encodeURIComponent(query)}`,
        { waitUntil: "domcontentloaded", timeout: 20000 }
      );
      await compPage.waitForTimeout(3000);

      // Get list of businesses from results
      const placeLinks = await compPage.locator('a[href*="/maps/place/"]').all();
      const competitorNames: { name: string; href: string }[] = [];

      for (const link of placeLinks.slice(0, 8)) {
        const ariaLabel = await link.getAttribute("aria-label").catch(() => null);
        if (!ariaLabel) continue;
        if (ariaLabel.toLowerCase().includes(businessName.toLowerCase())) continue;

        const href = await link.getAttribute("href").catch(() => null);
        competitorNames.push({ name: ariaLabel, href: href || "" });

        if (competitorNames.length >= 5) break;
      }

      log(`[Competitors] Found ${competitorNames.length} potential competitors`);

      // Mini-analyze each competitor
      for (const comp of competitorNames.slice(0, 4)) {
        try {
          // Click on competitor
          const link = compPage.locator(`a[aria-label="${comp.name}"]`).first();
          if (!(await link.isVisible({ timeout: 3000 }))) continue;
          await link.click();
          await compPage.waitForTimeout(2500);

          const screenshot = await screenshotToBase64(compPage);

          const compInfo = await askGemini<{
            business_name: string;
            rating: number | null;
            review_count: number | null;
            has_website: boolean;
            website_url: string | null;
            strengths: string[];
          }>(
            `Google Maps business detail. Extract:
{
  "business_name": "name",
  "rating": X.X or null,
  "review_count": number or null,
  "has_website": true/false,
  "website_url": "url" or null,
  "strengths": ["up to 3 competitive strengths visible from this listing"]
}
Return JSON only.`,
            screenshot
          );

          const competitor: CompetitorAnalysis = {
            business_name: compInfo.business_name || comp.name,
            google_maps_url: compPage.url(),
            website_url: normalizeUrl(compInfo.website_url),
            website_score: null,
            rating: compInfo.rating,
            review_count: compInfo.review_count,
            has_meta_ads: false,
            facebook_url: null,
            instagram_url: null,
            strengths: compInfo.strengths || [],
          };

          competitors.push(competitor);
          log(`[Competitors] ✓ ${competitor.business_name}: ${competitor.rating ?? "?"}/5 (${competitor.review_count ?? 0} reviews)`);

          // Go back to results
          try {
            const backBtn = compPage.locator('button[aria-label="Back"], button[jsaction*="back"]').first();
            if (await backBtn.isVisible({ timeout: 2000 })) {
              await backBtn.click();
            } else {
              await compPage.goBack();
            }
            await compPage.waitForTimeout(1500);
          } catch {
            await compPage.goBack();
            await compPage.waitForTimeout(1500);
          }
        } catch (e) {
          log(`[Competitors] ✗ Failed to analyze "${comp.name}": ${e}`);
        }
      }

      // Quick Ad Library check for competitors (batch — just check presence)
      for (const comp of competitors) {
        try {
          const adUrl = `https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=FR&q=${encodeURIComponent(comp.business_name)}&search_type=keyword_unordered`;
          await compPage.goto(adUrl, { waitUntil: "domcontentloaded", timeout: 15000 });
          await compPage.waitForTimeout(3000);

          const adScreenshot = await screenshotToBase64(compPage);
          const adCheck = await askGemini<{ has_ads: boolean }>(
            `Facebook Ad Library page. Are there active ads visible for "${comp.business_name}"?
{ "has_ads": true/false }
Return JSON only.`,
            adScreenshot
          );
          comp.has_meta_ads = adCheck.has_ads;
          if (adCheck.has_ads) {
            log(`[Competitors] ${comp.business_name} has active Meta ads`);
          }
        } catch {
          // non-critical
        }
      }
    } finally {
      try { await compPage.close(); } catch { /* */ }
    }
  } catch (e) {
    log(`[Competitors] ✗ Analysis failed: ${e}`);
  }

  return competitors;
}

function extractCity(text: string): string {
  return text
    .replace(/\d{5}/g, "")
    .replace(/,.*$/, "")
    .trim()
    .split(" ")
    .slice(-2)
    .join(" ");
}
