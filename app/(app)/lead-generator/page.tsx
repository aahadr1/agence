"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  Search,
  MapPin,
  Loader2,
  Play,
  Terminal,
  RefreshCw,
  Filter,
  Download,
  LayoutList,
  History,
  Plus,
  X,
  Flame,
  Thermometer,
  Snowflake,
  CheckCircle2,
  AlertCircle,
  ChevronDown,
} from "lucide-react";
import type { Lead, LeadSearch, LeadList, LeadListItem, LeadListSearchContext } from "@/lib/types";
import { LeadsTable } from "./components/leads-table";
import { LeadDrawer } from "./components/lead-drawer";
import { ListPanel } from "./components/list-panel";
import { SelectBar } from "./components/select-bar";
import { OutreachModal } from "./components/outreach-modal";
import { createSearchContext } from "@/lib/lead-agent/search-context";
import { cn } from "@/lib/utils";

type SearchPhase = "idle" | "searching" | "analyzing" | "completed" | "failed";
type ViewTab = "search" | "lists";
type SortBy = "score" | "date" | "name" | "priority";
type FilterPriority = "all" | "hot" | "warm" | "cold";
type FilterStatus = "all" | "pending" | "enriching" | "completed" | "failed";

async function safeJson(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text();
  try { return JSON.parse(text); }
  catch {
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
  const [latestSearchContext, setLatestSearchContext] = useState<LeadListSearchContext | null>(null);

  // Selection
  const [selectedLeadIds, setSelectedLeadIds] = useState<Set<string>>(new Set());

  // Filters
  const [filterPriority, setFilterPriority] = useState<FilterPriority>("all");
  const [filterStatus, setFilterStatus] = useState<FilterStatus>("all");
  const [sortBy, setSortBy] = useState<SortBy>("score");
  const [searchQuery, setSearchQuery] = useState("");

  // Drawer
  const [drawerLead, setDrawerLead] = useState<Lead | null>(null);

  // Enrichment
  const [enrichmentProgress, setEnrichmentProgress] = useState<{ done: number; total: number } | null>(null);
  const enrichAbortRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const enrichRunningRef = useRef(false);

  // Outreach
  const [outreachModal, setOutreachModal] = useState<{ businessName: string; template: string } | null>(null);
  const [generatingOutreachId, setGeneratingOutreachId] = useState<string | null>(null);

  // CRM
  const [pipelineLeadId, setPipelineLeadId] = useState<string | null>(null);
  const [crmFeedback, setCrmFeedback] = useState<string | null>(null);

  // Load on mount
  useEffect(() => {
    const fetchData = async () => {
      const [searchesRes, listsRes] = await Promise.all([
        fetch("/api/lead-generator/searches").then(safeJson).catch(() => ({ searches: [] })),
        fetch("/api/lead-generator/lists").then(safeJson).catch(() => ({ lists: [] })),
      ]);
      setPastSearches((searchesRes.searches as LeadSearch[]) || []);
      setLists((listsRes.lists as LeadList[]) || []);
    };
    fetchData();
  }, []);

  // Poll for enrichment progress when leads are pending/enriching
  useEffect(() => {
    if (!selectedSearchId) return;
    const hasPending = leads.some(
      (l) => l.enrichment_status === "pending" || l.enrichment_status === "enriching"
    );
    if (!hasPending) return;

    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/lead-generator/searches/${selectedSearchId}/leads`);
        const data = await safeJson(res);
        const updated = (data.leads as Lead[]) || [];
        setLeads((prev) =>
          prev.map((l) => {
            const fresh = updated.find((u) => u.id === l.id);
            return fresh || l;
          })
        );
      } catch { /* ignore */ }
    }, 4000);

    return () => clearInterval(interval);
  }, [selectedSearchId, leads]);

  const loadLeads = useCallback(async (searchId: string) => {
    try {
      const res = await fetch(`/api/lead-generator/searches/${searchId}/leads`);
      const data = await safeJson(res);
      setLeads((data.leads as Lead[]) || []);
    } catch { setLeads([]); }
    setSelectedSearchId(searchId);
    setSelectedLeadIds(new Set());
  }, []);

  const loadListItems = useCallback(async (listId: string) => {
    try {
      const res = await fetch(`/api/lead-generator/lists/${listId}`);
      const data = await safeJson(res);
      setListItems((data.items as LeadListItem[]) || []);
    } catch { setListItems([]); }
    setActiveListId(listId);
  }, []);

  const refreshLists = useCallback(async () => {
    try {
      const res = await fetch("/api/lead-generator/lists");
      const data = await safeJson(res);
      setLists((data.lists as LeadList[]) || []);
    } catch { /* keep existing */ }
  }, []);

  const buildCurrentSearchContext = useCallback((): LeadListSearchContext => {
    const fallbackLead = leads[0];
    return createSearchContext({
      niche: latestSearchContext?.niche || niche.trim() || fallbackLead?.niche || null,
      location: latestSearchContext?.location || location.trim() || fallbackLead?.location || null,
      attempted_queries: latestSearchContext?.attempted_queries || [],
      attempted_keywords: latestSearchContext?.attempted_keywords || [niche.trim(), location.trim()].filter(Boolean),
      successful_queries: latestSearchContext?.successful_queries || [],
      last_generated_queries: latestSearchContext?.last_generated_queries || [],
      target_min_new_leads: latestSearchContext?.target_min_new_leads || 12,
      expansion_count: latestSearchContext?.expansion_count || 0,
      last_run_added: latestSearchContext?.last_run_added || 0,
      last_expanded_at: latestSearchContext?.last_expanded_at || null,
    });
  }, [latestSearchContext, leads, niche, location]);

  const enrichLeads = useCallback(async (leadsToEnrich: Lead[]) => {
    const pending = leadsToEnrich.filter((l) => l.enrichment_status === "pending");
    if (pending.length === 0) return;

    enrichRunningRef.current = true;
    setEnrichmentProgress({ done: 0, total: pending.length });

    const CONCURRENCY = 2;
    let done = 0;
    const queue = [...pending];
    const inFlight = new Set<Promise<void>>();

    const processLead = async (lead: Lead) => {
      if (!enrichRunningRef.current) return;

      setLeads((prev) =>
        prev.map((l) => l.id === lead.id ? { ...l, enrichment_status: "enriching" as const } : l)
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
          setLeads((prev) => prev.map((l) => l.id === lead.id ? enrichedLead : l));
        }
      } catch {
        setLeads((prev) =>
          prev.map((l) => l.id === lead.id ? { ...l, enrichment_status: "failed" as const } : l)
        );
      } finally {
        done += 1;
        setEnrichmentProgress({ done, total: pending.length });
      }
    };

    while (queue.length > 0 || inFlight.size > 0) {
      if (!enrichRunningRef.current) break;
      while (enrichRunningRef.current && inFlight.size < CONCURRENCY && queue.length > 0) {
        const lead = queue.shift()!;
        const p: Promise<void> = processLead(lead).finally(() => inFlight.delete(p));
        inFlight.add(p);
      }
      if (inFlight.size > 0) await Promise.race(inFlight);
    }

    enrichRunningRef.current = false;
    setEnrichmentProgress(null);
  }, []);

  const handleSearch = async () => {
    if (!niche.trim() || !location.trim()) return;

    enrichRunningRef.current = false;
    setEnrichmentProgress(null);
    setPhase("analyzing");
    setPhaseMessage("Agent AI en train de scraper Google Maps...");
    setError(null);
    setLeads([]);
    setSelectedSearchId(null);
    setSelectedLeadIds(new Set());

    try {
      const repeatedContext =
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
          attemptedQueries: repeatedContext?.attempted_queries || [],
          attemptedKeywords: repeatedContext?.attempted_keywords || [],
        }),
      });

      const searchData = await safeJson(searchRes);
      if (!searchRes.ok) throw new Error((searchData.error as string) || "Search failed");

      const searchId = searchData.searchId as string;
      const leadsCount = searchData.leadsCount as number;
      const discovery = (searchData.discovery || {}) as Record<string, unknown>;

      setLatestSearchContext(createSearchContext({
        niche: niche.trim(),
        location: location.trim(),
        attempted_queries: (discovery.used_queries as string[]) || [],
        attempted_keywords: (discovery.attempted_keywords as string[]) || [],
        successful_queries: (discovery.successful_queries as string[]) || [],
        last_generated_queries: (discovery.generated_queries as string[]) || [],
        target_min_new_leads: (discovery.target_min_new_leads as number) || 12,
        last_run_added: leadsCount,
      }));

      setPhase("completed");
      setPhaseMessage(`${leadsCount} entreprises trouvées — enrichissement en cours...`);

      const leadsRes = await fetch(`/api/lead-generator/searches/${searchId}/leads`);
      const leadsData = await safeJson(leadsRes);
      const loadedLeads = (leadsData.leads as Lead[]) || [];
      setLeads(loadedLeads);
      setSelectedSearchId(searchId);
      setSelectedLeadIds(new Set());

      const searchesRes = await fetch("/api/lead-generator/searches");
      const searchesData = await safeJson(searchesRes);
      setPastSearches((searchesData.searches as LeadSearch[]) || []);

      enrichLeads(loadedLeads);
    } catch (err) {
      setPhase("failed");
      setError(err instanceof Error ? err.message : "Something went wrong");
      setPhaseMessage("");
    }
  };

  const handleLeadUpdate = useCallback(async (leadId: string, updates: Partial<Lead>) => {
    // Optimistic update
    setLeads((prev) => prev.map((l) => l.id === leadId ? { ...l, ...updates } : l));
    // Persist
    try {
      await fetch(`/api/lead-generator/leads/${leadId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
    } catch { /* revert on error would go here */ }
  }, []);

  const handleCreateList = async (name: string) => {
    const ctx = buildCurrentSearchContext();
    const res = await fetch("/api/lead-generator/lists", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, keywords: ctx.attempted_keywords, searchContext: ctx }),
    });
    if (res.ok) await refreshLists();
  };

  const handleCreateListWithSelected = async (name: string) => {
    const leadIds = Array.from(selectedLeadIds);
    const ctx = buildCurrentSearchContext();
    const res = await fetch("/api/lead-generator/lists", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, leadIds, keywords: ctx.attempted_keywords, searchContext: ctx }),
    });
    if (res.ok) { await refreshLists(); setSelectedLeadIds(new Set()); }
  };

  const handleAddToList = async (listId: string) => {
    const leadIds = Array.from(selectedLeadIds);
    const ctx = buildCurrentSearchContext();
    await fetch(`/api/lead-generator/lists/${listId}/items`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ leadIds, keywords: ctx.attempted_keywords, searchContext: ctx }),
    });
    setSelectedLeadIds(new Set());
    if (activeListId === listId) await loadListItems(listId);
    await refreshLists();
  };

  const handleDeleteList = async (listId: string) => {
    await fetch(`/api/lead-generator/lists/${listId}`, { method: "DELETE" });
    if (activeListId === listId) { setActiveListId(null); setListItems([]); }
    await refreshLists();
  };

  const handleExportList = (listId: string) => {
    window.open(`/api/lead-generator/lists/${listId}/export`, "_blank");
  };

  const handleExpandList = async (listId: string) => {
    const list = lists.find((l) => l.id === listId);
    if (!list) return;

    enrichRunningRef.current = false;
    setEnrichmentProgress(null);
    setPhase("analyzing");
    setPhaseMessage(`Expansion de la liste "${list.name}"...`);
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
      setPhaseMessage(((data.message as string) || `${data.added} nouveaux leads ajoutés`) + ((data.added as number) > 0 ? " — enrichissement..." : ""));

      const listRes = await fetch(`/api/lead-generator/lists/${listId}`);
      const listData = await safeJson(listRes);
      const items = (listData.items as LeadListItem[]) || [];
      setListItems(items);
      await refreshLists();

      const addedIds = new Set(((data.leadIds as string[]) || []).filter(Boolean));
      const newLeads = items.map((i) => i.lead!).filter((l) => l && l.enrichment_status === "pending" && addedIds.has(l.id));
      if (newLeads.length > 0) enrichLeads(newLeads);
    } catch (err) {
      setPhase("failed");
      setError(err instanceof Error ? err.message : "Expand failed");
      setPhaseMessage("");
    }
  };

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
        const lead = leads.find((l) => l.id === leadId) || listItems.find((i) => i.lead_id === leadId)?.lead;
        setOutreachModal({ businessName: lead?.business_name || "Business", template: data.template as string });
      }
    } catch { /* silent */ }
    setGeneratingOutreachId(null);
  };

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
      if (!res.ok) throw new Error((data.error as string) || "CRM error");
      if (data.existing) {
        setCrmFeedback("Prospect déjà dans le CRM.");
      } else {
        setCrmFeedback(`✓ Prospect ajouté au CRM.`);
        setLeads((prev) => prev.map((l) => l.id === leadId ? { ...l, pipeline_status: "to_contact" } as Lead : l));
      }
    } catch (err) {
      setCrmFeedback(`Erreur : ${err instanceof Error ? err.message : "CRM error"}`);
    }
    setPipelineLeadId(null);
  };

  // Filter + sort active leads
  const activeLeads = leads.filter((l) => {
    const ext = l as Record<string, unknown>;
    if (filterPriority !== "all" && ext.priority_score !== filterPriority) return false;
    if (filterStatus !== "all" && l.enrichment_status !== filterStatus) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return (
        l.business_name.toLowerCase().includes(q) ||
        (l.niche || "").toLowerCase().includes(q) ||
        (l.location || "").toLowerCase().includes(q) ||
        (l.owner_name || "").toLowerCase().includes(q)
      );
    }
    return true;
  });

  // Stats
  const stats = {
    total: leads.length,
    enriched: leads.filter((l) => l.enrichment_status === "completed").length,
    hot: leads.filter((l) => (l as Record<string, unknown>).priority_score === "hot").length,
    noWebsite: leads.filter((l) => !l.has_website).length,
  };

  const isSearching = phase === "analyzing" || phase === "searching";

  return (
    <div className="animate-fade-in">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="label-eyebrow">Lead Generator</p>
          <h1 className="mt-1 text-xl font-semibold text-foreground sm:text-2xl">
            Prospection
          </h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Découvrez des entreprises locales, enrichissez les données, gérez votre pipeline.
          </p>
        </div>

        {/* Search bar */}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="flex h-9 items-center gap-2 rounded-lg border border-border bg-background px-3 text-sm">
            <Search className="h-3.5 w-3.5 text-muted-foreground" />
            <input
              type="text"
              value={niche}
              onChange={(e) => setNiche(e.target.value)}
              placeholder="Secteur (ex: restaurant, plombier...)"
              className="w-40 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            />
          </div>
          <div className="flex h-9 items-center gap-2 rounded-lg border border-border bg-background px-3 text-sm">
            <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
            <input
              type="text"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="Ville (ex: Paris, Lyon...)"
              className="w-32 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            />
          </div>
          <button
            type="button"
            onClick={handleSearch}
            disabled={isSearching || !niche.trim() || !location.trim()}
            className="btn-solid flex items-center gap-1.5 text-xs disabled:opacity-50"
          >
            {isSearching ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Search className="h-3.5 w-3.5" />
            )}
            {isSearching ? "Recherche..." : "Lancer"}
          </button>
        </div>
      </div>

      {/* Phase status */}
      {(isSearching || phaseMessage) && (
        <div className={cn(
          "mt-4 flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm",
          phase === "failed"
            ? "border-red-200 bg-red-50 text-red-700"
            : "border-blue-200 bg-blue-50 text-blue-700"
        )}>
          {isSearching && <Loader2 className="h-4 w-4 animate-spin shrink-0" />}
          {phase === "failed" && <AlertCircle className="h-4 w-4 shrink-0" />}
          {phase === "completed" && <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />}
          <span>{error || phaseMessage}</span>
        </div>
      )}

      {/* Worker instructions (show when leads are pending but no enrichment running) */}
      {leads.length > 0 && !enrichmentProgress && leads.some((l) => l.enrichment_status === "pending") && (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
          <div className="flex items-start gap-3">
            <Terminal className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            <div>
              <p className="text-sm font-medium text-amber-800">
                Pour un enrichissement complet sans timeout
              </p>
              <p className="mt-0.5 text-xs text-amber-700">
                Lancez le worker local pour un enrichissement approfondi (sans limite de temps) :
              </p>
              <code className="mt-1.5 block rounded bg-amber-100 px-3 py-1.5 font-mono text-xs text-amber-900">
                npx tsx workers/lead-enricher.ts
              </code>
            </div>
          </div>
        </div>
      )}

      {/* Enrichment progress bar */}
      {enrichmentProgress && (
        <div className="mt-4 rounded-lg border border-border bg-muted/30 px-4 py-3">
          <div className="flex items-center justify-between text-xs">
            <span className="inline-flex items-center gap-1.5 text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Enrichissement : {enrichmentProgress.done}/{enrichmentProgress.total} leads
            </span>
            <button
              type="button"
              onClick={() => { enrichRunningRef.current = false; setEnrichmentProgress(null); }}
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-border">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${Math.round((enrichmentProgress.done / enrichmentProgress.total) * 100)}%` }}
            />
          </div>
        </div>
      )}

      {/* Stats bar */}
      {leads.length > 0 && (
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            { label: "Total", value: stats.total, icon: null },
            { label: "Enrichis", value: stats.enriched, icon: <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /> },
            { label: "Chauds", value: stats.hot, icon: <Flame className="h-3.5 w-3.5 text-red-500" /> },
            { label: "Sans site", value: stats.noWebsite, icon: null },
          ].map((s) => (
            <div key={s.label} className="rounded-lg border border-border bg-background px-3 py-2">
              <p className="text-[10px] text-muted-foreground">{s.label}</p>
              <p className="flex items-center gap-1 text-xl font-semibold text-foreground">
                {s.icon}
                {s.value}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* View tabs */}
      <div className="mt-5 flex items-center gap-1 border-b border-border">
        <button
          type="button"
          onClick={() => setViewTab("search")}
          className={cn(
            "flex items-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors",
            viewTab === "search"
              ? "border-b-2 border-primary text-foreground"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          <Search className="h-3.5 w-3.5" />
          Leads ({leads.length})
        </button>
        <button
          type="button"
          onClick={() => setViewTab("lists")}
          className={cn(
            "flex items-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors",
            viewTab === "lists"
              ? "border-b-2 border-primary text-foreground"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          <LayoutList className="h-3.5 w-3.5" />
          Listes ({lists.length})
        </button>
        <button
          type="button"
          onClick={() => setViewTab("search")}
          className={cn(
            "flex items-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors",
            "text-muted-foreground hover:text-foreground"
          )}
        >
          <History className="h-3.5 w-3.5" />
          {pastSearches.length > 0 && (
            <span className="text-muted-foreground">{pastSearches.length} recherches</span>
          )}
        </button>
      </div>

      {/* Main content */}
      {viewTab === "search" && (
        <div className="mt-4">
          {/* Toolbar */}
          {leads.length > 0 && (
            <div className="mb-3 flex flex-wrap items-center gap-2">
              {/* Search filter */}
              <div className="flex h-7 items-center gap-1.5 rounded-lg border border-border bg-background px-2.5">
                <Search className="h-3 w-3 text-muted-foreground" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Filtrer les leads..."
                  className="w-36 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
                />
                {searchQuery && (
                  <button type="button" onClick={() => setSearchQuery("")} className="text-muted-foreground hover:text-foreground">
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>

              {/* Priority filter */}
              <div className="flex h-7 items-center gap-1 rounded-lg border border-border bg-background px-1">
                {(["all", "hot", "warm", "cold"] as FilterPriority[]).map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setFilterPriority(p)}
                    className={cn(
                      "flex items-center gap-1 rounded px-2 py-0.5 text-[10px] transition-colors",
                      filterPriority === p ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {p === "hot" && <Flame className="h-2.5 w-2.5" />}
                    {p === "warm" && <Thermometer className="h-2.5 w-2.5" />}
                    {p === "cold" && <Snowflake className="h-2.5 w-2.5" />}
                    {p === "all" ? "Tous" : p === "hot" ? "Chaud" : p === "warm" ? "Tiède" : "Froid"}
                  </button>
                ))}
              </div>

              {/* Status filter */}
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value as FilterStatus)}
                className="h-7 rounded-lg border border-border bg-background px-2 text-xs text-foreground outline-none"
              >
                <option value="all">Tous statuts</option>
                <option value="pending">En attente</option>
                <option value="enriching">En cours</option>
                <option value="completed">Enrichis</option>
                <option value="failed">Échec</option>
              </select>

              {/* Past searches dropdown */}
              {pastSearches.length > 0 && (
                <select
                  value={selectedSearchId || ""}
                  onChange={async (e) => {
                    if (e.target.value) await loadLeads(e.target.value);
                  }}
                  className="h-7 max-w-[200px] rounded-lg border border-border bg-background px-2 text-xs text-foreground outline-none"
                >
                  <option value="">— Recherches précédentes</option>
                  {pastSearches.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.niche} · {s.location} ({s.leads_count})
                    </option>
                  ))}
                </select>
              )}

              <span className="ml-auto text-xs text-muted-foreground">
                {activeLeads.length}/{leads.length} leads
              </span>
            </div>
          )}

          {/* Table */}
          <LeadsTable
            leads={activeLeads}
            loading={isSearching}
            onLeadClick={(lead) => setDrawerLead(lead)}
            onLeadUpdate={handleLeadUpdate}
            selectedIds={selectedLeadIds}
            onSelectChange={setSelectedLeadIds}
          />
        </div>
      )}

      {viewTab === "lists" && (
        <div className="mt-4">
          <ListPanel
            lists={lists}
            activeListId={activeListId}
            listItems={listItems}
            onSelectList={loadListItems}
            onCreateList={handleCreateList}
            onDeleteList={handleDeleteList}
            onExportList={handleExportList}
            onExpandList={handleExpandList}
            enrichmentProgress={enrichmentProgress}
            phase={phase}
          />
        </div>
      )}

      {/* Bulk select bar */}
      {selectedLeadIds.size > 0 && (
        <SelectBar
          count={selectedLeadIds.size}
          lists={lists}
          onCreateList={handleCreateListWithSelected}
          onAddToList={handleAddToList}
          onClear={() => setSelectedLeadIds(new Set())}
        />
      )}

      {/* Lead detail drawer */}
      {drawerLead && (
        <LeadDrawer
          lead={drawerLead}
          onClose={() => setDrawerLead(null)}
          onGenerateOutreach={handleGenerateOutreach}
          generatingOutreachId={generatingOutreachId}
          onAddToPipeline={handleAddToPipeline}
          pipelineLeadId={pipelineLeadId}
          crmFeedback={crmFeedback}
        />
      )}

      {/* Outreach modal */}
      {outreachModal && (
        <OutreachModal
          businessName={outreachModal.businessName}
          template={outreachModal.template}
          onClose={() => setOutreachModal(null)}
        />
      )}
    </div>
  );
}
