import { registerTool } from "../tool-registry";
import { searchPappersApi } from "@/lib/lead-agent/sources/pappers-api";

registerTool(
  {
    name: "pappers_search",
    description:
      "Search French company registry (Pappers) by business name and location. Returns owner name, SIREN, company type, creation date, employee count, address, revenue bracket.",
    parameters: {
      business_name: { type: "string", description: "Business name to search" },
      location: { type: "string", description: "City or region in France" },
    },
    required: ["business_name", "location"],
    costEstimateCents: 2,
  },
  async (args) => {
    const log = (msg: string) => console.log(`[pappers_search] ${msg}`);
    return await searchPappersApi(
      args.business_name as string,
      args.location as string,
      log
    );
  }
);
