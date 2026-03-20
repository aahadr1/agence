import type { Page } from "playwright-core";
import {
  launchBrowser,
  closeBrowser,
  newPage,
  isBrowserAlive,
  safeClose,
  type BrowserSession,
} from "./browser";
import { expandQueries } from "./query-expander";
import { scrapeGoogleMaps } from "./sources/google-maps";
import { searchGoogle } from "./sources/google-search";
import { searchPagesJaunes } from "./sources/pages-jaunes";
import { searchFacebook } from "./sources/facebook";
import { searchSocieteCom } from "./sources/societe-com";
import { searchLinkedIn } from "./sources/linkedin";
import { searchOwnerPhone } from "./enrichment/owner-search";
import { checkWebsite } from "./enrichment/website-checker";
import { deduplicateLeads } from "./deduplicator";

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
  source: string;
  enrichment_data: Record<string, unknown>;
}

/**
 * Enrichment context — accumulated data passed between steps.
 * Each step can read what previous steps found and use it
 * to refine its searches (e.g., owner name from Societe.com
 * feeds into LinkedIn search).
 */
interface EnrichmentContext {
  business_name: string;
  location: string;
  // Accumulated from all steps
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

/**
 * Phase 1: Discovery — find all businesses via Google Maps with query variations.
 */
export async function runDiscovery(
  niche: string,
  location: string,
  excludeNames: string[] = [],
  log: (msg: string) => void = console.log
): Promise<{ leads: LeadResult[]; keywords: string[] }> {
  let session: BrowserSession | null = null;

  try {
    log("Generating search variations with AI...");
    const { queries, keywords } = await expandQueries(
      niche,
      location,
      excludeNames
    );
    log(
      `Generated ${queries.length} query variations: ${queries.join(" | ")}`
    );

    log("Launching browser...");
    session = await launchBrowser();

    const allLeads: LeadResult[] = [];
    const seenNames = new Set<string>(
      excludeNames.map((n) => n.toLowerCase())
    );

    for (const query of queries) {
      // Ensure browser is alive before each query
      if (!session || !isBrowserAlive(session)) {
        log("[Browser] Relaunching for next query...");
        await safeClose(session);
        session = await launchBrowser();
      }

      let mapsLeads;
      try {
        mapsLeads = await scrapeGoogleMaps(
          session.page,
          query,
          seenNames,
          log,
          3,
          20
        );
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        log(`[Maps] ✗ Query failed: ${msg}`);
        if (msg.includes("closed") || msg.includes("Protocol error")) {
          session = null; // force relaunch on next iteration
        }
        continue;
      }

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
          source: "Google Maps",
          enrichment_data: {},
        });
      }

      log(`Total unique leads so far: ${allLeads.length}`);
    }

    const dedupedLeads = deduplicateLeads(allLeads);
    log(`After deduplication: ${dedupedLeads.length} unique businesses`);

    return { leads: dedupedLeads, keywords };
  } finally {
    await safeClose(session);
  }
}

/**
 * Phase 2: Deep enrichment — cross-reference each lead across all sources.
 * Uses an EnrichmentContext to reliably pass data between steps.
 *
 * Step order:
 * 1. Google Search (multi-query) — website, contacts, social profiles
 * 2. PagesJaunes (multi-query) — phone, email, address
 * 3. Facebook (multi-query) — social presence, followers, owner hints
 * 4. Societe.com / Pappers — owner name, SIREN, legal info
 * 5. LinkedIn — owner profile, title (uses owner name from step 4)
 * 6. Owner phone search — personal phone (uses owner name from step 4/5)
 * 7. Website quality check — evaluate site quality
 */
export async function runEnrichment(
  leads: LeadResult[],
  location: string,
  log: (msg: string) => void = console.log
): Promise<LeadResult[]> {
  let session: BrowserSession | null = null;

  /** Ensure we have a living browser; relaunch if dead */
  async function ensureBrowser(): Promise<BrowserSession> {
    if (session && isBrowserAlive(session)) return session;
    log("[Browser] Relaunching browser...");
    await safeClose(session);
    session = await launchBrowser();
    return session;
  }

  /** Run a single enrichment step with its own error handling.
   *  If the browser dies mid-step, returns null instead of crashing. */
  async function runStep<T>(
    label: string,
    fn: () => Promise<T | null>
  ): Promise<T | null> {
    try {
      return await fn();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // Detect browser-died errors
      if (
        msg.includes("has been closed") ||
        msg.includes("Target closed") ||
        msg.includes("Session closed") ||
        msg.includes("Connection closed") ||
        msg.includes("Protocol error")
      ) {
        log(`[${label}] ✗ Browser crashed — will relaunch for next lead`);
        // Mark session as dead so ensureBrowser relaunches
        session = null;
        return null;
      }
      log(`[${label}] ✗ ${msg}`);
      return null;
    }
  }

  try {
    log(`Enriching ${leads.length} leads across 7 sources...`);
    session = await launchBrowser();

    for (let i = 0; i < leads.length; i++) {
      const lead = leads[i];
      log(
        `\n[${i + 1}/${leads.length}] ═══ Enriching: ${lead.business_name} ═══`
      );

      // Initialize enrichment context from discovery data
      const ctx: EnrichmentContext = {
        business_name: lead.business_name,
        location,
        phone: lead.phone,
        email: lead.email,
        address: lead.address,
        owner_name: lead.owner_name,
        owner_phone: null,
        owner_email: null,
        owner_role: null,
        has_website: lead.has_website,
        website_url: lead.website_url,
        facebook_url: lead.facebook_url,
        instagram_url: lead.instagram_url,
        linkedin_url: null,
        siren: null,
        company_type: null,
        creation_date: null,
        revenue_bracket: null,
        employee_count: null,
        follower_count: lead.follower_count,
        description: lead.description,
      };

      // Ensure browser is alive before starting this lead
      const liveSession = await ensureBrowser();
      let searchPage: Page;
      try {
        searchPage = await newPage(liveSession);
      } catch {
        log(`[${i + 1}] ✗ Could not create page — relaunching`);
        session = null;
        const fresh = await ensureBrowser();
        searchPage = await newPage(fresh);
      }

      try {
        // ── Step 1: Google Search (multi-query) ──
        log(`[${i + 1}] Step 1/7: Google Search...`);
        const googleResult = await runStep("Google", () =>
          searchGoogle(searchPage, ctx.business_name, location, ctx.phone, ctx.address, log)
        );
        if (googleResult) {
          if (googleResult.has_real_website && googleResult.website_url) {
            ctx.has_website = true;
            ctx.website_url = googleResult.website_url;
          } else if (!googleResult.has_real_website) {
            ctx.has_website = false;
          }
          ctx.phone = ctx.phone || googleResult.phone;
          ctx.email = ctx.email || googleResult.email;
          ctx.owner_name = ctx.owner_name || googleResult.owner_name;
          ctx.facebook_url = ctx.facebook_url || googleResult.facebook_url;
          ctx.instagram_url = ctx.instagram_url || googleResult.instagram_url;
          ctx.description = ctx.description || googleResult.extra_description;
        }

        // If browser died in step 1, skip to next lead
        if (!session) { writeCtxToLead(lead, ctx); continue; }

        // ── Step 2: PagesJaunes (multi-query) ──
        log(`[${i + 1}] Step 2/7: PagesJaunes...`);
        const pjResult = await runStep("PagesJaunes", () =>
          searchPagesJaunes(searchPage, ctx.business_name, location, ctx.phone, log)
        );
        if (pjResult) {
          ctx.phone = ctx.phone || pjResult.phone;
          ctx.email = ctx.email || pjResult.email;
          ctx.address = ctx.address || pjResult.address;
          ctx.owner_name = ctx.owner_name || pjResult.owner_name;
          if (pjResult.website_url && !ctx.website_url) {
            ctx.has_website = true;
            ctx.website_url = pjResult.website_url;
          }
        }

        if (!session) { writeCtxToLead(lead, ctx); continue; }

        // ── Step 3: Facebook (multi-query) ──
        log(`[${i + 1}] Step 3/7: Facebook...`);
        const fbResult = await runStep("Facebook", () =>
          searchFacebook(searchPage, ctx.business_name, location, ctx.owner_name, log)
        );
        if (fbResult) {
          ctx.facebook_url = ctx.facebook_url || fbResult.facebook_url;
          ctx.phone = ctx.phone || fbResult.phone;
          ctx.email = ctx.email || fbResult.email;
          ctx.instagram_url = ctx.instagram_url || fbResult.instagram_url;
          ctx.follower_count = ctx.follower_count || fbResult.follower_count;
          ctx.address = ctx.address || fbResult.address;
          ctx.owner_name = ctx.owner_name || fbResult.owner_name;
          ctx.description = ctx.description || fbResult.description;
          if (fbResult.website_url && !ctx.website_url) {
            ctx.has_website = true;
            ctx.website_url = fbResult.website_url;
          }
        }

        if (!session) { writeCtxToLead(lead, ctx); continue; }

        // ── Step 4: Societe.com / Pappers ──
        log(`[${i + 1}] Step 4/7: Societe.com...`);
        const societeResult = await runStep("Societe.com", () =>
          searchSocieteCom(searchPage, ctx.business_name, location, ctx.address, log)
        );
        if (societeResult) {
          ctx.owner_name = ctx.owner_name || societeResult.owner_name;
          ctx.owner_role = societeResult.owner_role;
          ctx.siren = societeResult.siren;
          ctx.company_type = societeResult.company_type;
          ctx.creation_date = societeResult.creation_date;
          ctx.revenue_bracket = societeResult.revenue_bracket;
          ctx.employee_count = societeResult.employee_count;
          ctx.address = ctx.address || societeResult.address;
          ctx.phone = ctx.phone || societeResult.phone;
          if (societeResult.website_url && !ctx.website_url) {
            ctx.has_website = true;
            ctx.website_url = societeResult.website_url;
          }
        }

        if (!session) { writeCtxToLead(lead, ctx); continue; }

        // ── Step 5: LinkedIn ──
        log(`[${i + 1}] Step 5/7: LinkedIn${ctx.owner_name ? ` (${ctx.owner_name})` : ""}...`);
        const linkedInResult = await runStep("LinkedIn", () =>
          searchLinkedIn(searchPage, ctx.business_name, location, ctx.owner_name, log)
        );
        if (linkedInResult) {
          ctx.linkedin_url = linkedInResult.linkedin_url;
          ctx.owner_name = ctx.owner_name || linkedInResult.owner_name;
          ctx.owner_email = ctx.owner_email || linkedInResult.email;
          ctx.phone = ctx.phone || linkedInResult.phone;
        }

        if (!session) { writeCtxToLead(lead, ctx); continue; }

        // ── Step 6: Owner phone search ──
        if (ctx.owner_name) {
          log(`[${i + 1}] Step 6/7: Owner phone (${ctx.owner_name})...`);
          const ownerResult = await runStep("OwnerPhone", () =>
            searchOwnerPhone(searchPage, ctx.owner_name!, ctx.business_name, location, log)
          );
          if (ownerResult) {
            ctx.owner_phone = ownerResult.owner_phone;
            ctx.owner_email = ctx.owner_email || ownerResult.owner_email;
          }
        } else {
          log(`[${i + 1}] Step 6/7: Owner phone — skipped (no owner name)`);
        }

        if (!session) { writeCtxToLead(lead, ctx); continue; }

        // ── Step 7: Website quality check ──
        if (ctx.has_website && ctx.website_url) {
          log(`[${i + 1}] Step 7/7: Website quality check...`);
          const webResult = await runStep("WebCheck", () =>
            checkWebsite(searchPage, ctx.website_url!, ctx.business_name, log)
          );
          if (webResult) {
            lead.website_quality = webResult.quality;
            lead.website_score = webResult.score;
            if (webResult.is_just_social) {
              ctx.has_website = false;
              lead.website_quality = "none";
              lead.website_score = 0;
            }
          }
        } else {
          lead.website_quality = "none";
          lead.website_score = 0;
        }

        // ── Write context back to lead ──
        writeCtxToLead(lead, ctx);

        // Log summary
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
            `web:${lead.website_quality}`,
        ]
          .filter(Boolean)
          .join(", ");
        log(
          `[${i + 1}/${leads.length}] ✓ ${lead.business_name} — ${found || "basic info only"}`
        );
      } catch (e) {
        log(
          `[${i + 1}/${leads.length}] ✗ Enrichment failed for ${lead.business_name}: ${e}`
        );
        writeCtxToLead(lead, ctx);
      } finally {
        try { await searchPage.close(); } catch { /* page may already be dead */ }
      }
    }

    return leads;
  } finally {
    await safeClose(session);
  }
}

/** Write enrichment context back to lead result */
function writeCtxToLead(lead: LeadResult, ctx: EnrichmentContext) {
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

/**
 * Enrich a single lead. Spins up its own browser session, runs
 * all 7 enrichment steps, then closes the browser.
 * Designed to be called per-lead from a short-lived serverless function.
 */
export async function runSingleLeadEnrichment(
  lead: LeadResult,
  location: string,
  log: (msg: string) => void = console.log
): Promise<LeadResult> {
  const [enriched] = await runEnrichment([lead], location, log);
  return enriched;
}

/**
 * Full pipeline: discovery + enrichment in one go.
 * WARNING: This can easily exceed serverless timeouts.
 * Prefer calling runDiscovery + runSingleLeadEnrichment separately.
 */
export async function runFullPipeline(
  niche: string,
  location: string,
  excludeNames: string[] = [],
  log: (msg: string) => void = console.log
): Promise<{ leads: LeadResult[]; keywords: string[] }> {
  const { leads, keywords } = await runDiscovery(
    niche,
    location,
    excludeNames,
    log
  );

  if (leads.length === 0) {
    log("No leads found during discovery");
    return { leads: [], keywords };
  }

  const enrichedLeads = await runEnrichment(leads, location, log);

  log(`\n═══ Pipeline complete ═══`);
  log(`Total leads: ${enrichedLeads.length}`);

  return { leads: enrichedLeads, keywords };
}
