import { tool } from "@opencode-ai/plugin";
import { fetchJson, normalizeName, cityFromLocation, postalFromLocation } from "./_shared";

const BASE = "https://api.societe.com/api/v1";

interface SearchHit {
  nomcommercial?: string;
  status?: string;
  siren?: string;
  cpville?: string;
  dep?: string;
  nafcode?: string;
}

interface InfoLegales {
  siren?: string;
  denorcs?: string;
  catjurlibrcs?: string;
  datecrearcs?: string;
  capital?: string;
  voieadressagercs?: string;
  codepostalrcs?: string;
  villercs?: string;
  nafrcs?: string;
  naflibrcs?: string;
  trancheeffinsee?: string;
}

interface DirigeantApi {
  type?: string;
  titre?: string;
  prenompp?: string;
  nompp?: string;
  datefin?: string;
}

async function apiGet<T>(path: string, token: string) {
  return fetchJson<T>(`${BASE}${path}`, {
    headers: {
      Accept: "application/json",
      "X-Authorization": `socapi ${token}`,
    },
  });
}

export default tool({
  description:
    "Recherche une entreprise française dans la base Société.com (API PRO). Retourne dirigeant, légal, adresse RCS, effectif. Backup à Pappers (souvent meilleur pour les dirigeants personnes physiques).",
  args: {
    business_name: tool.schema.string(),
    location: tool.schema.string().describe("Ville ou CP+ville"),
    address_hint: tool.schema.string().optional(),
  },
  async execute(args) {
    const token = (process.env.SOCIETE_API_KEY || process.env.SOCIETE_COM_API_KEY)?.trim();
    if (!token) return { error: "SOCIETE_API_KEY non configurée." };

    const dep = postalFromLocation(args.location)?.slice(0, 2);
    const q = encodeURIComponent(args.business_name);

    const search = await apiGet<{ data?: SearchHit[] }>(
      `/societe/search/${q}${dep ? `?dep=${dep}` : ""}`,
      token,
    );
    if (!search.ok) return { error: search.error, http_status: search.status };
    const hits = search.data?.data ?? [];
    if (hits.length === 0) return { found: false, reason: "no_match" };

    const city = cityFromLocation(args.location);
    const norm = normalizeName(args.business_name);
    let best: SearchHit | null = null;
    let bestScore = 0;
    for (const h of hits) {
      const hName = normalizeName(h.nomcommercial ?? "");
      const hCpv = (h.cpville ?? "").toLowerCase();
      let s = 0;
      if (city && hCpv.includes(city)) s += 40;
      const bw = norm.split(" ").filter((w) => w.length > 2);
      const hw = hName.split(" ").filter((w) => w.length > 2);
      if (bw.length) {
        let m = 0;
        for (const w of bw) if (hw.some((rw) => rw.includes(w) || w.includes(rw))) m++;
        s += Math.round((m / bw.length) * 50);
      }
      if (h.status === "active") s += 5;
      if (s > bestScore) {
        bestScore = s;
        best = h;
      }
    }
    if (!best?.siren || bestScore < 35) {
      return { found: false, reason: "low_confidence", best_score: bestScore };
    }

    const [info, dirs] = await Promise.all([
      apiGet<{ data?: InfoLegales }>(`/societe/${best.siren}/infoslegales`, token),
      apiGet<{ data?: DirigeantApi[] }>(`/societe/${best.siren}/dirigeants`, token),
    ]);

    const il = info.ok ? info.data?.data : undefined;
    const dl = dirs.ok ? dirs.data?.data ?? [] : [];

    const current = dl.filter((d) => !d.datefin?.trim());
    const ppCurrent = current.filter((d) => d.type === "PP");
    const owner =
      ppCurrent.find((d) =>
        /gérant|gerant|président|president|directeur|dg|fondateur/i.test(d.titre ?? ""),
      ) ?? ppCurrent[0] ?? current[0];

    return {
      found: true,
      siren: best.siren,
      denomination: il?.denorcs ?? best.nomcommercial ?? null,
      company_type: il?.catjurlibrcs ?? null,
      creation_date: il?.datecrearcs?.replace(/^(\d{4})(\d{2})(\d{2})$/, "$1-$2-$3") ?? null,
      capital: il?.capital ?? null,
      naf_code: il?.nafrcs ?? best.nafcode ?? null,
      naf_label: il?.naflibrcs ?? null,
      employee_count: il?.trancheeffinsee ?? null,
      address: il
        ? [
            il.voieadressagercs,
            il.codepostalrcs && il.villercs ? `${il.codepostalrcs} ${il.villercs}` : il.villercs,
          ]
            .filter(Boolean)
            .join(", ")
        : null,
      owner_name: owner && owner.type === "PP"
        ? [owner.prenompp, owner.nompp].filter(Boolean).join(" ").trim() || null
        : null,
      owner_role: owner?.titre ?? null,
    };
  },
});
