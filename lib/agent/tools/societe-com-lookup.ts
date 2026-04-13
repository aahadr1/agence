import { registerTool } from "../tool-registry";
import { searchSocieteComApi } from "@/lib/lead-agent/sources/societe-com-api";

registerTool(
  {
    name: "societe_com_lookup",
    description:
      "Search Societe.com API for French company data. Returns owner name, SIREN, NAF code, capital, revenue bracket. Backup source to Pappers.",
    parameters: {
      business_name: { type: "string", description: "Business name" },
      location: { type: "string", description: "City or region" },
    },
    required: ["business_name", "location"],
    costEstimateCents: 2,
  },
  async (args) => {
    const log = (msg: string) => console.log(`[societe_com] ${msg}`);
    return await searchSocieteComApi(
      args.business_name as string,
      args.location as string,
      log
    );
  }
);
