"use client";

import { PageHeader } from "@/components/ui/page-header";
import { Panel } from "@/components/ui/panel";
import { createSearchContext } from "@/lib/lead-agent/search-context";
import {
  Lead,
  LeadList,
  LeadListItem,
  LeadListSearchContext,
  LeadSearch,
} from "@/lib/types";
import {
  Search,
  MapPin,
  Loader2,
  Building2,
  CheckCircle2,
  XCircle,
  AlertCircle,
  LayoutList,
  History,
} from "lucide-react";
import { useState, useEffect, useCallback, useRef } from "react";
import { LeadCard } from "./components/lead-card";
import { LeadDrawer } from "./components/lead-drawer";
import { ListPanel } from "./components/list-panel";
import { SelectBar } from "./components/select-bar";
import { OutreachModal } from "./components/outreach-modal";

type SearchPhase = "idle" | "searching" | "analyzing" | "completed" | "failed";
type ViewTab = "search" | "lists";
type SortBy = "score" | "date" | "name";

/** Safely parse a fetch response — handles non-JSON (HTML error pages, plain text) */
async function safeJson(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(
      res.ok
        ? `Invalid response: ${text.slice(0, 150)}`
        : `Server error (${res.status}): ${text.slice(0, 150)}`
    );
  }
}

export default function LeadGeneratorPage() {
  const [niche, setNiche] = useState("");
  const [location, setLocation] = useState("");
  const [phase, setPhase] = useState<SearchPhase>("idle");
  const [phaseMessage, setPhaseMessage] = useState("");
  const [leads, setLeads] = useState<Lead[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pastSearches, setPastSearches] = useState<LeadSearch[]>([]);
  const [selectedSearchId, setSelectedSearchId] = useState<string | null>(null);

  // Lists
  const [lists, setLists] = useState<LeadList[]>([]);
  const [activeListId, setActiveListId] = useState<string | null>(null);
  const [listItems, setListItems] = useState<LeadListItem[]>([]);
  const [viewTab, setViewTab] = useState<ViewTab>("search");
  const [latestSearchContext, setLatestSearchContext] =
    useState<LeadListSearchContext | null>(null);

  // Selection
  const [selectedLeadIds, setSelectedLeadIds] = useState<Set<string>>(new Set());

  // V2 multi-offer filters + sort
  const [activeFilter, setActiveFilter] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<SortBy>("score");

  // Lead detail drawer
  const [drawerLead, setDrawerLead] = useState<Lead | null>(null);

  // Enrichment
  const [enrichmentProgress, setEnrichmentProgress] = useState<{ done: number; total: number } | null>(null);
  const enrichAbortRef = useRef(false);

  // Outreach
  const [outreachModal, setOutreachModal] = useState<{
    businessName: string;
    template: string;
  } | null>(null);
  const [generatingOutreachId, setGeneratingOutreachId] = useState<string | null>(null);

  // Load data on mount
  useEffect(() => {
    const fetchData = async () => {
      const [searchesRes, listsRes] = await Promise.all([
        fetch("/api/lead-generator/searches")
          .then((r) => safeJson(r))
          .catch(() => ({ searches: [] })),
        fetch("/api/lead-generator/lists")
          .then((r) => safeJson(r))
          .catch(() => ({ lists: [] })),
      ]);
      setPastSearches((searchesRes.searches as LeadSearch[]) || []);
      setLists((listsRes.lists as LeadList[]) || []);
    };
    fetchData();
  }, []);

  const loadLeads = useCallback(
    async (searchId: string) => {
      try {
        const res = await fetch(`/api/lead-generator/searches/${searchId}/leads`);
        const data = await safeJson(res);
        setLeads((data.leads as Lead[]) || []);
      } catch {
        setLeads([]);
      }
      setSelectedSearchId(searchId);
      setSelectedLeadIds(new Set());
    },
    []
  );

  const loadListItems = useCallback(async (listId: string) => {
    try {
      const res = await fetch(`/api/lead-generator/lists/${listId}`);
      const data = await safeJson(res);
      setListItems((data.items as LeadListItem[]) || []);
    } catch {
      setListItems([]);
    }
    setActiveListId(listId);
  }, []);

  const refreshLists = useCallback(async () => {
    try {
      const res = await fetch("/api/lead-generator/lists");
      const data = await safeJson(res);
      setLists((data.lists as LeadList[]) || []);
    } catch {
      // keep existing lists on error
    }
  }, []);

  const buildCurrentSearchContext = useCallback((): LeadListSearchContext => {
    const fallbackLead = leads[0];
    return createSearchContext({
      niche: latestSearchContext?.niche || niche.trim() || fallbackLead?.niche || null,
      location:
        latestSearchContext?.location ||
        location.trim() ||
        fallbackLead?.location ||
        null,
      attempted_queries: latestSearchContext?.attempted_queries || [],
      attempted_keywords:
        latestSearchContext?.attempted_keywords ||
        [
          niche.trim(),
          location.trim(),
          fallbackLead?.niche || null,
          fallbackLead?.location || null,
        ].filter((value): value is string => Boolean(value)),
      successful_queries: latestSearchContext?.successful_queries || [],
      last_generated_queries: latestSearchContext?.last_generated_queries || [],
      target_min_new_leads: latestSearchContext?.target_min_new_leads || 12,
      expansion_count: latestSearchContext?.expansion_count || 0,
      last_run_added: latestSearchContext?.last_run_added || 0,
      last_expanded_at: latestSearchContext?.last_expanded_at || null,
    });
  }, [latestSearchContext, leads, niche, location]);

  /** Enrich leads one by one — call after discovery loads leads into state */
  const enrichLeads = useCallback(async (leadsToEnrich: Lead[]) => {
    const pending = leadsToEnrich.filter((l) => l.enrichment_status === "pending");
    if (pending.length === 0) return;

    enrichAbortRef.current = false;
    setEnrichmentProgress({ done: 0, total: pending.length });

    // Concurrency-3 pool: fire up to 3 /enrich requests at a time so the
    // batch finishes ~3x faster without overwhelming the serverless quota.
    const CONCURRENCY = 3;
    let done = 0;
    const queue = [...pending];
    const inFlight = new Set<Promise<void>>();

    const processLead = async (lead: Lead) => {
      if (enrichAbortRef.current) return;

      setLeads((prev) =>
        prev.map((l) =>
          l.id === lead.id ? { ...l, enrichment_status: "enriching" as const } : l
        )
      );

      try {
        const res = await fetch("/api/lead-generator/enrich", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ leadId: lead.id }),
        });
        const data = await safeJson(res);
        if (data.lead) {
          const enrichedLead = data.lead as Lead;
          setLeads((prev) =>
            prev.map((l) => (l.id === lead.id ? enrichedLead : l))
          );
          setListItems((prev) =>
            prev.map((item) =>
              item.lead_id === lead.id ? { ...item, lead: enrichedLead } : item
            )
          );
        }
      } catch {
        setLeads((prev) =>
          prev.map((l) =>
            l.id === lead.id ? { ...l, enrichment_status: "failed" as const } : l
          )
        );
      } finally {
        done += 1;
        setEnrichmentProgress({ done, total: pending.length });
      }
    };

    while (queue.length > 0 || inFlight.size > 0) {
      if (enrichAbortRef.current) break;

      while (!enrichAbortRef.current && inFlight.size < CONCURRENCY && queue.length > 0) {
        const lead = queue.shift()!;
        const p: Promise<void> = processLead(lead).finally(() => inFlight.delete(p));
        inFlight.add(p);
      }

      if (inFlight.size > 0) await Promise.race(inFlight);
    }

    setEnrichmentProgress(null);
  }, []);

  // Search handler
  const handleSearch = async () => {
    if (!niche.trim() || !location.trim()) return;

    // Abort any running enrichment
    enrichAbortRef.current = true;
    setEnrichmentProgress(null);

    setPhase("analyzing");
    setPhaseMessage(
      "AI agent browsing Google Maps with multiple search variations..."
    );
    setError(null);
    setLeads([]);
    setSelectedSearchId(null);
    setSelectedLeadIds(new Set());

    try {
      const repeatedSearchContext =
        latestSearchContext &&
        latestSearchContext.niche?.toLowerCase() === niche.trim().toLowerCase() &&
        latestSearchContext.location?.toLowerCase() === location.trim().toLowerCase()
          ? latestSearchContext
          : null;

      const searchRes = await fetch("/api/lead-generator/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          niche: niche.trim(),
          location: location.trim(),
          attemptedQueries: repeatedSearchContext?.attempted_queries || [],
          attemptedKeywords: repeatedSearchContext?.attempted_keywords || [],
        }),
      });

      const searchData = await safeJson(searchRes);
      if (!searchRes.ok) {
        throw new Error((searchData.error as string) || "Search failed");
      }

      const searchId = searchData.searchId as string;
      const leadsCount = searchData.leadsCount as number;
      const discovery = (searchData.discovery || {}) as Record<string, unknown>;
      setLatestSearchContext(
        createSearchContext({
          niche: niche.trim(),
          location: location.trim(),
          attempted_queries: (discovery.used_queries as string[]) || [],
          attempted_keywords: (discovery.attempted_keywords as string[]) || [],
          successful_queries: (discovery.successful_queries as string[]) || [],
          last_generated_queries: (discovery.generated_queries as string[]) || [],
          target_min_new_leads:
            (discovery.target_min_new_leads as number) || 12,
          last_run_added: leadsCount,
        })
      );

      setPhase("completed");
      setPhaseMessage(
        `Found ${leadsCount} businesses — now enriching each lead with detailed info...`
      );

      // Load leads from DB and display immediately
      const leadsRes = await fetch(`/api/lead-generator/searches/${searchId}/leads`);
      const leadsData = await safeJson(leadsRes);
      const loadedLeads = (leadsData.leads as Lead[]) || [];
      setLeads(loadedLeads);
      setSelectedSearchId(searchId);
      setSelectedLeadIds(new Set());

      const searchesRes = await fetch("/api/lead-generator/searches");
      const searchesData = await safeJson(searchesRes);
      setPastSearches((searchesData.searches as LeadSearch[]) || []);

      // Start enrichment in background (non-blocking)
      enrichLeads(loadedLeads);
    } catch (err) {
      setPhase("failed");
      setError(err instanceof Error ? err.message : "Something went wrong");
      setPhaseMessage("");
    }
  };

  // Selection
  const toggleSelect = (id: string) => {
    setSelectedLeadIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // List actions
  const handleCreateList = async (name: string) => {
    const searchContext = buildCurrentSearchContext();
    const res = await fetch("/api/lead-generator/lists", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        keywords: searchContext.attempted_keywords,
        searchContext,
      }),
    });
    if (res.ok) await refreshLists();
  };

  const handleCreateListWithSelected = async (name: string) => {
    const leadIds = Array.from(selectedLeadIds);
    const searchContext = buildCurrentSearchContext();
    const res = await fetch("/api/lead-generator/lists", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        leadIds,
        keywords: searchContext.attempted_keywords,
        searchContext,
      }),
    });
    if (res.ok) {
      await refreshLists();
      setSelectedLeadIds(new Set());
    }
  };

  const handleAddToList = async (listId: string) => {
    const leadIds = Array.from(selectedLeadIds);
    const searchContext = buildCurrentSearchContext();
    await fetch(`/api/lead-generator/lists/${listId}/items`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        leadIds,
        keywords: searchContext.attempted_keywords,
        searchContext,
      }),
    });
    setSelectedLeadIds(new Set());
    if (activeListId === listId) await loadListItems(listId);
    await refreshLists();
  };

  const handleDeleteList = async (listId: string) => {
    await fetch(`/api/lead-generator/lists/${listId}`, { method: "DELETE" });
    if (activeListId === listId) {
      setActiveListId(null);
      setListItems([]);
    }
    await refreshLists();
  };

  const handleExportList = (listId: string) => {
    window.open(`/api/lead-generator/lists/${listId}/export`, "_blank");
  };

  const handleExpandList = async (listId: string) => {
    const list = lists.find((l) => l.id === listId);
    if (!list) return;

    // Abort any running enrichment
    enrichAbortRef.current = true;
    setEnrichmentProgress(null);

    setPhase("analyzing");
    setPhaseMessage(`AI expanding list "${list.name}" — finding new businesses not already in the list...`);
    setError(null);
    setViewTab("lists");
    setActiveListId(listId);

    try {
      const res = await fetch(`/api/lead-generator/lists/${listId}/expand`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          niche: list.search_context?.niche || niche,
          location: list.search_context?.location || location,
        }),
      });

      const data = await safeJson(res);
      if (!res.ok) throw new Error((data.error as string) || "Expand failed");

      setPhase("completed");
      setPhaseMessage(
        ((data.message as string) ||
          `Added ${data.added} new leads to "${list.name}"`) +
          ((data.added as number) > 0 ? " — enriching..." : "")
      );

      // Reload list items and start enrichment
      const listRes = await fetch(`/api/lead-generator/lists/${listId}`);
      const listData = await safeJson(listRes);
      const items = (listData.items as LeadListItem[]) || [];
      setListItems(items);
      await refreshLists();

      // Enrich only the newly added (pending) leads
      const addedLeadIds = new Set(((data.leadIds as string[]) || []).filter(Boolean));
      const newLeads = items
        .map((i) => i.lead!)
        .filter(
          (l) =>
            l &&
            l.enrichment_status === "pending" &&
            addedLeadIds.has(l.id)
        );
      if (newLeads.length > 0) {
        enrichLeads(newLeads);
      }
    } catch (err) {
      setPhase("failed");
      setError(err instanceof Error ? err.message : "Expand failed");
      setPhaseMessage("");
    }
  };

  // Outreach
  const handleGenerateOutreach = async (leadId: string) => {
    setGeneratingOutreachId(leadId);
    try {
      const res = await fetch("/api/lead-generator/outreach", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId, language: "fr" }),
      });
      const data = await safeJson(res);
      if (data.template) {
        const lead = leads.find((l) => l.id === leadId) ||
          listItems.find((i) => i.lead_id === leadId)?.lead;
        setOutreachModal({
          businessName: lead?.business_name || "Business",
          template: data.template as string,
        });
      }
    } catch {
      // Silently fail
    }
    setGeneratingOutreachId(null);
  };

  const [pipelineLeadId, setPipelineLeadId] = useState<string | null>(null);
  const [crmFeedback, setCrmFeedback] = useState<string | null>(null);

  const handleAddToPipeline = async (leadId: string) => {
    setPipelineLeadId(leadId);
    setCrmFeedback(null);
    try {
      const res = await fetch("/api/crm/v2/opportunities/from-lead", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId }),
      });
      const data = await safeJson(res);
      if (!res.ok) {
        throw new Error((data.error as string) || "CRM error");
      }
      if (data.existing) {
        setCrmFeedback("Prospect already exists in CRM. Open CRM to continue follow-up.");
      } else {
        setCrmFeedback("Prospect added to CRM successfully.");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Pipeline error");
    } finally {
      setPipelineLeadId(null);
    }
  };

  // Filter logic
  const displayLeads = viewTab === "lists" && activeListId
    ? listItems.map((i) => i.lead!).filter(Boolean)
    : leads;

  // V2 filter logic — each filter targets a specific digital gap → offer
  const filterDefs = [
    {
      id: "hot",
      label: "Score 60+",
      offer: "Priorité",
      test: (l: Lead) => (l.potential_score ?? 0) >= 60,
    },
    {
      id: "no_site",
      label: "Pas de site",
      offer: "Site Web",
      test: (l: Lead) => !l.has_website,
    },
    {
      id: "bad_site",
      label: "Site obsolète",
      offer: "Refonte",
      test: (l: Lead) =>
        l.has_website === true &&
        (l.website_quality === "dead" ||
          l.website_quality === "outdated" ||
          l.website_quality === "poor" ||
          (l.website_score != null && l.website_score < 50)),
    },
    {
      id: "has_owner",
      label: "Dirigeant ID",
      offer: "Appel direct",
      test: (l: Lead) => !!l.owner_name,
    },
    {
      id: "no_booking",
      label: "Pas de résa",
      offer: "Chatbot/RDV",
      test: (l: Lead) => l.has_booking === false,
    },
    {
      id: "no_ads",
      label: "Pas de pub",
      offer: "Ads Meta",
      test: (l: Lead) => l.has_meta_ads === false,
    },
    {
      id: "no_chatbot",
      label: "Pas de chatbot",
      offer: "Chatbot IA",
      test: (l: Lead) => l.has_chatbot === false,
    },
  ];

  const filterCounts = filterDefs.map((f) => ({
    ...f,
    count: displayLeads.filter(f.test).length,
  }));

  const filteredLeads = (() => {
    const base = activeFilter
      ? displayLeads.filter(
          filterDefs.find((f) => f.id === activeFilter)?.test || (() => true)
        )
      : displayLeads;

    return [...base].sort((a, b) => {
      if (sortBy === "score") {
        return (b.potential_score ?? -1) - (a.potential_score ?? -1);
      }
      if (sortBy === "name") {
        return a.business_name.localeCompare(b.business_name, "fr");
      }
      // "date" — keep original order (insertion order = discovery order)
      return 0;
    });
  })();

  return (
    <div className="animate-fade-in">
      <PageHeader
        eyebrow="Prospecting"
        title="Lead generator"
        description="Niche plus location. The agent maps the market, then enriches each row."
      />

      <Panel padding="md" className="mb-8 rounded-sm">
        <div className="mb-6 grid grid-cols-1 gap-5 md:grid-cols-2">
          <div>
            <label className="label-eyebrow mb-2 block">Niche</label>
            <div className="relative">
              <Building2 className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" strokeWidth={1.25} />
              <input
                type="text"
                value={niche}
                onChange={(e) => setNiche(e.target.value)}
                placeholder="Restaurant, plumber, salon…"
                className="input-minimal"
                style={{ paddingLeft: "2.5rem" }}
                disabled={phase === "analyzing"}
              />
            </div>
          </div>
          <div>
            <label className="label-eyebrow mb-2 block">Location</label>
            <div className="relative">
              <MapPin className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" strokeWidth={1.25} />
              <input
                type="text"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="City, arrondissement, region…"
                className="input-minimal"
                style={{ paddingLeft: "2.5rem" }}
                disabled={phase === "analyzing"}
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              />
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={handleSearch}
          disabled={!niche.trim() || !location.trim() || phase === "analyzing"}
          className="btn-solid disabled:cursor-not-allowed"
        >
          {phase === "analyzing" ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Researching
            </>
          ) : (
            <>
              <Search className="h-4 w-4" strokeWidth={1.25} />
              Run search
            </>
          )}
        </button>

        {phase !== "idle" && phaseMessage ? (
          <div className="mt-6 flex gap-3 border-t border-border pt-6">
            {phase === "analyzing" || enrichmentProgress ? (
              <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
            ) : phase === "completed" ? (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-foreground" strokeWidth={1.25} />
            ) : (
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" strokeWidth={1.25} />
            )}
            <div>
              <p className="text-sm leading-relaxed text-foreground">{phaseMessage}</p>
              {phase === "analyzing" ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {["Query expansion", "Maps discovery"].map((s) => (
                    <span
                      key={s}
                      className="border border-border px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground"
                    >
                      {s}
                    </span>
                  ))}
                </div>
              ) : null}
              {enrichmentProgress ? (
                <div className="mt-3">
                  <div className="flex items-center gap-3">
                    <div className="h-1 flex-1 bg-border">
                      <div
                        className="h-1 bg-foreground transition-all duration-500"
                        style={{ width: `${((enrichmentProgress.done + 1) / enrichmentProgress.total) * 100}%` }}
                      />
                    </div>
                    <span className="text-[10px] font-medium tabular-nums text-muted-foreground">
                      {enrichmentProgress.done + 1}/{enrichmentProgress.total}
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {["Pappers API", "HTTP check", "PageSpeed", "Google", "PagesJaunes", "Facebook", "LinkedIn", "Owner", "Website", "Ad Library", "Score IA"].map((s) => (
                      <span
                        key={s}
                        className="border border-border px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground"
                      >
                        {s}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

        {error ? (
          <div className="mt-4 flex items-center gap-2 border border-destructive/25 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            <XCircle className="h-4 w-4 shrink-0" strokeWidth={1.25} />
            {error}
          </div>
        ) : null}
        {crmFeedback ? (
          <div className="mt-4 border border-foreground/20 bg-secondary/40 px-3 py-2 text-sm text-foreground">
            {crmFeedback}
          </div>
        ) : null}
      </Panel>

      <div className="grid grid-cols-1 gap-8 border-t border-border pt-10 lg:grid-cols-4">
        <div className="space-y-4 lg:col-span-1">
          <div className="flex border border-border">
            <button
              type="button"
              onClick={() => setViewTab("search")}
              className={`flex flex-1 items-center justify-center gap-1.5 border-b-2 py-2.5 text-[10px] font-medium uppercase tracking-[0.1em] transition-colors ${
                viewTab === "search"
                  ? "-mb-px border-foreground text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              <History className="h-3 w-3" strokeWidth={1.25} /> History
            </button>
            <button
              type="button"
              onClick={() => setViewTab("lists")}
              className={`flex flex-1 items-center justify-center gap-1.5 border-b-2 py-2.5 text-[10px] font-medium uppercase tracking-[0.1em] transition-colors ${
                viewTab === "lists"
                  ? "-mb-px border-foreground text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              <LayoutList className="h-3 w-3" strokeWidth={1.25} /> Lists
            </button>
          </div>

          {viewTab === "search" ? (
            <Panel padding="sm" className="rounded-sm">
              <h3 className="label-eyebrow mb-4">Past runs</h3>
              {pastSearches.length === 0 ? (
                <p className="text-xs text-muted-foreground">None yet.</p>
              ) : (
                <div className="divide-y divide-border border border-border">
                  {pastSearches.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => {
                        loadLeads(s.id);
                        setViewTab("search");
                      }}
                      className={`w-full px-3 py-3 text-left text-sm transition-colors hover:bg-secondary/40 ${
                        selectedSearchId === s.id ? "bg-secondary/50" : ""
                      }`}
                    >
                      <p className="truncate font-medium text-foreground">{s.niche}</p>
                      <p className="truncate text-xs text-muted-foreground">{s.location}</p>
                      <div className="mt-2 flex items-center justify-between">
                        <span className="font-mono text-[10px] text-muted-foreground">
                          {new Date(s.created_at).toLocaleDateString()}
                        </span>
                        <span className="text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
                          {s.status === "completed"
                            ? `${s.leads_count} leads`
                            : s.status === "failed"
                              ? "Failed"
                              : s.status}
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </Panel>
          ) : (
            <ListPanel
              lists={lists}
              activeListId={activeListId}
              onSelectList={(id) => { loadListItems(id); }}
              onCreateList={handleCreateList}
              onDeleteList={handleDeleteList}
              onExportList={handleExportList}
              onExpandList={handleExpandList}
            />
          )}
        </div>

        <div className="lg:col-span-3">
          {filteredLeads.length > 0 || displayLeads.length > 0 ? (
            <>
              <div className="mb-6 space-y-3 border-b border-border pb-4">
                {/* Filter chips */}
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-muted-foreground shrink-0">
                    {filteredLeads.length} leads
                  </span>
                  {filterCounts.map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => setActiveFilter(activeFilter === f.id ? null : f.id)}
                      className={`border px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.08em] transition-colors ${
                        activeFilter === f.id
                          ? "border-foreground bg-foreground text-primary-foreground"
                          : "border-border text-muted-foreground hover:border-foreground/25"
                      }`}
                      title={`Offre: ${f.offer}`}
                    >
                      {f.label} ({f.count})
                    </button>
                  ))}
                </div>

                {/* Sort + select row */}
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-1">
                    <span className="text-[10px] text-muted-foreground uppercase tracking-[0.08em] mr-1">
                      Trier :
                    </span>
                    {(["score", "name", "date"] as SortBy[]).map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => setSortBy(s)}
                        className={`border px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.08em] transition-colors ${
                          sortBy === s
                            ? "border-foreground bg-foreground text-primary-foreground"
                            : "border-border text-muted-foreground hover:border-foreground/25"
                        }`}
                      >
                        {s === "score" ? "Score" : s === "name" ? "Nom" : "Date"}
                      </button>
                    ))}
                  </div>

                  {displayLeads.length > 0 ? (
                    <button
                      type="button"
                      onClick={() => {
                        if (selectedLeadIds.size === filteredLeads.length) {
                          setSelectedLeadIds(new Set());
                        } else {
                          setSelectedLeadIds(new Set(filteredLeads.map((l) => l.id)));
                        }
                      }}
                      className="text-[11px] font-medium underline underline-offset-4 hover:no-underline"
                    >
                      {selectedLeadIds.size === filteredLeads.length
                        ? "Tout déselectionner"
                        : "Tout sélectionner"}
                    </button>
                  ) : null}
                </div>
              </div>

              {/* Lead cards */}
              <div className="space-y-3">
                {filteredLeads.map((lead) => (
                  <LeadCard
                    key={lead.id}
                    lead={lead}
                    selected={selectedLeadIds.has(lead.id)}
                    onSelect={toggleSelect}
                    onOpenDrawer={(l) => setDrawerLead(l)}
                    onGenerateOutreach={handleGenerateOutreach}
                    generatingOutreach={generatingOutreachId === lead.id}
                    onAddToPipeline={handleAddToPipeline}
                    addingToPipeline={pipelineLeadId === lead.id}
                  />
                ))}
              </div>
            </>
          ) : phase === "idle" ? (
            <Panel padding="lg" className="rounded-sm text-center">
              <Search className="mx-auto mb-5 h-8 w-8 text-muted-foreground" strokeWidth={1} />
              <p className="label-eyebrow mb-2">Start</p>
              <h2 className="font-display text-xl font-medium text-foreground md:text-2xl">
                Run a search
              </h2>
              <p className="mx-auto mt-2 max-w-lg text-sm leading-relaxed text-muted-foreground">
                Maps-first discovery, then enrichment across search and directories.
                Results appear in the list on the right.
              </p>
            </Panel>
          ) : null}
        </div>
      </div>

      {/* Selection action bar */}
      <SelectBar
        selectedCount={selectedLeadIds.size}
        lists={lists}
        onAddToList={handleAddToList}
        onCreateListWithSelected={handleCreateListWithSelected}
        onClearSelection={() => setSelectedLeadIds(new Set())}
        onExportSelected={() => {}}
      />

      {/* Outreach modal */}
      {outreachModal && (
        <OutreachModal
          businessName={outreachModal.businessName}
          template={outreachModal.template}
          onClose={() => setOutreachModal(null)}
        />
      )}

      {/* Lead detail drawer */}
      <LeadDrawer
        lead={drawerLead}
        onClose={() => setDrawerLead(null)}
        onAddToPipeline={handleAddToPipeline}
        addingToPipeline={pipelineLeadId === drawerLead?.id}
        onGenerateOutreach={handleGenerateOutreach}
        generatingOutreach={generatingOutreachId === drawerLead?.id}
      />
    </div>
  );
}
