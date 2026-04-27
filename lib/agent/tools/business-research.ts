import { registerTool } from "../tool-registry";
import type { AgentContext } from "../types";
import {
  extractRenderedText,
  searchWebWithBrowser,
} from "./v1-browser-utils";
import { getAgentDb } from "./_db";

const V1_WORKSPACE_KEY = "v1_prospect_workspace";

type BusinessInput = {
  business_name: string;
  location?: string | null;
  address?: string | null;
  phone?: string | null;
  website_url?: string | null;
  google_maps_url?: string | null;
  category?: string | null;
  expected_activity?: string | null;
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
      category: String(args.category || "").trim() || null,
      expected_activity: String(args.expected_activity || "").trim() || null,
    },
  ];
}

function normalizeLoose(value: unknown): string {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function postalCode(value: unknown): string | null {
  return String(value || "").match(/\b\d{5}\b/)?.[0] || null;
}

function addressLikelyMatches(hint: string, legalAddress: string | null): boolean | null {
  if (!hint.trim() || !legalAddress?.trim()) return null;
  const hintPostal = postalCode(hint);
  const legalPostal = postalCode(legalAddress);
  if (hintPostal && legalPostal) return hintPostal === legalPostal;
  const hintTokens = normalizeLoose(hint).split(" ").filter((t) => t.length > 2);
  const legal = normalizeLoose(legalAddress);
  if (hintTokens.length === 0 || !legal) return null;
  const hits = hintTokens.filter((t) => legal.includes(t)).length;
  return hits >= Math.min(3, Math.max(1, Math.ceil(hintTokens.length / 3)));
}

function activityLikelyMatches(expected: string, naf: string | null): boolean | null {
  const e = normalizeLoose(expected);
  const n = normalizeLoose(naf);
  if (!e || !n) return null;
  if (/restaurant|restauration|brasserie|bistrot|cafe|traiteur/.test(e)) {
    if (/restaurant|restauration|debit de boissons|traiteur|service des traiteurs/.test(n)) {
      return true;
    }
    if (/pharmacie|immobilier|location de terrains|holding|conseil|programmation/.test(n)) {
      return false;
    }
  }
  const expectedTokens = e.split(" ").filter((t) => t.length > 4);
  if (expectedTokens.length === 0) return null;
  return expectedTokens.some((t) => n.includes(t));
}

function prospectKey(row: Record<string, unknown>): string {
  return `${row.business_name || row.name || ""}|${row.address || row.location || ""}`
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function hasContact(row: Record<string, unknown>): boolean {
  return Boolean(String(row.phone || row.email || row.owner_phone || row.owner_email || "").trim());
}

function hasLegal(row: Record<string, unknown>): boolean {
  return Boolean(String(row.owner_name || row.siren || row.siret || "").trim());
}

function inferStatus(row: Record<string, unknown>): string {
  if (row.saved || row.lead_id) return "saved";
  if (row.status === "rejected") return "rejected";
  if (row.status === "needs_review") return "needs_review";
  if (Array.isArray(row.rejected_reasons) && row.rejected_reasons.length > 0) {
    return "needs_review";
  }
  if (hasContact(row) && hasLegal(row) && String(row.data_provenance || "").trim()) {
    return "complete";
  }
  if (hasLegal(row)) return "legal_found";
  if (hasContact(row)) return "contact_found";
  return "discovered";
}

function isRejectedCandidate(
  row: Record<string, unknown>,
  rejected: Array<Record<string, unknown>>,
): boolean {
  const name = normalizeLoose(row.business_name || row.name);
  const address = normalizeLoose(row.address || row.location);
  const siren = normalizeLoose(row.siren || row.siret);
  const maps = normalizeLoose(row.google_maps_url);
  return rejected.some((r) => {
    const rName = normalizeLoose(r.business_name || r.name);
    const rAddress = normalizeLoose(r.address || r.location);
    const rSiren = normalizeLoose(r.siren || r.siret);
    const rMaps = normalizeLoose(r.google_maps_url);
    if (siren && rSiren && siren === rSiren) return true;
    if (maps && rMaps && maps === rMaps) return true;
    if (!name || !rName || name !== rName) return false;
    if (!address || !rAddress) return true;
    return address === rAddress;
  });
}

async function persistResearchResults(
  sessionId: string,
  results: Array<Record<string, unknown>>,
): Promise<{ workspace_count: number } | null> {
  if (results.length === 0) return null;
  const db = getAgentDb();
  const { data } = await db
    .from("agent_memory")
    .select("value")
    .eq("session_id", sessionId)
    .eq("key", V1_WORKSPACE_KEY)
    .maybeSingle();
  const workspace = ((data?.value as Record<string, unknown> | null) || {}) as {
    prospects?: Array<Record<string, unknown>>;
    rejected?: Array<Record<string, unknown>>;
  } & Record<string, unknown>;
  const prospects = Array.isArray(workspace.prospects) ? workspace.prospects : [];
  const rejected = Array.isArray(workspace.rejected) ? workspace.rejected : [];
  const map = new Map<string, Record<string, unknown>>();
  for (const row of prospects) {
    const key = prospectKey(row);
    if (key) map.set(key, row);
  }
  for (const row of results) {
    if (isRejectedCandidate(row, rejected) && row.reconsider !== true) continue;
    const key = prospectKey(row);
    if (!key) continue;
    const prev = map.get(key) || {};
    const merged = {
      ...prev,
      ...row,
      updated_at: new Date().toISOString(),
    };
    map.set(key, { ...merged, status: inferStatus(merged) });
  }
  const nextWorkspace = {
    ...workspace,
    prospects: [...map.values()],
    rejected,
  };
  await db.from("agent_memory").upsert(
    {
      session_id: sessionId,
      key: V1_WORKSPACE_KEY,
      value: nextWorkspace,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "session_id,key" },
  );
  return { workspace_count: nextWorkspace.prospects.length };
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
  const nafCode =
    (!isPappersApiError(pappers) && pappers?.naf_code) ||
    (!isSocieteComApiError(societe) && societe?.naf_code) ||
    null;
  const addressHint = String(business.address || business.location || "").trim();
  const address_match = addressLikelyMatches(addressHint, legalAddress);
  const expectedActivity = String(
    business.expected_activity || business.category || "",
  ).trim();
  const activity_match = activityLikelyMatches(expectedActivity, nafCode);

  if (!ownerName && !siren) rejected_reasons.push("No verified owner or SIREN found yet");
  if (!business.phone && browserData.phones.length === 0 && browserData.emails.length === 0) {
    rejected_reasons.push("No verified contact phone or email found yet");
  }
  if (address_match === false) {
    rejected_reasons.push(
      `Legal entity address does not match candidate locality (${addressHint} vs ${legalAddress})`,
    );
  }
  if (activity_match === false) {
    rejected_reasons.push(
      `Legal activity does not match expected activity (${expectedActivity} vs ${nafCode})`,
    );
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
    naf_code: nafCode,
    revenue_bracket:
      legal && "revenue_bracket" in legal
        ? String(legal.revenue_bracket || "") || null
        : null,
    confidence_score: confidence,
    status: rejected_reasons.length ? "needs_review" : "complete",
    rejected_reasons,
    legal_match: {
      address_hint: addressHint || null,
      legal_address: legalAddress,
      address_match,
      expected_activity: expectedActivity || null,
      naf_code: nafCode,
      activity_match,
    },
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
      category: { type: "string", description: "Known Maps/category label", required: false },
      expected_activity: {
        type: "string",
        description: "Expected sector/activity to verify against NAF/legal data",
        required: false,
      },
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
    let persisted: { workspace_count: number } | null = null;
    if (context.sessionId) {
      persisted = await persistResearchResults(context.sessionId, results);
    }
    return {
      count: results.length,
      results,
      auto_persisted: Boolean(persisted),
      workspace_count: persisted?.workspace_count || null,
      guidance:
        "Results were persisted to prospect_list when a session is active. Save/export complete rows with prospect_list. For needs_review rows, either run another research strategy or reject with a reason.",
    };
  },
);
