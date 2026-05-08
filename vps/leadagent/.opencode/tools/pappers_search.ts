import { tool } from "@opencode-ai/plugin";
import {
  fetchJson,
  normalizeName,
  cityFromLocation,
  PAPPERS_TRANCHE,
} from "./_shared";

interface Dirigeant {
  nom?: string;
  prenom?: string;
  qualite?: string;
}

interface Entreprise {
  siren?: string;
  denomination?: string;
  forme_juridique?: string;
  date_creation?: string;
  tranche_effectif?: string;
  code_naf?: string;
  libelle_code_naf?: string;
  capital?: number;
  siege?: {
    adresse_ligne_1?: string;
    code_postal?: string;
    ville?: string;
  };
  dirigeants?: Dirigeant[];
}

interface SearchResponse {
  resultats?: Entreprise[];
  total?: number;
}

export default tool({
  description:
    "Recherche une entreprise dans le registre du commerce français via Pappers.fr. Retourne SIREN, dirigeant principal, capital, NAF, effectif, date de création, adresse RCS. Gratuit jusqu'à 10k req/mois.",
  args: {
    business_name: tool.schema.string().describe("Nom commercial ou raison sociale"),
    location: tool.schema
      .string()
      .describe("Ville (ex: 'Lyon', '69002 Lyon', 'Paris 11e')"),
    siren: tool.schema
      .string()
      .optional()
      .describe("Si déjà connu, accélère la recherche"),
  },
  async execute(args) {
    const apiKey = process.env.PAPPERS_API_KEY?.trim();
    if (!apiKey) {
      return { error: "PAPPERS_API_KEY non configurée." };
    }

    let entreprise: Entreprise | null = null;

    if (args.siren) {
      const r = await fetchJson<Entreprise>(
        `https://api.pappers.fr/v2/entreprise?siren=${encodeURIComponent(args.siren)}&api_token=${encodeURIComponent(apiKey)}`,
      );
      if (r.ok) entreprise = r.data;
    } else {
      const q = encodeURIComponent(args.business_name);
      const r = await fetchJson<SearchResponse>(
        `https://api.pappers.fr/v2/recherche-entreprises?q=${q}&api_token=${encodeURIComponent(apiKey)}&precision=standard&par_page=10`,
      );
      if (!r.ok) {
        return { error: r.error, http_status: r.status };
      }
      const candidates = r.data.resultats ?? [];
      if (candidates.length === 0) {
        return { found: false, reason: "no_match" };
      }

      const city = cityFromLocation(args.location);
      const normName = normalizeName(args.business_name);
      let best: Entreprise | null = null;
      let bestScore = 0;
      for (const e of candidates) {
        const eName = normalizeName(e.denomination ?? "");
        const eCity = (e.siege?.ville ?? "").toLowerCase();
        let score = 0;
        if (city && eCity.includes(city)) score += 40;
        const bw = normName.split(" ").filter((w) => w.length > 2);
        const ew = eName.split(" ").filter((w) => w.length > 2);
        if (bw.length) {
          let m = 0;
          for (const w of bw) if (ew.some((rw) => rw.includes(w) || w.includes(rw))) m++;
          score += Math.round((m / bw.length) * 60);
        }
        if (score > bestScore) {
          bestScore = score;
          best = e;
        }
      }
      if (!best || bestScore < 35) {
        return { found: false, reason: "low_confidence", best_score: bestScore };
      }

      // Fetch full details (dirigeants list)
      if (best.siren) {
        const detail = await fetchJson<Entreprise>(
          `https://api.pappers.fr/v2/entreprise?siren=${encodeURIComponent(best.siren)}&api_token=${encodeURIComponent(apiKey)}`,
        );
        if (detail.ok) entreprise = detail.data;
        else entreprise = best;
      } else {
        entreprise = best;
      }
    }

    if (!entreprise) return { found: false, reason: "no_match" };

    const dirs = entreprise.dirigeants ?? [];
    const main =
      dirs.find((d) =>
        /gérant|gerant|président|president|directeur|fondateur/i.test(d.qualite ?? ""),
      ) ?? dirs[0];

    return {
      found: true,
      siren: entreprise.siren ?? null,
      denomination: entreprise.denomination ?? null,
      company_type: entreprise.forme_juridique ?? null,
      creation_date: entreprise.date_creation ?? null,
      employee_count: PAPPERS_TRANCHE[entreprise.tranche_effectif ?? ""] ?? entreprise.tranche_effectif ?? null,
      naf_code: entreprise.code_naf ?? null,
      naf_label: entreprise.libelle_code_naf ?? null,
      capital: entreprise.capital ?? null,
      address: entreprise.siege
        ? [
            entreprise.siege.adresse_ligne_1,
            entreprise.siege.code_postal && entreprise.siege.ville
              ? `${entreprise.siege.code_postal} ${entreprise.siege.ville}`
              : entreprise.siege.ville,
          ]
            .filter(Boolean)
            .join(", ")
        : null,
      owner_name: main ? [main.prenom, main.nom].filter(Boolean).join(" ").trim() || null : null,
      owner_role: main?.qualite ?? null,
      all_dirigeants: dirs.map((d) => ({
        name: [d.prenom, d.nom].filter(Boolean).join(" ").trim() || null,
        role: d.qualite ?? null,
      })),
    };
  },
});
