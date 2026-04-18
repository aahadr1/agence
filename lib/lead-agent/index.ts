import type { Page } from "playwright-core";
import {
  launchBrowser,
  newPage,
  isBrowserAlive,
  safeClose,
  randomDelay,
  type BrowserSession,
} from "./browser";
import { expandQueries } from "./query-expander";
import { DEFAULT_EXPAND_TARGET } from "./search-context";
import { scrapeGoogleMaps, type MapsLead } from "./sources/google-maps";
import { searchGoogle } from "./sources/google-search";
import {
  searchPagesJaunes,
  hasPagesJaunesData,
} from "./sources/pages-jaunes";
import { searchFacebook } from "./sources/facebook";
import { searchLinkedIn } from "./sources/linkedin";
import {
  deepCheckWebsite,
  fetchPageSpeedScore,
} from "./enrichment/deep-website-check";
import { checkFbAdLibrary } from "./sources/fb-ad-library";
import {
  searchPappersApi,
  isPappersApiError,
} from "./sources/pappers-api";
import { quickHttpCheck } from "./enrichment/quick-http-check";
import { computeLeadScore, generateSalesBrief } from "./enrichment/lead-scorer";
import { scrapContactPage } from "./enrichment/contact-page-scraper";
import { deduplicateLeads } from "./deduplicator";
import { findWebsite } from "./enrichment/website-finder";
import { researchDirigeant } from "./enrichment/dirigeant-researcher";
import { analyzeProspect } from "./enrichment/prospect-analyzer";
import { searchOwnerPhone } from "./enrichment/owner-search";
import { searchSocieteCom } from "./sources/societe-com";
import {
  searchSocieteComApi,
  hasSocieteComApiKey,
  isSocieteComApiError,
} from "./sources/societe-com-api";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LeadResult {
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
  facebook_url: string | null;
  instagram_url: string | null;
  owner_name: string | null;
  owner_phone: string | null;
  owner_email: string | null;
  owner_role: string | null;
  linkedin_url: string | null;
  siren: string | null;
  company_type: string | null;
  creation_date: string | null;
  revenue_bracket: string | null;
  employee_count: string | null;
  follower_count: number | null;
  website_quality: string | null;
  website_score: number | null;
  has_https: boolean | null;
  has_booking: boolean | null;
  has_chatbot: boolean | null;
  has_meta_ads: boolean | null;
  meta_ads_count: number | null;
  potential_score: number | null;
  source: string;
  enrichment_data: Record<string, unknown>;
  // New pipeline fields
  niche?: string | null;
  prospect_analysis?: string | null;
  targeted_offer?: string | null;
  identified_need?: string | null;
  priority_score?: string | null;
  enrichment_step?: string | null;
}

export interface DiscoveryRunDetails {
  generated_queries: string[];
  used_queries: string[];
  successful_queries: string[];
  attempted_keywords: string[];
  target_min_new_leads: number;
}

export interface DiscoveryOptions {
  excludeNames?: string[];
  attemptedQueries?: string[];
  attemptedKeywords?: string[];
  targetMinLeads?: number;
  log?: (msg: string) => void;
}

/**
 * Callback invoked after each enrichment step completes.
 * Used by the worker/route to persist intermediate results to the database.
 */
export type OnStepComplete = (
  stepName: string,
  partial: Partial<LeadResult> & { enrichment_step: string }
) => Promise<void>;

// ---------------------------------------------------------------------------
// Enrichment context — accumulated data passed between steps
// ---------------------------------------------------------------------------

interface Ctx {
  business_name: string;
  location: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  owner_name: string | null;
  owner_phone: string | null;
  owner_email: string | null;
  owner_role: string | null;
  has_website: boolean;
  website_url: string | null;
  facebook_url: string | null;
  instagram_url: string | null;
  linkedin_url: string | null;
  siren: string | null;
  company_type: string | null;
  creation_date: string | null;
  revenue_bracket: string | null;
  employee_count: string | null;
  follower_count: number | null;
  description: string | null;
}

// ---------------------------------------------------------------------------
// Phase 1: Discovery (Google Maps + Playwright)  — UNCHANGED
// ---------------------------------------------------------------------------

export async function runDiscovery(
  niche: string,
  location: string,
  options: DiscoveryOptions = {}
): Promise<{
  leads: LeadResult[];
  keywords: string[];
  discovery: DiscoveryRunDetails;
}> {
  let session: BrowserSession | null = null;
  const deadline = Date.now() + 240_000;
  const log = options.log || console.log;
  const excludeNames = options.excludeNames || [];
  const targetMinLeads = Math.max(
    DEFAULT_EXPAND_TARGET,
    options.targetMinLeads || DEFAULT_EXPAND_TARGET
  );
  const attemptedQuerySet = new Set(
    (options.attemptedQueries || []).map(norm)
  );
  const attemptedKeywordSet = new Set(
    (options.attemptedKeywords || []).map(norm)
  );
  const generatedQueries: string[] = [];
  const usedQueries: string[] = [];
  const successfulQueries: string[] = [];

  try {
    log("Launching browser...");
    session = await launchBrowser();

    const allLeads: LeadResult[] = [];
    const seenNames = new Set<string>(
      excludeNames.map((n) => n.toLowerCase())
    );
    let round = 0;

    while (Date.now() < deadline && round < 4) {
      round += 1;
      log(
        `[Discovery] Round ${round}: generating fresh search variations...`
      );
      const { queries, keywords } = await expandQueries(
        niche,
        location,
        excludeNames,
        {
          attemptedQueries: [...attemptedQuerySet],
          attemptedKeywords: [...attemptedKeywordSet],
          minQueries: 10,
        }
      );

      for (const kw of keywords) attemptedKeywordSet.add(norm(kw));

      const freshQueries = queries.filter((q) => {
        const n = norm(q);
        return n && !attemptedQuerySet.has(n);
      });

      generatedQueries.push(...freshQueries);

      if (freshQueries.length === 0) {
        log("[Discovery] No fresh query variants left");
        break;
      }

      log(
        `[Discovery] Trying ${freshQueries.length} fresh queries (target: ${targetMinLeads})`
      );

      for (const query of freshQueries) {
        if (Date.now() >= deadline) {
          log("[Discovery] ⏱ Time budget reached");
          break;
        }

        attemptedQuerySet.add(norm(query));
        usedQueries.push(query);

        if (!session || !isBrowserAlive(session)) {
          log("[Browser] Relaunching...");
          await safeClose(session);
          session = await launchBrowser();
        }

        let mapsLeads: MapsLead[];
        try {
          const mapsOut = await scrapeGoogleMaps(
            session.page,
            query,
            seenNames,
            log,
            5,
            Math.max(20, targetMinLeads - allLeads.length + 8),
            deadline
          );
          mapsLeads = mapsOut.leads;
          if (mapsOut.meta.blocked) {
            log(
              `[Maps] blocked (${mapsOut.meta.blocked}): ${mapsOut.meta.navigation_message || mapsOut.meta.suggested_user_action_fr || ""}`.slice(
                0,
                120
              )
            );
          }
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          log(`[Maps] ✗ ${msg.slice(0, 80)}`);
          if (msg.includes("closed") || msg.includes("Protocol error")) {
            session = null;
          }
          continue;
        }

        if (mapsLeads.length > 0) successfulQueries.push(query);

        for (const ml of mapsLeads) {
          allLeads.push({
            ...ml,
            facebook_url: null,
            instagram_url: null,
            owner_name: null,
            owner_phone: null,
            owner_email: null,
            owner_role: null,
            linkedin_url: null,
            siren: null,
            company_type: null,
            creation_date: null,
            revenue_bracket: null,
            employee_count: null,
            follower_count: null,
            website_quality: null,
            website_score: null,
            has_https: null,
            has_booking: null,
            has_chatbot: null,
            has_meta_ads: null,
            meta_ads_count: null,
            potential_score: null,
            source: "Google Maps",
            enrichment_data: {},
          });
        }

        const dedupCount = deduplicateLeads(allLeads).length;
        log(`[Discovery] Total unique: ${dedupCount}`);
        if (dedupCount >= targetMinLeads) break;
      }

      if (deduplicateLeads(allLeads).length >= targetMinLeads) break;
    }

    const dedupedLeads = deduplicateLeads(allLeads);
    log(`After deduplication: ${dedupedLeads.length} unique businesses`);

    return {
      leads: dedupedLeads,
      keywords: [...attemptedKeywordSet],
      discovery: {
        generated_queries: unique(generatedQueries),
        used_queries: unique(usedQueries),
        successful_queries: unique(successfulQueries),
        attempted_keywords: [...attemptedKeywordSet],
        target_min_new_leads: targetMinLeads,
      },
    };
  } finally {
    await safeClose(session);
  }
}

// ---------------------------------------------------------------------------
// NEW 6-Step enrichment pipeline (worker-friendly with intermediate saves)
// ---------------------------------------------------------------------------

// Vercel serverless max = 300s. With 6 steps we need tight per-step budgets.
// Step 1 (website finder) is now fast (no AI screenshots) so 45s is plenty.
// Browser-heavy steps (dirigeant, societe.com) get 60s each.
const STEP_TIMEOUT_FAST = 45_000;  // website finder, website analysis
const STEP_TIMEOUT_LONG = 60_000;  // browser-heavy research steps

/**
 * Structured 6-step lead enrichment pipeline.
 *
 * Steps:
 *   1. website_finder    — find/validate website via click-through
 *   2. website_analysis  — quality, HTTPS, booking, chatbot
 *   3. legal_data        — Pappers API + Societe.com (owner name, SIREN, legal form)
 *   4. dirigeant         — deep owner research (5-10 searches, 10 link navigations, LinkedIn)
 *   5. social_contacts   — Facebook, LinkedIn page, contact page, Ad Library
 *   6. analysis          — Gemini prospect analysis + scoring + sales brief
 *
 * After each step, `onStepComplete` is called so the worker/route can persist
 * partial results to the database immediately (no data lost on timeout/crash).
 */
export async function runSixStepEnrichment(
  lead: LeadResult,
  location: string,
  log: (msg: string) => void = console.log,
  onStepComplete?: OnStepComplete
): Promise<LeadResult> {
  log(`\n═══ 6-Step Enrichment: ${lead.business_name} (${location}) ═══`);

  // Hard deadline: save 15s buffer before Vercel kills us (maxDuration=300s)
  const HARD_DEADLINE = Date.now() + 270_000;

  lead.enrichment_data = { ...(lead.enrichment_data || {}), research_steps: {} };

  let session: BrowserSession | null = null;
  let _launchPromise: Promise<BrowserSession> | null = null;

  async function browser(): Promise<BrowserSession> {
    if (session && isBrowserAlive(session)) return session;
    if (_launchPromise) return _launchPromise;
    log("[Browser] Launching...");
    const dying = session;
    session = null;
    _launchPromise = (async () => {
      await safeClose(dying);
      const s = await launchBrowser();
      session = s;
      return s;
    })().finally(() => { _launchPromise = null; });
    return _launchPromise;
  }

  async function getPage(): Promise<Page> {
    const s = await browser();
    try { return await newPage(s); }
    catch {
      log("[Browser] Page creation failed — relaunching");
      session = null;
      return await newPage(await browser());
    }
  }

  async function closePage(p: Page) {
    try { await p.close(); } catch { /* may be dead */ }
  }

  async function runStep<T>(
    stepName: string,
    timeoutMs: number,
    fn: (page: Page) => Promise<T | null>
  ): Promise<T | null> {
    // Check hard deadline — skip step if we're running out of time
    const remaining = HARD_DEADLINE - Date.now();
    if (remaining < 10_000) {
      log(`[${stepName}] ⏱ skipped — only ${Math.round(remaining / 1000)}s left`);
      return null;
    }
    const effectiveTimeout = Math.min(timeoutMs, remaining - 5000);

    const page = await getPage();
    try {
      return await Promise.race([
        fn(page),
        new Promise<null>((resolve) =>
          setTimeout(() => {
            log(`[${stepName}] ⏱ timeout (${Math.round(effectiveTimeout / 1000)}s)`);
            resolve(null);
          }, effectiveTimeout)
        ),
      ]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log(`[${stepName}] ✗ ${msg.slice(0, 100)}`);
      if (msg.includes("closed") || msg.includes("Target closed") || msg.includes("Protocol error")) {
        session = null;
      }
      return null;
    } finally {
      await closePage(page);
    }
  }

  async function save(stepName: string, partial: Partial<LeadResult>) {
    // Always MERGE enrichment_data — never overwrite accumulated fields
    let mergedPartial = partial;
    if (partial.enrichment_data) {
      const merged = { ...lead.enrichment_data, ...partial.enrichment_data };
      mergedPartial = { ...partial, enrichment_data: merged };
    }

    const update = { ...mergedPartial, enrichment_step: stepName };
    Object.assign(lead, mergedPartial);
    lead.enrichment_step = stepName;
    record(lead, stepName, mergedPartial);
    if (onStepComplete) {
      try { await onStepComplete(stepName, update as Partial<LeadResult> & { enrichment_step: string }); }
      catch (e) { log(`[Save] ✗ ${e instanceof Error ? e.message : e}`); }
    }
  }

  try {
    // ── STEP 1: Website Finder ─────────────────────────────────────────────
    log(`\n[Step 1/6] Website Finder...`);
    const websiteResult = await runStep("website_finder", STEP_TIMEOUT_FAST, (page) =>
      findWebsite(page, lead.business_name, location, lead.website_url, log, lead.google_maps_url)
    );

    if (websiteResult) {
      const websiteEnrichmentData: Record<string, unknown> = {
        website_type: websiteResult.website_type,
        website_found_via: websiteResult.found_via,
        website_confidence: websiteResult.confidence,
      };
      if (websiteResult.platform_url) {
        websiteEnrichmentData.platform_url = websiteResult.platform_url;
        websiteEnrichmentData.platform_label = websiteResult.platform_label;
      }

      await save("website_finder", {
        has_website: websiteResult.has_website,
        website_url: websiteResult.website_url,
        enrichment_data: websiteEnrichmentData,
      });

      if (websiteResult.platform_url) {
        log(
          `[Step 1/6] Platform found: ${websiteResult.platform_label} — ${websiteResult.platform_url.slice(0, 50)}`
        );
      }
    } else {
      await save("website_finder", { has_website: lead.has_website, website_url: lead.website_url });
    }

    // ── STEP 2: Website Analysis ──────────────────────────────────────────
    log(`\n[Step 2/6] Website Analysis...`);
    if (lead.has_website && lead.website_url) {
      // HTTP check (fast, no browser)
      const httpResult = await quickHttpCheck(lead.website_url, log);
      if (httpResult) {
        lead.has_https = httpResult.has_https;
        if (!httpResult.is_alive) lead.website_quality = "dead";
      }

      const webResult = await runStep("website_analysis", STEP_TIMEOUT_FAST, (page) =>
        deepCheckWebsite(page, lead.website_url!, lead.business_name, log)
      );

      if (webResult) {
        await save("website_analysis", {
          website_quality: webResult.quality,
          website_score: webResult.score,
          has_https: webResult.has_https,
          has_booking: webResult.has_booking,
          has_chatbot: webResult.has_chatbot,
        });
      }

      // PageSpeed (async, no browser)
      const ps = await fetchPageSpeedScore(lead.website_url, log).catch(() => null);
      if (ps !== null && lead.website_score != null) {
        lead.website_score = Math.round(lead.website_score * 0.6 + ps * 0.4);
      }
    } else {
      lead.website_quality = "none";
      lead.website_score = 0;
      lead.has_https = false;
      lead.has_booking = false;
      lead.has_chatbot = false;
      await save("website_analysis", {
        website_quality: "none",
        website_score: 0,
        has_https: false,
        has_booking: false,
        has_chatbot: false,
      });
    }

    // ── STEP 3: Legal Data — Pappers API + Societe.com API in parallel, then
    // browser scrape only if no API key or Societe API did not return a person dirigeant
    log(`\n[Step 3/6] Legal Data (Pappers + Societe.com API in parallel)...`);

    const [pappers, societeApi] = await Promise.all([
      searchPappersApi(lead.business_name, location, log),
      searchSocieteComApi(lead.business_name, location, log),
    ]);

    // Merge: Pappers first, Societe.com API fills gaps (esp. dirigeant PP when Pappers has none)
    if (isPappersApiError(pappers)) {
      log(`[Pappers] ${pappers.error}`);
    } else if (pappers) {
      lead.owner_name = lead.owner_name || pappers.owner_name;
      lead.owner_role = lead.owner_role || pappers.owner_role;
      lead.siren = lead.siren || pappers.siren;
      lead.company_type = lead.company_type || pappers.company_type;
      lead.creation_date = lead.creation_date || pappers.creation_date;
      lead.employee_count = lead.employee_count || pappers.employee_count;
      lead.address = lead.address || pappers.address;
    }
    if (isSocieteComApiError(societeApi)) {
      log(`[Societe API] ${societeApi.error}`);
    } else if (societeApi) {
      lead.owner_name = lead.owner_name || societeApi.owner_name;
      lead.owner_role = lead.owner_role || societeApi.owner_role;
      lead.siren = lead.siren || societeApi.siren;
      lead.company_type = lead.company_type || societeApi.company_type;
      lead.creation_date = lead.creation_date || societeApi.creation_date;
      lead.employee_count = lead.employee_count || societeApi.employee_count;
      lead.address = lead.address || societeApi.address;
      lead.revenue_bracket = lead.revenue_bracket || societeApi.revenue_bracket;
      if (societeApi.website_url && !lead.website_url) {
        lead.website_url = societeApi.website_url;
        lead.has_website = true;
      }
      if (societeApi.naf_code || societeApi.capital) {
        lead.enrichment_data = {
          ...lead.enrichment_data,
          naf_code: (lead.enrichment_data?.naf_code as string) || societeApi.naf_code,
          capital: (lead.enrichment_data?.capital as string) || societeApi.capital,
        };
      }
    }

    const societeOk =
      societeApi && !isSocieteComApiError(societeApi) ? societeApi : null;
    const needSocieteBrowser =
      !hasSocieteComApiKey() || !societeOk?.owner_name?.trim();

    if (needSocieteBrowser) {
      const societeBrowser = await runStep("legal_data", STEP_TIMEOUT_LONG, (page) =>
        searchSocieteCom(page, lead.business_name, location, lead.address, log)
      );
      if (societeBrowser) {
        lead.owner_name = lead.owner_name || societeBrowser.owner_name;
        lead.owner_role = lead.owner_role || societeBrowser.owner_role;
        lead.siren = lead.siren || societeBrowser.siren;
        lead.company_type = lead.company_type || societeBrowser.company_type;
        lead.creation_date = lead.creation_date || societeBrowser.creation_date;
        lead.employee_count = lead.employee_count || societeBrowser.employee_count;
        lead.address = lead.address || societeBrowser.address;
        lead.revenue_bracket = lead.revenue_bracket || societeBrowser.revenue_bracket;
        if (societeBrowser.website_url && !lead.website_url) {
          lead.website_url = societeBrowser.website_url;
          lead.has_website = true;
        }
      }
    }

    await save("legal_data", {
      owner_name: lead.owner_name,
      owner_role: lead.owner_role,
      siren: lead.siren,
      company_type: lead.company_type,
      creation_date: lead.creation_date,
      employee_count: lead.employee_count,
      address: lead.address,
      revenue_bracket: lead.revenue_bracket,
    });

    // ── STEP 4: Dirigeant Research ────────────────────────────────────────
    log(`\n[Step 4/6] Dirigeant Research${lead.owner_name ? ` (${lead.owner_name})` : ""}...`);
    const dirigeant = await runStep("dirigeant", STEP_TIMEOUT_LONG, (page) =>
      researchDirigeant(
        page,
        lead.owner_name,
        lead.business_name,
        location,
        lead.niche || null,
        log
      )
    );

    if (dirigeant) {
      await save("dirigeant", {
        owner_name: dirigeant.owner_name || lead.owner_name,
        owner_phone: dirigeant.owner_phone,
        owner_email: dirigeant.owner_email,
        owner_role: dirigeant.owner_role || lead.owner_role,
        linkedin_url: dirigeant.linkedin_url,
        enrichment_data: {
          ...lead.enrichment_data,
          linkedin_summary: dirigeant.linkedin_summary,
          linkedin_headline: dirigeant.linkedin_headline,
          related_contacts: dirigeant.related_contacts,
        },
      });
    }

    // ── STEP 5: Social Presence + Contact Page + Ad Library ───────────────
    log(`\n[Step 5/6] Social Presence + Ad Library...`);

    const [google, pj] = await Promise.all([
      runStep("google_search", 45_000, (page) =>
        searchGoogle(page, lead.business_name, location, lead.phone, lead.address, log)
      ),
      runStep("pages_jaunes", 45_000, (page) =>
        searchPagesJaunes(page, lead.business_name, location, lead.phone, log)
      ),
    ]);

    if (google) {
      lead.phone = lead.phone || google.phone;
      lead.email = lead.email || google.email;
      lead.owner_name = lead.owner_name || google.owner_name;
      lead.facebook_url = lead.facebook_url || google.facebook_url;
      lead.instagram_url = lead.instagram_url || google.instagram_url;
      lead.description = lead.description || google.extra_description;
      if (google.has_real_website && google.website_url && !lead.website_url) {
        lead.has_website = true;
        lead.website_url = google.website_url;
      }
    }
    if (pj != null && hasPagesJaunesData(pj)) {
      lead.phone = lead.phone || pj.phone;
      lead.email = lead.email || pj.email;
      lead.address = lead.address || pj.address;
      lead.owner_name = lead.owner_name || pj.owner_name;
      if (pj.website_url && !lead.website_url) {
        lead.has_website = true;
        lead.website_url = pj.website_url;
      }
    }

    const [fb, ads, contactPage] = await Promise.all([
      runStep("facebook", 45_000, (page) =>
        searchFacebook(page, lead.business_name, location, lead.owner_name, log)
      ),
      runStep("ad_library", 45_000, (page) =>
        checkFbAdLibrary(page, lead.business_name, location, lead.facebook_url, log)
      ),
      lead.has_website && lead.website_url
        ? runStep("contact_page", 45_000, (page) =>
            scrapContactPage(page, lead.website_url!, lead.business_name, log)
          )
        : Promise.resolve(null),
    ]);

    if (fb) {
      lead.facebook_url = lead.facebook_url || fb.facebook_url;
      lead.phone = lead.phone || fb.phone;
      lead.email = lead.email || fb.email;
      lead.instagram_url = lead.instagram_url || fb.instagram_url;
      lead.follower_count = lead.follower_count || fb.follower_count;
    }
    if (ads) {
      lead.has_meta_ads = ads.has_ads;
      lead.meta_ads_count = ads.ad_count;
    } else {
      lead.has_meta_ads = lead.has_meta_ads ?? false;
      lead.meta_ads_count = lead.meta_ads_count ?? 0;
    }
    if (contactPage) {
      lead.email = lead.email || contactPage.email;
      lead.phone = lead.phone || contactPage.phone;
    }

    await save("social_contacts", {
      phone: lead.phone,
      email: lead.email,
      facebook_url: lead.facebook_url,
      instagram_url: lead.instagram_url,
      follower_count: lead.follower_count,
      has_meta_ads: lead.has_meta_ads,
      meta_ads_count: lead.meta_ads_count,
      description: lead.description,
    });

    // ── STEP 6: Prospect Analysis + Scoring ───────────────────────────────
    log(`\n[Step 6/6] Prospect Analysis + Scoring...`);
    const score = computeLeadScore(lead);
    lead.potential_score = score;

    const analysis = await analyzeProspect(lead, location, log);
    const salesBrief = await generateSalesBrief(lead, log).catch(() => null);

    await save("analysis", {
      potential_score: score,
      prospect_analysis: analysis.prospect_analysis,
      targeted_offer: analysis.targeted_offer,
      identified_need: analysis.identified_need,
      priority_score: analysis.priority_score,
      enrichment_data: {
        ...lead.enrichment_data,
        sales_brief: salesBrief,
      },
    });

    updateChecklist(lead);

    log(`\n✓ ${lead.business_name} — 6 steps complete | score: ${score}/100 | priority: ${analysis.priority_score}`);

    return lead;
  } finally {
    await safeClose(session);
  }
}

// ---------------------------------------------------------------------------
// Phase 2a: Fast enrichment — structured APIs only, no browser (~5-15 s)
// ---------------------------------------------------------------------------

/**
 * Phase A: runs all API/HTTP calls in parallel with no browser.
 * Returns a partially-enriched lead that can be saved to DB immediately,
 * giving the employee owner + legal data even if Phase B times out.
 */
export async function runEnrichmentPhaseA(
  lead: LeadResult,
  location: string,
  log: (msg: string) => void = console.log
): Promise<LeadResult> {
  log(`[Phase A] Pappers + Societe.com API + HTTP check + PageSpeed...`);

  const [pappers, societeApi, httpCheck, ps] = await Promise.all([
    searchPappersApi(lead.business_name, location, log),
    searchSocieteComApi(lead.business_name, location, log),
    lead.has_website && lead.website_url
      ? quickHttpCheck(lead.website_url, log)
      : Promise.resolve(null),
    lead.has_website && lead.website_url
      ? fetchPageSpeedScore(lead.website_url, log)
      : Promise.resolve(null),
  ]);

  // Merge Pappers data — primary source for legal/owner info
  if (isPappersApiError(pappers)) {
    log(`[Phase A] Pappers: ${pappers.error}`);
    record(lead, "pappers_api", {
      error: pappers.error,
      code: pappers.code,
      http_status: pappers.http_status,
    });
  } else if (pappers) {
    record(lead, "pappers_api", pappers);
    lead.owner_name = lead.owner_name || pappers.owner_name;
    lead.owner_role = lead.owner_role || pappers.owner_role;
    lead.siren = lead.siren || pappers.siren;
    lead.company_type = lead.company_type || pappers.company_type;
    lead.creation_date = lead.creation_date || pappers.creation_date;
    lead.employee_count = lead.employee_count || pappers.employee_count;
    lead.address = lead.address || pappers.address;
    if (pappers.naf_code || pappers.capital) {
      lead.enrichment_data = {
        ...lead.enrichment_data,
        naf_code: pappers.naf_code,
        capital: pappers.capital,
      };
    }
  } else {
    record(lead, "pappers_api", null, "no_match");
  }

  // Societe.com API — fills dirigeant when Pappers search has no PP data
  if (isSocieteComApiError(societeApi)) {
    log(`[Phase A] Societe API: ${societeApi.error}`);
    record(lead, "societe_api", {
      error: societeApi.error,
      code: societeApi.code,
      http_status: societeApi.http_status,
    });
  } else if (societeApi) {
    record(lead, "societe_api", societeApi);
    lead.owner_name = lead.owner_name || societeApi.owner_name;
    lead.owner_role = lead.owner_role || societeApi.owner_role;
    lead.siren = lead.siren || societeApi.siren;
    lead.company_type = lead.company_type || societeApi.company_type;
    lead.creation_date = lead.creation_date || societeApi.creation_date;
    lead.employee_count = lead.employee_count || societeApi.employee_count;
    lead.address = lead.address || societeApi.address;
    if (societeApi.naf_code || societeApi.capital) {
      lead.enrichment_data = {
        ...lead.enrichment_data,
        naf_code: (lead.enrichment_data?.naf_code as string) || societeApi.naf_code,
        capital: (lead.enrichment_data?.capital as string) || societeApi.capital,
      };
    }
  } else if (hasSocieteComApiKey()) {
    record(lead, "societe_api", null, "no_match");
  }

  // Merge HTTP check
  if (httpCheck) {
    record(lead, "http_check", httpCheck);
    if (httpCheck.is_alive) {
      lead.has_website = true;
      lead.has_https = httpCheck.has_https;
    } else if (!httpCheck.is_alive && lead.has_website) {
      // Site was found in Maps but is now dead — keep has_website: true for
      // the deep check to confirm; just note the HTTP failure
    }
  }

  // Merge PageSpeed (partial — will be refined in Phase B after deep website check)
  if (ps !== null) {
    record(lead, "pagespeed_quick", { score: ps });
    lead.website_score = ps;
  }

  log(
    `[Phase A] ✓ owner:${lead.owner_name || "—"} | SIREN:${lead.siren || "—"} | HTTPS:${lead.has_https ?? "?"} | PageSpeed:${lead.website_score ?? "—"}`
  );

  return lead;
}

// ---------------------------------------------------------------------------
// Phase 2b: Deep enrichment — Playwright waves
// ---------------------------------------------------------------------------

const STEP_TIMEOUT_MS = 45_000;

/**
 * Phase B: browser-based enrichment in 4 parallel waves.
 * Accepts the partially-enriched lead from Phase A so that owner name and
 * other already-known data are available immediately to all waves.
 */
export async function runEnrichmentPhaseB(
  lead: LeadResult,
  location: string,
  log: (msg: string) => void = console.log
): Promise<LeadResult> {
  log(`\n[Phase B] Starting browser waves for: ${lead.business_name}`);

  const ctx: Ctx = {
    business_name: lead.business_name,
    location,
    phone: lead.phone,
    email: lead.email,
    address: lead.address,
    // Phase A data already pre-populated
    owner_name: lead.owner_name,
    owner_phone: lead.owner_phone,
    owner_email: lead.owner_email,
    owner_role: lead.owner_role,
    has_website: lead.has_website,
    website_url: lead.website_url,
    facebook_url: lead.facebook_url,
    instagram_url: lead.instagram_url,
    linkedin_url: lead.linkedin_url,
    siren: lead.siren,
    company_type: lead.company_type,
    creation_date: lead.creation_date,
    revenue_bracket: lead.revenue_bracket,
    employee_count: lead.employee_count,
    follower_count: lead.follower_count,
    description: lead.description,
  };

  let session: BrowserSession | null = null;
  let _launchPromise: Promise<BrowserSession> | null = null;

  async function browser(): Promise<BrowserSession> {
    if (session && isBrowserAlive(session)) return session;
    if (_launchPromise) return _launchPromise;
    log("[Browser] Launching...");
    const dying = session;
    session = null;
    _launchPromise = (async () => {
      await safeClose(dying);
      const s = await launchBrowser();
      session = s;
      return s;
    })().finally(() => {
      _launchPromise = null;
    });
    return _launchPromise;
  }

  async function getPage(): Promise<Page> {
    const s = await browser();
    try {
      return await newPage(s);
    } catch {
      log("[Browser] Page creation failed — relaunching");
      session = null;
      const fresh = await browser();
      return await newPage(fresh);
    }
  }

  async function closePage(p: Page) {
    try {
      await p.close();
    } catch {
      /* may already be dead */
    }
  }

  async function step<T>(
    name: string,
    fn: (page: Page) => Promise<T | null>
  ): Promise<T | null> {
    const page = await getPage();
    try {
      return await Promise.race([
        fn(page),
        new Promise<null>((resolve) =>
          setTimeout(() => {
            log(`[${name}] ⏱ timeout (${STEP_TIMEOUT_MS / 1000}s)`);
            resolve(null);
          }, STEP_TIMEOUT_MS)
        ),
      ]);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log(`[${name}] ✗ ${msg.slice(0, 100)}`);
      if (
        msg.includes("closed") ||
        msg.includes("Target closed") ||
        msg.includes("Protocol error")
      ) {
        session = null;
      }
      return null;
    } finally {
      await closePage(page);
    }
  }

  try {
    // ── Wave 1: Google Search + PagesJaunes (parallel, 2 pages) ──
    log(`[Wave 1/4] Google Search + PagesJaunes...`);
    const [google, pj] = await Promise.all([
      step("Google", (p) =>
        searchGoogle(p, ctx.business_name, location, ctx.phone, ctx.address, log)
      ),
      step("PagesJaunes", (p) =>
        searchPagesJaunes(p, ctx.business_name, location, ctx.phone, log)
      ),
    ]);

    record(lead, "google", google);
    record(
      lead,
      "pages_jaunes",
      pj != null && hasPagesJaunesData(pj)
        ? {
            phone: pj.phone,
            email: pj.email,
            address: pj.address,
            website_url: pj.website_url,
            owner_name: pj.owner_name,
            category: pj.category,
          }
        : null,
    );

    if (google) {
      if (google.has_real_website && google.website_url) {
        ctx.has_website = true;
        ctx.website_url = google.website_url;
      } else if (!google.has_real_website) {
        ctx.has_website = false;
      }
      ctx.phone = ctx.phone || google.phone;
      ctx.email = ctx.email || google.email;
      ctx.owner_name = ctx.owner_name || google.owner_name;
      ctx.facebook_url = ctx.facebook_url || google.facebook_url;
      ctx.instagram_url = ctx.instagram_url || google.instagram_url;
      ctx.description = ctx.description || google.extra_description;
    }
    if (pj != null && hasPagesJaunesData(pj)) {
      ctx.phone = ctx.phone || pj.phone;
      ctx.email = ctx.email || pj.email;
      ctx.address = ctx.address || pj.address;
      ctx.owner_name = ctx.owner_name || pj.owner_name;
      if (pj.website_url && !ctx.website_url) {
        ctx.has_website = true;
        ctx.website_url = pj.website_url;
      }
    }

    // ── Wave 2: Facebook + LinkedIn (parallel, 2 pages, uses owner from Phase A/Wave 1) ──
    log(
      `[Wave 2/4] Facebook + LinkedIn${ctx.owner_name ? ` (${ctx.owner_name})` : ""}...`
    );
    const [fb, li] = await Promise.all([
      step("Facebook", (p) =>
        searchFacebook(p, ctx.business_name, location, ctx.owner_name, log)
      ),
      step("LinkedIn", (p) =>
        searchLinkedIn(p, ctx.business_name, location, ctx.owner_name, log)
      ),
    ]);

    record(lead, "facebook", fb);
    record(lead, "linkedin", li);

    if (fb) {
      ctx.facebook_url = ctx.facebook_url || fb.facebook_url;
      ctx.phone = ctx.phone || fb.phone;
      ctx.email = ctx.email || fb.email;
      ctx.instagram_url = ctx.instagram_url || fb.instagram_url;
      ctx.follower_count = ctx.follower_count || fb.follower_count;
      ctx.address = ctx.address || fb.address;
      ctx.owner_name = ctx.owner_name || fb.owner_name;
      ctx.description = ctx.description || fb.description;
      if (fb.website_url && !ctx.website_url) {
        ctx.has_website = true;
        ctx.website_url = fb.website_url;
      }
    }
    if (li) {
      ctx.linkedin_url = li.linkedin_url;
      ctx.owner_name = ctx.owner_name || li.owner_name;
      ctx.owner_email = ctx.owner_email || li.email;
      ctx.phone = ctx.phone || li.phone;
    }

    // ── Wave 3: Owner phone + Deep website check + Contact page scraper (3 pages) ──
    log(
      `[Wave 3/4] Owner phone${ctx.owner_name ? ` (${ctx.owner_name})` : " — skip"} + Website check${ctx.website_url ? "" : " — skip"} + Contact page...`
    );
    const [ownerResult, webCheckResult, contactPageResult] = await Promise.all([
      ctx.owner_name
        ? step("OwnerPhone", (p) =>
            searchOwnerPhone(p, ctx.owner_name!, ctx.business_name, location, log)
          )
        : Promise.resolve(null),
      ctx.has_website && ctx.website_url
        ? step("WebCheck", (p) =>
            deepCheckWebsite(p, ctx.website_url!, ctx.business_name, log)
          )
        : Promise.resolve(null),
      ctx.has_website && ctx.website_url
        ? step("ContactPage", (p) =>
            scrapContactPage(p, ctx.website_url!, ctx.business_name, log)
          )
        : Promise.resolve(null),
    ]);

    if (ctx.owner_name) {
      record(lead, "owner_contact", ownerResult);
      if (ownerResult) {
        ctx.owner_phone = ownerResult.owner_phone;
        ctx.owner_email = ctx.owner_email || ownerResult.owner_email;
      }
    } else {
      record(lead, "owner_contact", null, "owner_name_missing");
    }

    if (ctx.has_website && ctx.website_url) {
      record(lead, "website_quality", webCheckResult);
      if (webCheckResult) {
        lead.website_quality = webCheckResult.quality;
        lead.website_score = webCheckResult.score;
        // Override HTTPS with Playwright DOM signal (more accurate than HEAD)
        lead.has_https = webCheckResult.has_https;
        lead.has_booking = webCheckResult.has_booking;
        lead.has_chatbot = webCheckResult.has_chatbot;
        if (webCheckResult.is_just_social) {
          ctx.has_website = false;
          lead.website_quality = "none";
          lead.website_score = 0;
        }
      }
    } else {
      lead.website_quality = "none";
      lead.website_score = 0;
      lead.has_https = lead.has_https ?? false;
      lead.has_booking = false;
      lead.has_chatbot = false;
      record(lead, "website_quality", null, "website_missing");
    }

    // Merge contact page results — fill gaps only, don't overwrite existing data
    record(lead, "contact_page", contactPageResult);
    if (contactPageResult) {
      ctx.email = ctx.email || contactPageResult.email;
      ctx.phone = ctx.phone || contactPageResult.phone;
    }

    // ── Wave 4: Ad Library (1 page) + PageSpeed refinement ──
    log(`[Wave 4/4] Ad Library + PageSpeed...`);
    const [ads, psRefined] = await Promise.all([
      step("AdLibrary", (p) =>
        checkFbAdLibrary(p, ctx.business_name, location, ctx.facebook_url, log)
      ),
      // Re-fetch PageSpeed now that we have a confirmed website URL from browser waves
      ctx.has_website && ctx.website_url && ctx.website_url !== lead.website_url
        ? fetchPageSpeedScore(ctx.website_url, log)
        : Promise.resolve(null),
    ]);

    record(lead, "ad_library", ads);
    if (ads) {
      lead.has_meta_ads = ads.has_ads;
      lead.meta_ads_count = ads.ad_count;
    } else {
      lead.has_meta_ads = false;
      lead.meta_ads_count = 0;
    }

    // Blend PageSpeed into website score when available
    if (ctx.has_website && ctx.website_url) {
      const psScore = psRefined ?? (lead.website_score != null && lead.website_score > 0 ? null : null);
      if (psScore !== null) {
        record(lead, "pagespeed", { score: psScore });
        if (lead.website_score != null) {
          lead.website_score = Math.round(lead.website_score * 0.6 + psScore * 0.4);
        }
      }
    } else {
      record(lead, "pagespeed", null, "website_missing");
    }

    // ── Write context back to lead ──
    writeCtx(lead, ctx);
    updateChecklist(lead);

    // Summary log
    const found = [
      ctx.phone && "phone",
      ctx.email && "email",
      ctx.owner_name && `owner:${ctx.owner_name}`,
      ctx.owner_phone && "owner_phone",
      ctx.linkedin_url && "LinkedIn",
      ctx.siren && `SIREN:${ctx.siren}`,
      ctx.facebook_url && "FB",
      ctx.instagram_url && "IG",
      lead.website_quality &&
        lead.website_quality !== "none" &&
        `web:${lead.website_quality}(${lead.website_score})`,
      lead.has_meta_ads && `${lead.meta_ads_count}ads`,
      lead.has_booking && "booking",
      lead.has_chatbot && "chatbot",
    ]
      .filter(Boolean)
      .join(", ");
    log(`\n✓ ${lead.business_name} — ${found || "basic info only"}\n`);

    return lead;
  } finally {
    await safeClose(session);
  }
}

// ---------------------------------------------------------------------------
// Phase 2: Single-lead enrichment — runs Phase A + B + scoring
// ---------------------------------------------------------------------------

/**
 * Full single-lead enrichment: Phase A (APIs) → Phase B (browser) → scoring.
 * The route handler calls runEnrichmentPhaseA separately so it can do an
 * intermediate DB save; this function is kept for batch/pipeline usage.
 */
export async function runSingleLeadEnrichment(
  lead: LeadResult,
  location: string,
  log: (msg: string) => void = console.log
): Promise<LeadResult> {
  lead.enrichment_data = { research_steps: {} };
  log(`\n═══ Enriching: ${lead.business_name} ═══`);
  const partial = await runEnrichmentPhaseA(lead, location, log);
  const full = await runEnrichmentPhaseB(partial, location, log);
  // Score
  full.potential_score = computeLeadScore(full);
  full.enrichment_data = {
    ...full.enrichment_data,
    sales_brief: await generateSalesBrief(full, log).catch(() => null),
  };
  return full;
}

// ---------------------------------------------------------------------------
// Batch enrichment (for full pipeline use)
// ---------------------------------------------------------------------------

export async function runEnrichment(
  leads: LeadResult[],
  location: string,
  log: (msg: string) => void = console.log
): Promise<LeadResult[]> {
  log(`Enriching ${leads.length} leads...`);
  for (let i = 0; i < leads.length; i++) {
    log(`\n[${i + 1}/${leads.length}]`);
    await runSingleLeadEnrichment(leads[i], location, log);
  }
  return leads;
}

// ---------------------------------------------------------------------------
// Full pipeline: discovery + enrichment in one go
// ---------------------------------------------------------------------------

export async function runFullPipeline(
  niche: string,
  location: string,
  excludeNames: string[] = [],
  log: (msg: string) => void = console.log
): Promise<{ leads: LeadResult[]; keywords: string[] }> {
  const { leads, keywords } = await runDiscovery(niche, location, {
    excludeNames,
    log,
  });

  if (leads.length === 0) {
    log("No leads found during discovery");
    return { leads: [], keywords };
  }

  const enrichedLeads = await runEnrichment(leads, location, log);

  log(`\n═══ Pipeline complete ═══`);
  log(`Total leads: ${enrichedLeads.length}`);

  return { leads: enrichedLeads, keywords };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function writeCtx(lead: LeadResult, ctx: Ctx) {
  lead.phone = ctx.phone;
  lead.email = ctx.email;
  lead.address = ctx.address;
  lead.description = ctx.description;
  lead.has_website = ctx.has_website;
  lead.website_url = ctx.website_url;
  lead.facebook_url = ctx.facebook_url;
  lead.instagram_url = ctx.instagram_url;
  lead.owner_name = ctx.owner_name;
  lead.owner_phone = ctx.owner_phone;
  lead.owner_email = ctx.owner_email;
  lead.owner_role = ctx.owner_role;
  lead.linkedin_url = ctx.linkedin_url;
  lead.siren = ctx.siren;
  lead.company_type = ctx.company_type;
  lead.creation_date = ctx.creation_date;
  lead.revenue_bracket = ctx.revenue_bracket;
  lead.employee_count = ctx.employee_count;
  lead.follower_count = ctx.follower_count;
  if (!lead.website_quality) {
    lead.website_quality = ctx.has_website ? null : "none";
    lead.website_score = ctx.has_website ? null : 0;
  }
}

function record(
  lead: LeadResult,
  stepName: string,
  result: unknown,
  skipReason?: string
) {
  const current = lead.enrichment_data || {};
  const steps =
    current.research_steps &&
    typeof current.research_steps === "object" &&
    !Array.isArray(current.research_steps)
      ? (current.research_steps as Record<string, unknown>)
      : {};

  if (skipReason) {
    steps[stepName] = { status: "skipped", reason: skipReason };
  } else if (result) {
    const fields = collectFields(result as Record<string, unknown>);
    steps[stepName] = { status: "completed", fields_found: fields };
  } else {
    steps[stepName] = { status: "no_match", fields_found: [] };
  }

  lead.enrichment_data = { ...current, research_steps: steps };
}

function updateChecklist(lead: LeadResult) {
  const current = lead.enrichment_data || {};
  lead.enrichment_data = {
    ...current,
    research_checklist: {
      business_contact: Boolean(
        lead.phone || lead.email || lead.website_url
      ),
      legal_identity: Boolean(
        lead.siren ||
          lead.company_type ||
          lead.creation_date ||
          lead.revenue_bracket
      ),
      owner_identity: Boolean(lead.owner_name || lead.owner_role),
      owner_contact: Boolean(lead.owner_phone || lead.owner_email),
      linkedin: Boolean(lead.linkedin_url),
      social_presence: Boolean(lead.facebook_url || lead.instagram_url),
      website_quality: Boolean(
        lead.website_quality ||
          lead.website_score ||
          lead.has_https !== null
      ),
    },
  };
}

function collectFields(obj: Record<string, unknown>): string[] {
  return Object.entries(obj)
    .filter(([, v]) => {
      if (Array.isArray(v)) return v.length > 0;
      return v !== null && v !== undefined && v !== false && v !== "";
    })
    .map(([k]) => k);
}

function unique(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const v of values) {
    const t = v?.trim();
    if (!t) continue;
    const n = t.toLowerCase();
    if (seen.has(n)) continue;
    seen.add(n);
    result.push(t);
  }
  return result;
}

function norm(value: string): string {
  return value.trim().toLowerCase();
}
