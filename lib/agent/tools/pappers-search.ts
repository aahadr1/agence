import { registerTool } from "../tool-registry";
import {
  isPappersApiError,
  searchPappersApi,
} from "@/lib/lead-agent/sources/pappers-api";
import { findWorksetItemByTitle } from "../workset-state";

registerTool(
  {
    name: "pappers_search",
    description:
      "Search French company registry (Pappers). Prefer passing address_hint from Google Maps (full street + postal + city) — it disambiguates homonyms (e.g. another SCI with the same trade name elsewhere). If you already have the 9-digit SIREN, pass siren to skip fuzzy search entirely.",
    parameters: {
      business_name: { type: "string", description: "Business name to search" },
      location: { type: "string", description: "City or region in France" },
      address_hint: {
        type: "string",
        description:
          "Full address from Google Maps listing for this exact venue (strongly recommended after google_maps_search)",
        required: false,
      },
      siren: {
        type: "string",
        description: "9-digit SIREN if known — fetches the company sheet directly",
        required: false,
      },
    },
    required: ["business_name", "location"],
    costEstimateCents: 2,
  },
  async (args, context) => {
    if (!process.env.PAPPERS_API_KEY?.trim()) {
      throw new Error(
        "Pappers : variable PAPPERS_API_KEY absente sur le serveur. [NON_RETRYABLE] " +
          "Configure la clé API Pappers ou utilise Societe.com / recherche web à la place.",
      );
    }
    const log = (msg: string) => console.log(`[pappers_search] ${msg}`);
    let addressHint = (args.address_hint as string) || null;
    let siren = (args.siren as string) || null;
    if (context.sessionId && (!addressHint || !siren)) {
      try {
        const item = await findWorksetItemByTitle(
          context.sessionId,
          args.business_name as string,
        );
        if (item) {
          addressHint =
            addressHint ||
            (typeof item.facts.address === "string" ? item.facts.address : null);
          siren =
            siren ||
            (typeof item.facts.siren === "string" ? item.facts.siren : null);
        }
      } catch {
        /* workset lookup is best-effort */
      }
    }
    const res = await searchPappersApi(
      args.business_name as string,
      args.location as string,
      log,
      {
        address_hint: addressHint,
        siren,
      },
    );
    if (isPappersApiError(res)) {
      if (res.code === "missing_api_key" || res.code === "unauthorized") {
        throw new Error(
          `${res.error} [NON_RETRYABLE] Ne relance pas pappers_search avec les mêmes paramètres : configure PAPPERS_API_KEY (tableau de bord Pappers) ou corrige la clé, puis poursuis avec Societe.com / recherche web.`,
        );
      }
    }
    return res;
  }
);
