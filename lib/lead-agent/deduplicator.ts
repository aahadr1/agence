import type { LeadResult } from "./index";

/**
 * Normalize a business name for comparison.
 * Strips accents, lowercases, removes common suffixes.
 */
function normalize(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // strip accents
    .replace(/[^a-z0-9\s]/g, "") // remove special chars
    .replace(/\b(sarl|sas|eurl|srl|inc|llc|ltd|gmbh)\b/g, "") // remove legal suffixes
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Simple similarity score between two strings (0-1).
 * Uses character overlap / longest length.
 */
function similarity(a: string, b: string): number {
  const na = normalize(a);
  const nb = normalize(b);
  if (na === nb) return 1;

  // Check if one contains the other
  if (na.includes(nb) || nb.includes(na)) return 0.9;

  // Character-level Jaccard similarity
  const setA = new Set(na.split(""));
  const setB = new Set(nb.split(""));
  const intersection = new Set([...setA].filter((x) => setB.has(x)));
  const union = new Set([...setA, ...setB]);
  return intersection.size / union.size;
}

/**
 * Deduplicate leads by fuzzy matching on name + address.
 * Merges data from duplicates, keeping the most complete record.
 */
export function deduplicateLeads(leads: LeadResult[]): LeadResult[] {
  const merged: LeadResult[] = [];

  for (const lead of leads) {
    const existing = merged.find((m) => {
      const nameSim = similarity(m.business_name, lead.business_name);
      if (nameSim > 0.75) return true;

      // Also check address match if both have addresses
      if (m.address && lead.address) {
        const addrSim = similarity(m.address, lead.address);
        if (nameSim > 0.5 && addrSim > 0.6) return true;
      }

      return false;
    });

    if (existing) {
      // Merge: fill in missing data from the duplicate
      existing.phone = existing.phone || lead.phone;
      existing.email = existing.email || lead.email;
      existing.address = existing.address || lead.address;
      existing.rating = existing.rating || lead.rating;
      existing.review_count = existing.review_count || lead.review_count;
      existing.website_url = existing.website_url || lead.website_url;
      existing.google_maps_url = existing.google_maps_url || lead.google_maps_url;
      existing.facebook_url = existing.facebook_url || lead.facebook_url;
      existing.instagram_url = existing.instagram_url || lead.instagram_url;
      existing.owner_name = existing.owner_name || lead.owner_name;
      existing.description = existing.description || lead.description;
      if (lead.review_highlights.length > existing.review_highlights.length) {
        existing.review_highlights = lead.review_highlights;
      }
      // If one source says has_website and the other doesn't, trust the one that says yes
      if (lead.has_website && !existing.has_website) {
        existing.has_website = true;
        existing.website_url = lead.website_url;
      }
      existing.source = `${existing.source}, ${lead.source}`;
    } else {
      merged.push({ ...lead });
    }
  }

  return merged;
}
