import { launchBrowser, closeBrowser, newPage, type BrowserSession } from "./browser";
import { expandQueries } from "./query-expander";
import { scrapeGoogleMaps } from "./sources/google-maps";
import { searchGoogle } from "./sources/google-search";
import { searchPagesJaunes } from "./sources/pages-jaunes";
import { searchFacebook } from "./sources/facebook";
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
  follower_count: number | null;
  website_quality: string | null;
  website_score: number | null;
  source: string;
}

/**
 * Phase 1: Discovery — find all businesses via Google Maps with query variations.
 * Returns raw leads (not enriched yet).
 */
export async function runDiscovery(
  niche: string,
  location: string,
  excludeNames: string[] = [],
  log: (msg: string) => void = console.log
): Promise<{ leads: LeadResult[]; keywords: string[] }> {
  let session: BrowserSession | null = null;

  try {
    // 1. Expand queries
    log("Generating search variations with AI...");
    const { queries, keywords } = await expandQueries(niche, location, excludeNames);
    log(`Generated ${queries.length} query variations: ${queries.join(" | ")}`);

    // 2. Launch browser and scrape Maps for each query
    log("Launching browser...");
    session = await launchBrowser();

    const allLeads: LeadResult[] = [];
    const seenNames = new Set<string>(excludeNames.map((n) => n.toLowerCase()));

    for (const query of queries) {
      const mapsLeads = await scrapeGoogleMaps(
        session.page,
        query,
        seenNames,
        log,
        3, // scrolls per query
        20 // max leads per query
      );

      for (const ml of mapsLeads) {
        allLeads.push({
          ...ml,
          facebook_url: null,
          instagram_url: null,
          owner_name: null,
          follower_count: null,
          website_quality: null,
          website_score: null,
          source: "Google Maps",
        });
      }

      log(`Total unique leads so far: ${allLeads.length}`);
    }

    // 3. Deduplicate
    const dedupedLeads = deduplicateLeads(allLeads);
    log(`After deduplication: ${dedupedLeads.length} unique businesses`);

    return { leads: dedupedLeads, keywords };
  } finally {
    if (session) await closeBrowser(session);
  }
}

/**
 * Phase 2: Enrichment — cross-reference each lead across multiple sources.
 * Updates leads in-place with additional data.
 */
export async function runEnrichment(
  leads: LeadResult[],
  location: string,
  log: (msg: string) => void = console.log
): Promise<LeadResult[]> {
  let session: BrowserSession | null = null;

  try {
    log(`Enriching ${leads.length} leads...`);
    session = await launchBrowser();

    for (let i = 0; i < leads.length; i++) {
      const lead = leads[i];
      log(`[${i + 1}/${leads.length}] Enriching: ${lead.business_name}`);

      // Create a fresh page for each source to avoid state issues
      const searchPage = await newPage(session);

      try {
        // 1. Google Search — verify website, find contacts
        const googleResult = await searchGoogle(
          searchPage,
          lead.business_name,
          location,
          log
        );
        if (googleResult) {
          // Update website status with higher confidence
          if (googleResult.has_real_website && googleResult.website_url) {
            lead.has_website = true;
            lead.website_url = googleResult.website_url;
          } else if (!googleResult.has_real_website) {
            lead.has_website = false;
          }
          lead.phone = lead.phone || googleResult.phone;
          lead.email = lead.email || googleResult.email;
          lead.owner_name = lead.owner_name || googleResult.owner_name;
          lead.facebook_url = lead.facebook_url || googleResult.facebook_url;
          lead.instagram_url = lead.instagram_url || googleResult.instagram_url;
          if (googleResult.extra_description && !lead.description) {
            lead.description = googleResult.extra_description;
          }
        }

        // 2. PagesJaunes — phone/email (especially useful in France)
        const pjResult = await searchPagesJaunes(
          searchPage,
          lead.business_name,
          location,
          log
        );
        if (pjResult) {
          lead.phone = lead.phone || pjResult.phone;
          lead.email = lead.email || pjResult.email;
          lead.address = lead.address || pjResult.address;
          lead.owner_name = lead.owner_name || pjResult.owner_name;
          if (pjResult.website_url && !lead.website_url) {
            lead.has_website = true;
            lead.website_url = pjResult.website_url;
          }
        }

        // 3. Facebook — social presence, followers
        const fbResult = await searchFacebook(
          searchPage,
          lead.business_name,
          location,
          log
        );
        if (fbResult) {
          lead.facebook_url = lead.facebook_url || fbResult.facebook_url;
          lead.phone = lead.phone || fbResult.phone;
          lead.email = lead.email || fbResult.email;
          lead.instagram_url = lead.instagram_url || fbResult.instagram_url;
          lead.follower_count = lead.follower_count || fbResult.follower_count;
          lead.address = lead.address || fbResult.address;
        }

        // 4. Website quality check (if they have a website)
        if (lead.has_website && lead.website_url) {
          log(`[${i + 1}/${leads.length}] Checking website quality...`);
          const webResult = await checkWebsite(
            searchPage,
            lead.website_url,
            lead.business_name,
            log
          );
          if (webResult) {
            lead.website_quality = webResult.quality;
            lead.website_score = webResult.score;
            // If the "website" is actually just a social page, correct the data
            if (webResult.is_just_social) {
              lead.has_website = false;
              lead.website_quality = "none";
              lead.website_score = 0;
            }
          }
        } else {
          lead.website_quality = "none";
          lead.website_score = 0;
        }

        const enrichedInfo = [
          lead.phone && "phone",
          lead.email && "email",
          lead.facebook_url && "FB",
          lead.instagram_url && "IG",
          lead.owner_name && "owner",
          lead.website_quality && lead.website_quality !== "none" && `web:${lead.website_quality}`,
        ]
          .filter(Boolean)
          .join(", ");
        log(`[${i + 1}/${leads.length}] ✓ ${lead.business_name} — ${enrichedInfo || "basic info only"}`);
      } catch (e) {
        log(`[${i + 1}/${leads.length}] ✗ Enrichment failed for ${lead.business_name}: ${e}`);
      } finally {
        await searchPage.close();
      }
    }

    return leads;
  } finally {
    if (session) await closeBrowser(session);
  }
}

/**
 * Full pipeline: discovery + enrichment in one go.
 */
export async function runFullPipeline(
  niche: string,
  location: string,
  excludeNames: string[] = [],
  log: (msg: string) => void = console.log
): Promise<{ leads: LeadResult[]; keywords: string[] }> {
  // Phase 1: Discovery
  const { leads, keywords } = await runDiscovery(niche, location, excludeNames, log);

  if (leads.length === 0) {
    log("No leads found during discovery");
    return { leads: [], keywords };
  }

  // Phase 2: Enrichment
  const enrichedLeads = await runEnrichment(leads, location, log);

  log(`\nPipeline complete: ${enrichedLeads.length} leads`);
  log(`  Without website: ${enrichedLeads.filter((l) => !l.has_website).length}`);
  log(`  With bad website: ${enrichedLeads.filter((l) => l.has_website && (l.website_quality === "dead" || l.website_quality === "outdated" || l.website_quality === "poor")).length}`);
  log(`  With phone: ${enrichedLeads.filter((l) => l.phone).length}`);
  log(`  With email: ${enrichedLeads.filter((l) => l.email).length}`);

  return { leads: enrichedLeads, keywords };
}
