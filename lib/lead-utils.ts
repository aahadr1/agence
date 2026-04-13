import { classifyUrl, PLATFORM_REGISTRY } from "./lead-agent/enrichment/website-finder";
import type { WebsiteType } from "./lead-agent/enrichment/website-finder";

export type { WebsiteType };

/**
 * True only if the lead has an OWNED website (not a platform page).
 *
 * Rules:
 * - website_url must start with http(s)://
 * - website_url must NOT be a known platform (Facebook, Planity, PagesJaunes, etc.)
 * - Fallback: has_website flag (set by Maps discovery)
 */
export function leadHasWebsite(lead: {
  has_website?: boolean | null;
  website_url?: string | null;
}): boolean {
  const u = lead.website_url?.trim();
  if (u && /^https?:\/\//i.test(u)) {
    // Exclude known platform URLs
    if (classifyUrl(u) !== null) return false;
    return true;
  }
  return Boolean(lead.has_website);
}

/**
 * Returns contextual website info for display purposes.
 * - If owned domain → { type: "own_domain", label: "Site web", url }
 * - If platform found (from enrichment_data) → { type, label, url }
 * - If nothing → null
 */
export function getWebsiteContext(lead: {
  has_website?: boolean | null;
  website_url?: string | null;
  enrichment_data?: Record<string, unknown> | null;
}): {
  type: WebsiteType;
  label: string;
  url: string;
  isOwned: boolean;
} | null {
  const u = lead.website_url?.trim();

  if (u && /^https?:\/\//i.test(u)) {
    const platform = classifyUrl(u);
    if (!platform) {
      // Owned website from Maps or previous finder
      return { type: "own_domain", label: "Site web", url: u, isOwned: true };
    }
    // Maps returned a platform URL — show it contextually
    return { type: platform.type, label: platform.label, url: u, isOwned: false };
  }

  // Check enrichment_data for platform info (set by findWebsite enrichment step)
  const ed = lead.enrichment_data;
  if (ed) {
    const platformUrl = ed.platform_url as string | null | undefined;
    const platformLabel = ed.platform_label as string | null | undefined;
    const websiteType = ed.website_type as WebsiteType | null | undefined;

    if (platformUrl && platformLabel && websiteType) {
      return {
        type: websiteType,
        label: platformLabel,
        url: platformUrl,
        isOwned: false,
      };
    }
  }

  if (lead.has_website) {
    // has_website = true but no URL — shouldn't normally happen
    return { type: "own_domain", label: "Site web", url: "", isOwned: true };
  }

  return null;
}

/** Human-readable label for a platform type */
export function platformLabel(type: WebsiteType): string {
  if (!type || type === "own_domain") return "Site web";
  const def = PLATFORM_REGISTRY.find((p) => p.type === type);
  return def?.label ?? type;
}
