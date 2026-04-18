/**
 * Après Google Maps, beaucoup de fiches n'ont pas le lien site (UI Maps changeante).
 * Cette étape demande à Gemini les URLs probables puis les vérifie en HTTP —
 * sans Playwright, donc fiable sur Vercel.
 */

import { hasGeminiApiKey } from "@/lib/ai/gemini-keys";
import { askGeminiText, normalizeUrl } from "../browser";

const BLOCKED_HOSTS = [
  "facebook.com",
  "instagram.com",
  "linkedin.com",
  "google.com",
  "g.page",
  "maps.app.goo.gl",
  "pagesjaunes.fr",
  "tripadvisor",
  "yelp.",
  "wikipedia.org",
  "youtube.com",
  "tiktok.com",
];

function hostOk(hostname: string): boolean {
  const h = hostname.replace(/^www\./, "").toLowerCase();
  return !BLOCKED_HOSTS.some((b) => h.includes(b));
}

async function urlResponds(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      signal: AbortSignal.timeout(7000),
      headers: { "User-Agent": "Mozilla/5.0 (compatible; LeadAgent/2.1)" },
    });
    if (res.ok) return true;
    const res2 = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: AbortSignal.timeout(9000),
      headers: { "User-Agent": "Mozilla/5.0 (compatible; LeadAgent/2.1)" },
    });
    return res2.ok;
  } catch {
    return false;
  }
}

export interface LeadWebsiteFields {
  business_name: string;
  address: string | null;
  has_website: boolean;
  website_url: string | null;
}

function parseJsonArray(raw: string): { i: number; website_url: string | null }[] {
  const cleaned = raw
    .replace(/<\/?(?:think|thinking)(?:\s[^>]*)?>/gi, "")
    .replace(/```(?:json)?\s*\n?/gi, "")
    .replace(/\n?\s*```\s*$/m, "")
    .trim();
  const start = cleaned.indexOf("{");
  if (start < 0) return [];
  try {
    const parsed = JSON.parse(cleaned.slice(start)) as {
      items?: { i?: number; website_url?: string | null }[];
    };
    if (!Array.isArray(parsed.items)) return [];
    return parsed.items.map((it, pos) => ({
      i: typeof it.i === "number" ? it.i : pos,
      website_url: it.website_url ?? null,
    }));
  } catch {
    return [];
  }
}

/**
 * Pour les leads sans site Maps, demande à Gemini les URLs (domaine propre uniquement)
 * et ne garde que celles qui répondent en HTTP.
 */
export async function augmentLeadsWithAiWebsites(
  leads: LeadWebsiteFields[],
  location: string,
  log: (msg: string) => void = console.log
): Promise<void> {
  const need = leads
    .map((l, idx) => ({ l, idx }))
    .filter(({ l }) => !l.website_url?.trim());

  if (need.length === 0) {
    log("[AiWebsites] All leads already have a website from Maps");
    return;
  }

  if (!hasGeminiApiKey()) {
    log("[AiWebsites] GEMINI_API_KEY missing — skip AI website fill");
    return;
  }

  const BATCH = 10;
  for (let b = 0; b < need.length; b += BATCH) {
    const slice = need.slice(b, b + BATCH);
    const lines = slice
      .map(
        ({ l, idx }, j) =>
          `${j}. (ref:${idx}) « ${l.business_name} » — ${location}${l.address ? ` — ${l.address}` : ""}`
      )
      .join("\n");

    const prompt = `Tu es un assistant qui trouve le site web OFFICIEL de petites entreprises en France.

Pour chaque ligne, cherche le site avec le MÊME nom commercial (ou très proche) dans la zone indiquée.
Réponds UNIQUEMENT avec du JSON valide, sans markdown.

Règles strictes:
- website_url: URL https avec le DOMAINE PROPRE du commerce (ex: salon-coiffure-nancy.fr).
- null si tu n'es pas sûr, si seulement Facebook/Instagram/Google Maps/PagesJaunes, ou si c'est un autre commerce.
- Ne pas inventer de domaines : seulement une URL que tu juges réelle et officielle pour CET établissement.

Format:
{ "items": [ { "i": 0, "website_url": "https://..." ou null }, ... ] }

Les index i vont de 0 à ${slice.length - 1} dans l'ordre des lignes ci-dessous.

Commerces:
${lines}`;

    try {
      const raw = await askGeminiText(prompt);
      const items = parseJsonArray(raw);
      const byLocalIndex = new Map<number, string | null>();
      for (const it of items) {
        if (typeof it.i === "number" && it.i >= 0 && it.i < slice.length) {
          byLocalIndex.set(it.i, it.website_url);
        }
      }

      for (let j = 0; j < slice.length; j++) {
        const urlRaw =
          byLocalIndex.get(j) ??
          items.find((x) => x.i === j)?.website_url ??
          items[j]?.website_url;
        if (!urlRaw || typeof urlRaw !== "string") continue;

        const normalized = normalizeUrl(urlRaw.trim());
        if (!normalized) continue;

        let host: string;
        try {
          host = new URL(normalized).hostname;
        } catch {
          continue;
        }
        if (!hostOk(host)) continue;

        const ok = await urlResponds(normalized);
        if (!ok) {
          log(`[AiWebsites] ✗ ${normalized.slice(0, 50)} — no HTTP response`);
          continue;
        }

        const { l, idx } = slice[j];
        l.website_url = normalized;
        l.has_website = true;
        log(`[AiWebsites] ✓ ${l.business_name} → ${normalized}`);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log(`[AiWebsites] batch error: ${msg.slice(0, 120)}`);
    }
  }
}
