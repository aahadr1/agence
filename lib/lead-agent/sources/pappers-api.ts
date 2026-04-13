/**
 * Pappers.fr REST API client.
 *
 * Free tier: 10 000 requests/month.
 * Returns owner name, legal form, SIREN, creation date, employee count, and
 * registered address directly — no Playwright needed.
 *
 * Set PAPPERS_API_KEY env var (register free at pappers.fr → API).
 */

export interface PappersDirigeantInfo {
  name: string;
  role: string | null;
}

export interface PappersResult {
  owner_name: string | null;
  owner_role: string | null;
  siren: string | null;
  company_type: string | null;
  creation_date: string | null;
  employee_count: string | null;
  address: string | null;
  naf_code: string | null;
  capital: string | null;
  all_dirigeants: PappersDirigeantInfo[];
}

// ---------------------------------------------------------------------------
// Internal API types
// ---------------------------------------------------------------------------

interface PappersDirigeant {
  nom?: string;
  prenom?: string;
  qualite?: string;
  date_de_naissance?: string;
}

interface PappersSiege {
  adresse_ligne_1?: string;
  adresse_ligne_2?: string;
  code_postal?: string;
  ville?: string;
}

interface PappersEntreprise {
  siren?: string;
  denomination?: string;
  forme_juridique?: string;
  date_creation?: string;
  tranche_effectif?: string;
  libelle_tranche_effectif?: string;
  code_naf?: string;
  libelle_code_naf?: string;
  capital?: number;
  siege?: PappersSiege;
  dirigeants?: PappersDirigeant[];
  score?: number;
}

interface PappersSearchResponse {
  resultats?: PappersEntreprise[];
  total?: number;
}

// ---------------------------------------------------------------------------
// Name / city normalisation helpers
// ---------------------------------------------------------------------------

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

function matchScore(
  businessName: string,
  location: string,
  result: PappersEntreprise
): number {
  const normBiz = normalizeName(businessName);
  const normResult = normalizeName(result.denomination || "");
  const city = cityFromLocation(location);
  const resultCity = stripAccents(
    (result.siege?.ville || "").toLowerCase()
  );

  let score = 0;

  // City match
  if (
    city &&
    resultCity &&
    (resultCity.includes(city) || city.includes(resultCity))
  ) {
    score += 40;
  }

  // Word-level name overlap
  const bizWords = normBiz.split(" ").filter((w) => w.length > 2);
  const resultWords = normResult.split(" ").filter((w) => w.length > 2);

  if (bizWords.length > 0) {
    let matched = 0;
    for (const word of bizWords) {
      if (
        resultWords.some(
          (rw) => rw.includes(word) || word.includes(rw)
        )
      ) {
        matched++;
      }
    }
    score += Math.round((matched / bizWords.length) * 60);
  }

  return score;
}

// ---------------------------------------------------------------------------
// Tranche effectif → human-readable string
// ---------------------------------------------------------------------------

function formatEmployeeCount(tranche: string | undefined): string | null {
  if (!tranche) return null;
  // Pappers returns numeric codes; if it's already a label, use it
  const map: Record<string, string> = {
    NN: "Non renseigné",
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

// ---------------------------------------------------------------------------
// Detail endpoint — always returns full dirigeant list
// ---------------------------------------------------------------------------

async function fetchDirigeants(
  siren: string,
  apiKey: string,
  log: (msg: string) => void
): Promise<PappersDirigeant[]> {
  try {
    const url =
      `https://api.pappers.fr/v2/entreprise` +
      `?siren=${encodeURIComponent(siren)}` +
      `&api_token=${encodeURIComponent(apiKey)}`;

    const res = await fetch(url, {
      signal: AbortSignal.timeout(8000),
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return [];

    const data = (await res.json()) as { dirigeants?: PappersDirigeant[] };
    return data.dirigeants || [];
  } catch {
    log(`[Pappers API] Detail fetch failed for SIREN ${siren}`);
    return [];
  }
}

function dirigeantToInfo(d: PappersDirigeant): PappersDirigeantInfo | null {
  const name = [d.prenom, d.nom].filter(Boolean).join(" ");
  if (!name) return null;
  return { name, role: d.qualite || null };
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export async function searchPappersApi(
  businessName: string,
  location: string,
  log: (msg: string) => void
): Promise<PappersResult | null> {
  const apiKey = process.env.PAPPERS_API_KEY;
  if (!apiKey) {
    log("[Pappers] PAPPERS_API_KEY not set — skipping");
    return null;
  }

  const city = cityFromLocation(location);
  const queries = [
    city ? `${businessName} ${city}` : businessName,
    businessName,
  ].filter((q, i, a) => a.indexOf(q) === i);

  for (const query of queries) {
    try {
      log(`[Pappers API] "${query}"`);
      const url =
        `https://api.pappers.fr/v2/recherche` +
        `?q=${encodeURIComponent(query)}` +
        `&precision=standard` +
        `&nombre=10` +
        `&api_token=${encodeURIComponent(apiKey)}`;

      const res = await fetch(url, {
        signal: AbortSignal.timeout(8000),
        headers: { Accept: "application/json" },
      });

      if (!res.ok) {
        log(`[Pappers API] ✗ HTTP ${res.status}`);
        continue;
      }

      const data: PappersSearchResponse = await res.json();
      const results = data.resultats || [];

      if (results.length === 0) {
        log(`[Pappers API] No results for "${query}"`);
        continue;
      }

      const scored = results
        .map((r) => ({ r, score: matchScore(businessName, location, r) }))
        .sort((a, b) => b.score - a.score);

      const best = scored[0];
      if (best.score < 25) {
        log(`[Pappers API] Best match score too low (${best.score}) for "${query}"`);
        continue;
      }

      const e = best.r;

      // Build dirigeant list from search results first
      let dirigeants = (e.dirigeants || []).map(dirigeantToInfo).filter(Boolean) as PappersDirigeantInfo[];

      // If search results have no dirigeants, fetch from the detail endpoint
      if (dirigeants.length === 0 && e.siren) {
        log(`[Pappers API] No dirigeants in search — fetching detail for SIREN ${e.siren}`);
        const detailDirs = await fetchDirigeants(e.siren, apiKey, log);
        dirigeants = detailDirs.map(dirigeantToInfo).filter(Boolean) as PappersDirigeantInfo[];
        if (dirigeants.length > 0) {
          log(`[Pappers API] Detail returned ${dirigeants.length} dirigeant(s): ${dirigeants[0].name}`);
        }
      }

      const owner = dirigeants[0] ?? null;

      const s = e.siege;
      const address = s
        ? [s.adresse_ligne_1, s.adresse_ligne_2, s.code_postal, s.ville]
            .filter(Boolean)
            .join(", ")
        : null;

      const result: PappersResult = {
        owner_name: owner?.name ?? null,
        owner_role: owner?.role ?? null,
        siren: e.siren || null,
        company_type: e.forme_juridique || null,
        creation_date: e.date_creation || null,
        employee_count: formatEmployeeCount(e.tranche_effectif),
        address: address || null,
        naf_code: e.code_naf
          ? `${e.code_naf}${e.libelle_code_naf ? ` — ${e.libelle_code_naf}` : ""}`
          : null,
        capital: e.capital != null ? `${e.capital.toLocaleString("fr-FR")} €` : null,
        all_dirigeants: dirigeants,
      };

      log(
        `[Pappers API] ✓ ${result.owner_name || "—"} | ${result.company_type || "—"} | SIREN: ${result.siren || "—"} | ${dirigeants.length} dirigeant(s) (score ${best.score})`
      );
      return result;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log(`[Pappers API] ✗ ${msg.slice(0, 80)}`);
    }
  }

  log(`[Pappers API] No legal data found for "${businessName}"`);
  return null;
}
