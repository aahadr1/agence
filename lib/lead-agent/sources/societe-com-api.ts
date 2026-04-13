/**
 * Societe.com API PRO (REST) — search + dirigeants + infos légales.
 *
 * Docs: https://api.societe.com/apisite/documentations/v1/documentation-api.html
 *
 * Auth: header `X-Authorization: socapi {token}` or query `token=`
 *
 * Set SOCIETE_COM_API_KEY (or SOCIETE_API_KEY) in the environment.
 * Note: Societe.com may require your server IP to be allowlisted on their side.
 */

import type { SocieteComResult } from "./societe-com";

const BASE = "https://api.societe.com/api/v1";

function getToken(): string | null {
  const t =
    process.env.SOCIETE_COM_API_KEY?.trim() ||
    process.env.SOCIETE_API_KEY?.trim();
  return t || null;
}

function stripAccents(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function normalizeName(name: string): string {
  return stripAccents(name)
    .toLowerCase()
    .replace(
      /\b(sarl|sas|sa|eurl|sci|sasu|snc|ei|selarl|sarlu|auto[- ]?entrepreneur)\b/gi,
      ""
    )
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cityFromLocation(location: string): string {
  return stripAccents(
    location
      .replace(/\b\d{5}\b/g, "")
      .replace(/^[^,]*,/, "")
      .trim()
  )
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** French postal code → département code for API `dep` filter */
function depFromLocation(location: string): string | null {
  const m = location.match(/\b(\d{5})\b/);
  if (!m) return null;
  const cp = m[1];
  if (cp.startsWith("97") || cp.startsWith("98")) return cp.slice(0, 3);
  if (cp.startsWith("20")) return cp.slice(0, 3); // Corse 2A/2B legacy
  return cp.slice(0, 2);
}

function formatYyyymmdd(raw: string | undefined): string | null {
  if (!raw || raw.length < 6) return null;
  const y = raw.slice(0, 4);
  const mo = raw.slice(4, 6);
  const d = raw.slice(6, 8) || "01";
  if (!/^\d{4}$/.test(y)) return null;
  return `${y}-${mo}-${d}`;
}

function formatEmployeeCount(tranche: string | undefined): string | null {
  if (!tranche || tranche === "NN") return null;
  const map: Record<string, string> = {
    "00": "0",
    "01": "1-2",
    "02": "3-5",
    "03": "6-9",
    "11": "10-19",
    "12": "20-49",
    "21": "50-99",
    "22": "100-199",
    "31": "200-249",
    "32": "250-499",
    "41": "500-999",
    "42": "1 000-1 999",
    "51": "2 000-4 999",
    "52": "5 000-9 999",
    "53": "10 000+",
  };
  return map[tranche] ?? tranche;
}

interface SearchResult {
  nomcommercial?: string;
  status?: string;
  siren?: string;
  nafcode?: string;
  naflib?: string;
  cpville?: string;
  dep?: string;
}

interface DirigeantApi {
  type?: string;
  datedebut?: string;
  datefin?: string;
  titre?: string;
  prenompp?: string;
  nompp?: string;
  denopm?: string;
}

interface InfoLegales {
  siren?: string;
  siretsiege?: string;
  denorcs?: string;
  catjurlibrcs?: string;
  catjurlibinsee?: string;
  datecrearcs?: string;
  datecreainsee?: string;
  capital?: string;
  codedevise?: string;
  libdevise?: string;
  voieadressagercs?: string;
  codepostalrcs?: string;
  villercs?: string;
  paysrcs?: string;
  nafrcs?: string;
  naflibrcs?: string;
  trancheeffinsee?: string;
}

async function apiGet<T>(
  path: string,
  token: string,
  log: (msg: string) => void
): Promise<T | null> {
  const url = `${BASE}${path}`;
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "X-Authorization": `socapi ${token}`,
      },
      signal: AbortSignal.timeout(12_000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      log(`[Societe API] HTTP ${res.status} ${text.slice(0, 120)}`);
      return null;
    }

    const json = (await res.json()) as T & { error?: { codemsg?: string } };
    if (json?.error?.codemsg) {
      log(`[Societe API] ${json.error.codemsg}`);
      return null;
    }
    return json;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log(`[Societe API] ✗ ${msg.slice(0, 80)}`);
    return null;
  }
}

function scoreSearchResult(
  businessName: string,
  location: string,
  r: SearchResult
): number {
  const normBiz = normalizeName(businessName);
  const nom = normalizeName(r.nomcommercial || "");
  const city = cityFromLocation(location);
  const dep = depFromLocation(location);
  const cpville = stripAccents((r.cpville || "").toLowerCase());

  let score = 0;

  if (dep && r.dep && r.dep === dep) score += 35;
  if (city && cpville && (cpville.includes(city) || city.split(" ").some((w) => w.length > 2 && cpville.includes(w))))
    score += 35;

  const bizWords = normBiz.split(" ").filter((w) => w.length > 2);
  const nomWords = nom.split(" ").filter((w) => w.length > 2);
  if (bizWords.length > 0) {
    let matched = 0;
    for (const word of bizWords) {
      if (nomWords.some((nw) => nw.includes(word) || word.includes(nw))) matched++;
    }
    score += Math.round((matched / bizWords.length) * 45);
  }

  if (r.status === "active") score += 5;
  return score;
}

function pickCurrentDirigeant(dirs: DirigeantApi[]): DirigeantApi | null {
  const current = dirs.filter((d) => !d.datefin || d.datefin.trim() === "");
  if (current.length === 0) return dirs[0] ?? null;

  const pp = current.filter((d) => d.type === "PP" && (d.prenompp || d.nompp));
  const pool = pp.length > 0 ? pp : current;

  const preferred = pool.find((d) =>
    /gérant|gerant|président|president|directeur général|directrice générale|dg|fondateur/i.test(
      d.titre || ""
    )
  );
  return preferred || pool[0];
}

function dirigeantToOwner(d: DirigeantApi): { name: string | null; role: string | null } {
  if (d.type === "PP") {
    const name = [d.prenompp, d.nompp].filter(Boolean).join(" ").trim();
    return { name: name || null, role: d.titre?.trim() || null };
  }
  // PM (personne morale) dirigeant — do not use raison sociale as owner_name
  return { name: null, role: d.titre?.trim() || null };
}

function buildAddress(il: InfoLegales): string | null {
  const parts = [
    il.voieadressagercs,
    il.codepostalrcs && il.villercs
      ? `${il.codepostalrcs} ${il.villercs}`
      : il.villercs,
    il.paysrcs,
  ].filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}

/**
 * Search Societe.com API: entreprise search → dirigeants + infos légales.
 */
export async function searchSocieteComApi(
  businessName: string,
  location: string,
  log: (msg: string) => void
): Promise<SocieteComResult | null> {
  const token = getToken();
  if (!token) {
    log("[Societe API] SOCIETE_COM_API_KEY not set — skipping API");
    return null;
  }

  const city = cityFromLocation(location);
  const dep = depFromLocation(location);
  const clean = businessName
    .replace(
      /\b(SARL|SAS|SA|EURL|SCI|SASU|SNC|EI|SELARL|SARLU|AUTO[- ]?ENTREPRENEUR)\b/gi,
      ""
    )
    .replace(/\s+/g, " ")
    .trim();

  const queries = [
    businessName,
    city ? `${businessName} ${city}` : businessName,
    clean !== businessName ? clean : "",
    city && clean ? `${clean} ${city}` : "",
  ].filter((q, i, a) => q && a.indexOf(q) === i);

  let best: { r: SearchResult; score: number } | null = null;

  for (const q of queries) {
    const params = new URLSearchParams({
      nom: q,
      debut: "1",
      nbrep: "25",
    });
    if (dep) params.set("dep", dep);

    const searchRes = await apiGet<{ data?: { results?: SearchResult[] } }>(
      `/entreprise/search?${params.toString()}`,
      token,
      log
    );
    const results = searchRes?.data?.results || [];
    if (results.length === 0) {
      log(`[Societe API] No results for "${q}"`);
      continue;
    }

    for (const r of results) {
      if (!r.siren) continue;
      const score = scoreSearchResult(businessName, location, r);
      if (!best || score > best.score) best = { r, score };
    }

    if (best && best.score >= 28) break;
  }

  if (!best || best.score < 20) {
    log(`[Societe API] No confident match for "${businessName}" (best score ${best?.score ?? 0})`);
    return null;
  }

  const siren = best.r.siren!;
  log(`[Societe API] Matched SIREN ${siren} (score ${best.score}) — fetching dirigeants + légal`);

  const [dirRes, legalRes] = await Promise.all([
    apiGet<{ data?: { dirigeants?: DirigeantApi[] } }>(
      `/entreprise/${encodeURIComponent(siren)}/dirigeants`,
      token,
      log
    ),
    apiGet<{ infolegales?: InfoLegales }>(
      `/entreprise/${encodeURIComponent(siren)}/infoslegales`,
      token,
      log
    ),
  ]);

  const dirs = dirRes?.data?.dirigeants || [];
  const il = legalRes?.infolegales;

  const picked = dirs.length > 0 ? pickCurrentDirigeant(dirs) : null;
  const owner = picked ? dirigeantToOwner(picked) : { name: null, role: null };

  const company_type = il?.catjurlibrcs || il?.catjurlibinsee || null;
  const creation_raw = il?.datecrearcs || il?.datecreainsee;
  const capital =
    il?.capital != null && String(il.capital).trim()
      ? `${Number(il.capital).toLocaleString("fr-FR")} ${il.libdevise || il.codedevise || "€"}`.trim()
      : null;

  const naf =
    il?.nafrcs && il?.naflibrcs
      ? `${il.nafrcs} — ${il.naflibrcs}`
      : il?.nafrcs || null;

  const result: SocieteComResult = {
    owner_name: owner.name,
    owner_role: owner.role,
    siren: il?.siren || siren,
    siret: il?.siretsiege || null,
    company_type,
    creation_date: formatYyyymmdd(creation_raw || undefined),
    revenue_bracket: null,
    employee_count: formatEmployeeCount(il?.trancheeffinsee),
    address: il ? buildAddress(il) : null,
    phone: null,
    website_url: null,
    naf_code: naf,
    capital,
  };

  log(
    `[Societe API] ✓ ${result.owner_name || "—"} | ${result.company_type || "—"} | SIREN ${result.siren}`
  );
  return result;
}

/** True when API key is configured (browser fallback can be skipped if API already found an owner). */
export function hasSocieteComApiKey(): boolean {
  return Boolean(getToken());
}
