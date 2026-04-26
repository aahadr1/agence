import { registerTool } from "../tool-registry";
import type { AgentContext } from "../types";
import {
  extractRenderedText,
  searchWebWithBrowser,
} from "./v1-browser-utils";

type BusinessInput = {
  business_name: string;
  location?: string | null;
  address?: string | null;
  phone?: string | null;
  website_url?: string | null;
  google_maps_url?: string | null;
};

function asBusinessList(args: Record<string, unknown>): BusinessInput[] {
  if (Array.isArray(args.businesses)) {
    return args.businesses
      .filter((x) => x && typeof x === "object")
      .map((x) => x as BusinessInput)
      .filter((x) => String(x.business_name || "").trim());
  }
  const name = String(args.business_name || "").trim();
  if (!name) return [];
  return [
    {
      business_name: name,
      location: String(args.location || "").trim() || null,
      address: String(args.address || "").trim() || null,
      phone: String(args.phone || "").trim() || null,
      website_url: String(args.website_url || "").trim() || null,
      google_maps_url: String(args.google_maps_url || "").trim() || null,
    },
  ];
}

function extractEmails(text: string): string[] {
  return [
    ...new Set(
      (text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || []).map((e) =>
        e.toLowerCase(),
      ),
    ),
  ].slice(0, 5);
}

function extractPhones(text: string): string[] {
  return [
    ...new Set(
      (text.match(/(?:\+33|0)\s?[1-9](?:[\s().-]?\d{2}){4}/g) || []).map((p) =>
        p.replace(/\s+/g, " ").trim(),
      ),
    ),
  ].slice(0, 5);
}

function findLikelyWebsite(
  results: Array<{ title: string; url: string; snippet: string }>,
  businessName: string,
): string | null {
  const badHosts = [
    "google.",
    "societe.com",
    "pappers.fr",
    "pagesjaunes.fr",
    "facebook.com",
    "instagram.com",
    "linkedin.com",
    "tripadvisor.",
    "yelp.",
  ];
  const terms = businessName.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
  for (const r of results) {
    try {
      const host = new URL(r.url).hostname.replace(/^www\./, "").toLowerCase();
      if (badHosts.some((h) => host.includes(h))) continue;
      const hay = `${r.title} ${host}`.toLowerCase();
      if (terms.some((t) => hay.includes(t))) return r.url;
    } catch {
      /* skip */
    }
  }
  return null;
}

async function researchOne(
  business: BusinessInput,
  context: AgentContext,
): Promise<Record<string, unknown>> {
  const name = String(business.business_name || "").trim();
  const location = String(business.location || business.address || "").trim();
  const sources: Array<Record<string, unknown>> = [];
  const rejected_reasons: string[] = [];

  const { searchPappersApi, isPappersApiError } = await import(
    "@/lib/lead-agent/sources/pappers-api"
  );
  const { searchSocieteComApi, isSocieteComApiError } = await import(
    "@/lib/lead-agent/sources/societe-com-api"
  );
  const { withBrowserSession, safeGoto } = await import(
    "@/lib/lead-agent/browser"
  );

  const [pappers, societe] = await Promise.all([
    searchPappersApi(
      name,
      location,
      (msg) => console.log(`[business_research:pappers] ${msg}`),
      {
        address_hint: business.address || null,
      },
    ),
    searchSocieteComApi(
      name,
      location,
      (msg) => console.log(`[business_research:societe] ${msg}`),
      {
        address_hint: business.address || undefined,
      },
    ),
  ]);

  if (isPappersApiError(pappers)) {
    sources.push({
      source: "pappers_api",
      ok: false,
      error: pappers.error,
      code: pappers.code,
    });
  } else if (pappers) {
    sources.push({ source: "pappers_api", ok: true, data: pappers });
  } else {
    sources.push({ source: "pappers_api", ok: false, error: "not_found_or_unavailable" });
  }

  if (isSocieteComApiError(societe)) {
    sources.push({
      source: "societe_com_api",
      ok: false,
      error: societe.error,
      code: societe.code,
    });
  } else if (societe) {
    sources.push({ source: "societe_com_api", ok: true, data: societe });
  } else {
    sources.push({ source: "societe_com_api", ok: false, error: "not_found_or_unavailable" });
  }

  const browserData = await withBrowserSession(
    async (session) => {
      const queries = [
        `"${name}" ${location}`,
        `"${name}" ${location} contact email telephone`,
        `"${name}" ${location} mentions legales dirigeant`,
        `"${name}" ${location} societe.com`,
      ].filter((q, i, a) => q.trim() && a.indexOf(q) === i);

      const searches = [];
      for (const query of queries) {
        const res = await searchWebWithBrowser(session.page, query, 8, "google");
        searches.push({ query, provider: res.provider, results: res.results });
      }

      const flatResults = searches.flatMap((s) => s.results);
      const website =
        business.website_url ||
        findLikelyWebsite(flatResults, name) ||
        null;
      const pages: Array<Record<string, unknown>> = [];
      let combinedText = "";

      const urls = [
        website,
        website ? new URL("/contact", website).toString() : null,
        website ? new URL("/mentions-legales", website).toString() : null,
      ].filter(Boolean) as string[];

      for (const url of urls) {
        const loaded = await safeGoto(session.page, url);
        if (!loaded) {
          pages.push({ url, ok: false });
          continue;
        }
        const text = await extractRenderedText(session.page, 10000);
        combinedText += `\n\nURL: ${session.page.url()}\n${text.text}`;
        pages.push({
          url,
          final_url: session.page.url(),
          ok: true,
          title: text.title,
          emails: extractEmails(text.text),
          phones: extractPhones(text.text),
        });
      }

      return {
        searches,
        website,
        pages,
        emails: extractEmails(combinedText),
        phones: extractPhones(combinedText),
      };
    },
    { orgId: context.orgId, attempts: 8 },
  );

  sources.push({
    source: "browser_web",
    ok: true,
    searches: browserData.searches.map((s) => ({
      query: s.query,
      provider: s.provider,
      count: s.results.length,
      top_results: s.results.slice(0, 5),
    })),
    pages: browserData.pages,
  });

  const legal = !isPappersApiError(pappers) && pappers ? pappers : !isSocieteComApiError(societe) ? societe : null;
  const ownerName =
    (!isPappersApiError(pappers) && pappers?.owner_name) ||
    (!isSocieteComApiError(societe) && societe?.owner_name) ||
    null;
  const ownerRole =
    (!isPappersApiError(pappers) && pappers?.owner_role) ||
    (!isSocieteComApiError(societe) && societe?.owner_role) ||
    null;
  const siren =
    (!isPappersApiError(pappers) && pappers?.siren) ||
    (!isSocieteComApiError(societe) && societe?.siren) ||
    null;
  const legalAddress =
    (!isPappersApiError(pappers) && pappers?.address) ||
    (!isSocieteComApiError(societe) && societe?.address) ||
    null;

  if (!ownerName && !siren) rejected_reasons.push("No verified owner or SIREN found yet");
  if (!business.phone && browserData.phones.length === 0 && browserData.emails.length === 0) {
    rejected_reasons.push("No verified contact phone or email found yet");
  }

  const confidence = Math.max(
    25,
    Math.min(
      95,
      35 +
        (siren ? 20 : 0) +
        (ownerName ? 15 : 0) +
        (business.address && legalAddress ? 10 : 0) +
        (business.phone || browserData.phones.length ? 10 : 0) +
        (browserData.website ? 5 : 0),
    ),
  );

  return {
    business_name: name,
    address: business.address || legalAddress || null,
    phone: business.phone || browserData.phones[0] || null,
    email: browserData.emails[0] || null,
    website_url: browserData.website,
    google_maps_url: business.google_maps_url || null,
    owner_name: ownerName,
    owner_role: ownerRole,
    siren,
    company_type: legal?.company_type || null,
    creation_date: legal?.creation_date || null,
    employee_count: legal?.employee_count || null,
    revenue_bracket:
      legal && "revenue_bracket" in legal
        ? String(legal.revenue_bracket || "") || null
        : null,
    confidence_score: confidence,
    status: rejected_reasons.length ? "needs_review" : "verified",
    rejected_reasons,
    sources,
    data_provenance: sources
      .filter((s) => s.ok)
      .map((s) => s.source)
      .join(" | "),
    notes:
      `Verification: ${siren ? `SIREN ${siren}` : "SIREN not found"}; ` +
      `${ownerName ? `owner ${ownerName}${ownerRole ? ` (${ownerRole})` : ""}` : "owner not found"}; ` +
      `${browserData.website ? `website ${browserData.website}` : "website not verified"}.`,
  };
}

registerTool(
  {
    name: "business_research",
    description:
      "Deeply enrich one business or a small batch. Uses Pappers API, Societe.com API, and Playwright web browsing to verify owner/legal/contact data with provenance.",
    parameters: {
      business_name: { type: "string", description: "Business name", required: false },
      location: { type: "string", description: "City/region", required: false },
      address: { type: "string", description: "Known address", required: false },
      phone: { type: "string", description: "Known phone", required: false },
      website_url: { type: "string", description: "Known website", required: false },
      google_maps_url: { type: "string", description: "Google Maps URL", required: false },
      businesses: {
        type: "array",
        description: "Optional batch of business objects; max 5 per call",
        items: { type: "object" },
        required: false,
      },
    },
    required: [],
    costEstimateCents: 5,
  },
  async (args, context: AgentContext) => {
    const businesses = asBusinessList(args).slice(0, 5);
    if (businesses.length === 0) {
      throw new Error("business_research requires business_name or businesses[]");
    }

    const results = [];
    for (const business of businesses) {
      results.push(await researchOne(business, context));
    }
    return {
      count: results.length,
      results,
      guidance:
        "Save verified rows with prospect_list. For needs_review rows, either run another research strategy or reject with a reason.",
    };
  },
);
