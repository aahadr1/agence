import { registerTool } from "../tool-registry";
import {
  isSocieteComApiError,
  searchSocieteComApi,
} from "@/lib/lead-agent/sources/societe-com-api";

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
    return res;
  }
);
