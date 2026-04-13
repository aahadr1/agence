// ─────────────────────────────────────────────────────────────────────────────
// Pure platform classification registry — NO Playwright / Node-only imports.
// Safe to import from both client and server code.
// ─────────────────────────────────────────────────────────────────────────────

export type WebsiteType =
  | "own_domain"
  | "facebook_page"
  | "instagram_page"
  | "planity"
  | "treatwell"
  | "doctolib"
  | "booking"
  | "thefork"
  | "tripadvisor"
  | "pagesjaunes"
  | "google_maps"
  | "directory"
  | null;

export interface PlatformDef {
  host: string;
  type: Exclude<WebsiteType, "own_domain" | null>;
  label: string;
}

export const PLATFORM_REGISTRY: PlatformDef[] = [
  { host: "planity.com", type: "planity", label: "Planity" },
  { host: "treatwell.fr", type: "treatwell", label: "Treatwell" },
  { host: "treatwell.com", type: "treatwell", label: "Treatwell" },
  { host: "doctolib.fr", type: "doctolib", label: "Doctolib" },
  { host: "facebook.com", type: "facebook_page", label: "Facebook" },
  { host: "fb.com", type: "facebook_page", label: "Facebook" },
  { host: "instagram.com", type: "instagram_page", label: "Instagram" },
  { host: "booking.com", type: "booking", label: "Booking.com" },
  { host: "airbnb.com", type: "booking", label: "Airbnb" },
  { host: "airbnb.fr", type: "booking", label: "Airbnb" },
  { host: "lafourchette.com", type: "thefork", label: "TheFork" },
  { host: "thefork.com", type: "thefork", label: "TheFork" },
  { host: "tripadvisor.com", type: "tripadvisor", label: "TripAdvisor" },
  { host: "tripadvisor.fr", type: "tripadvisor", label: "TripAdvisor" },
  { host: "pagesjaunes.fr", type: "pagesjaunes", label: "PagesJaunes" },
  { host: "google.com", type: "google_maps", label: "Google" },
  { host: "google.fr", type: "google_maps", label: "Google" },
  { host: "g.page", type: "google_maps", label: "Google" },
  { host: "maps.app.goo.gl", type: "google_maps", label: "Google Maps" },
  { host: "yelp.com", type: "directory", label: "Yelp" },
  { host: "yelp.fr", type: "directory", label: "Yelp" },
  { host: "societe.com", type: "directory", label: "Societe.com" },
  { host: "pappers.fr", type: "directory", label: "Pappers" },
  { host: "linkedin.com", type: "directory", label: "LinkedIn" },
  { host: "youtube.com", type: "directory", label: "YouTube" },
  { host: "tiktok.com", type: "directory", label: "TikTok" },
  { host: "twitter.com", type: "directory", label: "Twitter/X" },
  { host: "x.com", type: "directory", label: "Twitter/X" },
  { host: "wikipedia.org", type: "directory", label: "Wikipedia" },
  { host: "just-eat.fr", type: "booking", label: "Just Eat" },
  { host: "ubereats.com", type: "booking", label: "Uber Eats" },
  { host: "deliveroo.fr", type: "booking", label: "Deliveroo" },
  { host: "annuaire.gouv.fr", type: "directory", label: "Annuaire Officiel" },
  { host: "kompass.com", type: "directory", label: "Kompass" },
  { host: "verif.com", type: "directory", label: "Verif.com" },
  { host: "manageo.fr", type: "directory", label: "Manageo" },
  { host: "infogreffe.fr", type: "directory", label: "Infogreffe" },
  { host: "groupon.fr", type: "directory", label: "Groupon" },
  { host: "rueducommerce.fr", type: "directory", label: "Directory" },
  { host: "wixsite.com", type: "directory", label: "Wix (autre)" },
  { host: "jimdo.com", type: "directory", label: "Jimdo" },
  { host: "strikingly.com", type: "directory", label: "Strikingly" },
  { host: "annuaires-online.com", type: "directory", label: "Annuaire" },
  { host: "beautyplanet.com", type: "directory", label: "BeautyPlanet" },
  { host: "kiute.com", type: "directory", label: "Kiute" },
  { host: "genially.com", type: "directory", label: "Genially" },
  { host: "my.barber", type: "directory", label: "MyBarber" },
  { host: "uala.com", type: "booking", label: "Uala" },
  { host: "fresha.com", type: "booking", label: "Fresha" },
  { host: "balinea.com", type: "booking", label: "Balinea" },
  { host: "salonkee.com", type: "booking", label: "Salonkee" },
];

/**
 * Classify a URL as a known platform or null (= potential owned domain).
 */
export function classifyUrl(
  url: string
): { type: Exclude<WebsiteType, "own_domain" | null>; label: string } | null {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    for (const def of PLATFORM_REGISTRY) {
      if (host === def.host || host.endsWith("." + def.host)) {
        return { type: def.type, label: def.label };
      }
    }
  } catch {
    // invalid URL
  }
  return null;
}
