import { registerTool } from "../tool-registry";
import type { SocieteComResult } from "@/lib/lead-agent/sources/societe-com";
import {
  isSocieteComApiError,
  searchSocieteComApi,
} from "@/lib/lead-agent/sources/societe-com-api";

/** Rough NAF bucket to flag French House–style mismatches (consulting vs restaurant). */
function sectorAlignmentHint(naf: string | null): string | null {
  const digits = (naf || "").replace(/\D/g, "").slice(0, 5);
  if (digits.length < 2) return null;
  const pNum = parseInt(digits.slice(0, 2), 10);
  if (!Number.isFinite(pNum)) return null;
  if (pNum === 56) return "food_service_hospitality";
  if (Number.isFinite(pNum) && (pNum === 70 || pNum === 69 || pNum === 62))
    return "consulting_services_or_it";
  if (Number.isFinite(pNum) && pNum >= 45 && pNum <= 47)
    return "trade_retail";
  return null;
}

registerTool(
  {
    name: "societe_com_lookup",
    description:
      "Search Societe.com API for French company data. Returns owner name, SIREN, NAF code, capital, revenue bracket. Backup source to Pappers. Pass address_hint (full Maps address) whenever you have it — it rejects homonyms in the wrong city.",
    parameters: {
      business_name: { type: "string", description: "Business name" },
      location: { type: "string", description: "City or region" },
      address_hint: {
        type: "string",
        description:
          "Full address from Google Maps for this venue (strongly recommended)",
        required: false,
      },
    },
    required: ["business_name", "location"],
    costEstimateCents: 2,
  },
  async (args) => {
    const log = (msg: string) => console.log(`[societe_com] ${msg}`);
    const res = await searchSocieteComApi(
      args.business_name as string,
      args.location as string,
      log,
      {
        address_hint: (args.address_hint as string) || undefined,
      },
    );
    if (isSocieteComApiError(res)) {
      if (res.code === "missing_api_key" || res.code === "unauthorized") {
        throw new Error(
          `${res.error} [NON_RETRYABLE] Ne relance pas societe_com_lookup identiquement : configure SOCIETE_COM_API_KEY / allowlist IP côté Societe.com, puis utilise d’autres sources (Pappers, web).`,
        );
      }
    }
    if (!isSocieteComApiError(res) && typeof res === "object" && res !== null) {
      const r = res as SocieteComResult;
      const bucket = sectorAlignmentHint(r.naf_code);
      return {
        ...r,
        sector_alignment_hint:
          bucket ??
          "cross_check_trade_vs_maps — le nom commercial peut différer ; vérifie le NAF vs ton type d’établissement avant save_lead.",
      };
    }
    return res;
  },
);
