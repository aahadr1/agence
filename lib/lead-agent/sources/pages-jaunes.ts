import type { Page } from "playwright-core";
import {
  screenshotAndAsk,
  safeGoto,
  normalizeUrl,
  dismissConsent,
  randomDelay,
  diagnosePageAccess,
} from "../browser";

export interface PagesJaunesResult {
  phone: string | null;
  email: string | null;
  address: string | null;
  website_url: string | null;
  owner_name: string | null;
  category: string | null;
}

export interface PagesJaunesSearchMeta {
  /** Why extraction failed or was partial (for agent debug). */
  reason?: string;
  /** True when structured data was read from JSON-LD. */
  json_ld_used?: boolean;
  /** True when a listing detail page was opened. */
  detail_page_opened?: boolean;
  credential_required?: boolean;
  suggested_user_action_fr?: string | null;
  credential_hostname?: string | null;
}

export type PagesJaunesSearchResult = PagesJaunesResult & {
  _meta: PagesJaunesSearchMeta;
};

export function hasPagesJaunesData(r: PagesJaunesSearchResult): boolean {
  return Boolean(
    r.phone || r.email || r.address || r.owner_name || r.website_url,
  );
}

function city(location: string): string {
  return location.replace(/\d{5}/g, "").replace(/,.*$/, "").trim();
}

function proUrl(who: string, where: string): string {
  return `https://www.pagesjaunes.fr/annuaire/chercherlespros?quoiqui=${encodeURIComponent(who)}&ou=${encodeURIComponent(where)}`;
}

const PROMPT = (biz: string, loc: string) =>
  `You are looking at PagesJaunes.fr (French yellow pages) for "${biz}" in ${loc}.

Extract ONLY data matching this specific business:
{
  "phone": "phone number (look for phone icon or 'Appeler' button)" or null,
  "email": "email address if shown" or null,
  "address": "full street address with postal code and city" or null,
  "website_url": "website URL if listed (look for 'Site internet')" or null,
  "owner_name": "owner/contact name if visible" or null,
  "category": "business category/profession as listed" or null
}

If no matching business is found, return all null values. Return JSON only.`;

type JsonLdPartial = Partial<PagesJaunesResult>;

async function extractJsonLdHints(page: Page): Promise<JsonLdPartial> {
  return page.evaluate(() => {
    const out: JsonLdPartial = {};
    const assign = (src: Record<string, unknown>) => {
      const tel = src.telephone ?? src.phone;
      if (typeof tel === "string" && tel.trim() && !out.phone)
        out.phone = tel.trim();
      const mail = src.email;
      if (typeof mail === "string" && mail.includes("@") && !out.email)
        out.email = mail.trim();
      const street =
        typeof src.streetAddress === "string" ? src.streetAddress : null;
      const pc =
        typeof src.postalCode === "string" ? src.postalCode : null;
      const locality =
        typeof src.addressLocality === "string" ? src.addressLocality : null;
      const parts = [street, pc && locality ? `${pc} ${locality}` : pc || locality].filter(Boolean);
      if (parts.length && !out.address) out.address = parts.join(", ");
      const url = src.url ?? src.sameAs;
      if (typeof url === "string" && /^https?:\/\//i.test(url) && !out.website_url)
        out.website_url = url;
      const name = src.name;
      if (typeof name === "string" && name.trim() && !out.owner_name)
        out.owner_name = name.trim();
    };

    for (const s of document.querySelectorAll(
      'script[type="application/ld+json"]',
    )) {
      try {
        const raw = s.textContent?.trim();
        if (!raw) continue;
        const j = JSON.parse(raw) as unknown;
        let nodes: unknown[];
        if (Array.isArray(j)) nodes = j;
        else if (
          j &&
          typeof j === "object" &&
          "@graph" in j &&
          Array.isArray((j as { "@graph": unknown[] })["@graph"])
        ) {
          nodes = (j as { "@graph": unknown[] })["@graph"];
        } else {
          nodes = [j];
        }
        for (const node of nodes) {
          if (!node || typeof node !== "object") continue;
          const o = node as Record<string, unknown>;
          const t = o["@type"];
          const types = Array.isArray(t) ? t.map(String) : t ? [String(t)] : [];
          const hit =
            types.some(
              (x) =>
                /LocalBusiness|Organization|ProfessionalService|Store|Restaurant/i.test(
                  x,
                ),
            ) || o.telephone || o.email;
          if (hit) assign(o);
        }
      } catch {
        /* ignore bad JSON */
      }
    }
    return out;
  });
}

/**
 * Search PagesJaunes.fr with 3+ query variations.
 * Navigates the pro directory, clicks into detail pages.
 * Always returns `_meta` for debugging (never silent null).
 */
export async function searchPagesJaunes(
  page: Page,
  businessName: string,
  location: string,
  knownPhone: string | null,
  log: (msg: string) => void,
): Promise<PagesJaunesSearchResult> {
  const emptyMeta = (extra: PagesJaunesSearchMeta = {}): PagesJaunesSearchMeta => ({
    reason: extra.reason,
    json_ld_used: extra.json_ld_used,
    detail_page_opened: extra.detail_page_opened,
    credential_required: extra.credential_required,
    suggested_user_action_fr: extra.suggested_user_action_fr ?? null,
    credential_hostname: extra.credential_hostname ?? null,
  });

  const base: PagesJaunesSearchResult = {
    phone: null,
    email: null,
    address: null,
    website_url: null,
    owner_name: null,
    category: null,
    _meta: emptyMeta(),
  };

  const c = city(location);
  const cleanName = businessName
    .replace(/\b(sarl|sas|eurl|sasu|snc)\b/gi, "")
    .trim();

  const queries: Array<[string, string]> = [
    [businessName, c],
    [`${businessName} ${c}`, c],
    [cleanName, c],
  ];
  if (knownPhone) {
    const clean = knownPhone.replace(/\s+/g, "").replace(/^\+33/, "0");
    queries.push([clean, ""]);
  }

  const merged: PagesJaunesSearchResult = { ...base, _meta: emptyMeta() };

  for (const [who, where] of queries) {
    try {
      log(`[PagesJaunes] "${who}" in "${where || "(phone lookup)"}"`);
      const ok = await safeGoto(page, proUrl(who, where), log);
      if (!ok) {
        merged._meta.reason = merged._meta.reason || "navigation_failed";
        continue;
      }

      await dismissConsent(page);

      const diag = await diagnosePageAccess(page);
      if (diag.captcha || diag.login_wall) {
        merged._meta.reason = diag.captcha ? "captcha_or_bot_wall" : "login_wall";
        merged._meta.credential_required = diag.login_wall;
        merged._meta.suggested_user_action_fr = diag.suggested_action_fr;
        merged._meta.credential_hostname = diag.credential_hostname;
        continue;
      }

      let jsonLd: JsonLdPartial = {};
      try {
        jsonLd = await extractJsonLdHints(page);
        if (Object.keys(jsonLd).length > 0) {
          merged._meta.json_ld_used = true;
          merged.phone = merged.phone || (jsonLd.phone as string | null);
          merged.email = merged.email || (jsonLd.email as string | null);
          merged.address = merged.address || (jsonLd.address as string | null);
          merged.owner_name =
            merged.owner_name || (jsonLd.owner_name as string | null);
          merged.website_url =
            merged.website_url ||
            normalizeUrl(jsonLd.website_url as string | null);
        }
      } catch {
        /* optional */
      }

      const first = page
        .locator(
          [
            "a.bi-denomination",
            'a[href*="/pros/"]',
            ".bi-item h3 a",
            '[class*="businessName"] a',
            'article a[href*="/pros/"]',
            ".bi-bloc-liste a[href*='/pros/']",
            "li.bi-result a[href*='/pros/']",
          ].join(", "),
        )
        .first();

      try {
        if (await first.isVisible({ timeout: 4000 })) {
          await first.click();
          merged._meta.detail_page_opened = true;
          await randomDelay(1500, 2500);
          await dismissConsent(page);

          try {
            const jsonDetail = await extractJsonLdHints(page);
            if (Object.keys(jsonDetail).length > 0) {
              merged._meta.json_ld_used = true;
              merged.phone = merged.phone || (jsonDetail.phone as string | null);
              merged.email = merged.email || (jsonDetail.email as string | null);
              merged.address =
                merged.address || (jsonDetail.address as string | null);
              merged.owner_name =
                merged.owner_name || (jsonDetail.owner_name as string | null);
              merged.website_url =
                merged.website_url ||
                normalizeUrl(jsonDetail.website_url as string | null);
            }
          } catch {
            /* */
          }

          const phoneReveal = page
            .locator(
              [
                'button:has-text("Afficher")',
                'a:has-text("Afficher le numéro")',
                'a:has-text("Voir le numéro")',
                'button:has-text("Voir le numéro")',
                'button:has-text("Appeler")',
                'a:has-text("Appeler")',
                '[class*="phone-reveal"]',
                '[data-action*="phone"]',
                '[aria-label*="numéro" i]',
              ].join(", "),
            )
            .first();
          try {
            if (await phoneReveal.isVisible({ timeout: 2500 })) {
              await phoneReveal.click();
              await randomDelay(600, 1200);
              log(`[PagesJaunes] Clicked phone reveal button`);
            }
          } catch {
            /* button not found — phone may already be visible */
          }
        }
      } catch {
        /* stay on search page */
      }

      const result = await screenshotAndAsk<PagesJaunesResult>(
        page,
        PROMPT(businessName, location),
      );

      merged.phone = merged.phone || result.phone;
      merged.email = merged.email || result.email;
      merged.address = merged.address || result.address;
      merged.website_url =
        merged.website_url || normalizeUrl(result.website_url);
      merged.owner_name = merged.owner_name || result.owner_name;
      merged.category = merged.category || result.category;

      await randomDelay(1000, 2000);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("closed") || msg.includes("Protocol error")) throw e;
      log(`[PagesJaunes] ✗ ${msg.slice(0, 80)}`);
      merged._meta.reason = merged._meta.reason || "exception";
    }
  }

  if (!hasPagesJaunesData(merged)) {
    merged._meta.reason = merged._meta.reason || "no_match";
  }

  return merged;
}
