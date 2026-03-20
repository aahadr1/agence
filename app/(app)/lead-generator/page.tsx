"use client";

import { PageHeader } from "@/components/ui/page-header";
import { Panel } from "@/components/ui/panel";
import { createClient } from "@/lib/supabase/client";
import { Lead, LeadList, LeadListItem, LeadSearch } from "@/lib/types";
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
import { useState, useEffect, useCallback } from "react";
import { LeadCard } from "./components/lead-card";
import { ListPanel } from "./components/list-panel";
import { SelectBar } from "./components/select-bar";
import { OutreachModal } from "./components/outreach-modal";

type SearchPhase = "idle" | "searching" | "analyzing" | "completed" | "failed";
type ViewTab = "search" | "lists";

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

  // Selection
  const [selectedLeadIds, setSelectedLeadIds] = useState<Set<string>>(new Set());

  // Filters
  const [filterNoWebsite, setFilterNoWebsite] = useState(false);
  const [filterBadWebsite, setFilterBadWebsite] = useState(false);

  // Outreach
  const [outreachModal, setOutreachModal] = useState<{
    businessName: string;
    template: string;
  } | null>(null);
  const [generatingOutreachId, setGeneratingOutreachId] = useState<string | null>(null);

  const supabase = createClient();

  // Load data on mount
  useEffect(() => {
    const fetchData = async () => {
      const [searchesRes, listsRes] = await Promise.all([
        supabase
          .from("lead_searches")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(20),
        fetch("/api/lead-generator/lists").then((r) => r.json()),
      ]);
      setPastSearches(searchesRes.data || []);
      setLists(listsRes.lists || []);
    };
    fetchData();
  }, [supabase]);

  const loadLeads = useCallback(
    async (searchId: string) => {
      const { data } = await supabase
        .from("leads")
        .select("*")
        .eq("search_id", searchId)
        .order("has_website", { ascending: true });
      setLeads(data || []);
      setSelectedSearchId(searchId);
      setSelectedLeadIds(new Set());
    },
    [supabase]
  );

  const loadListItems = useCallback(async (listId: string) => {
    const res = await fetch(`/api/lead-generator/lists/${listId}`);
    const data = await res.json();
    setListItems(data.items || []);
    setActiveListId(listId);
  }, []);

  const refreshLists = useCallback(async () => {
    const res = await fetch("/api/lead-generator/lists");
    const data = await res.json();
    setLists(data.lists || []);
  }, []);

  // Search handler
  const handleSearch = async () => {
    if (!niche.trim() || !location.trim()) return;

    setPhase("analyzing");
    setPhaseMessage(
      "AI agent browsing Google Maps with multiple search variations, then cross-referencing Google, PagesJaunes, and Facebook... this takes 5-10 minutes"
    );
    setError(null);
    setLeads([]);
    setSelectedSearchId(null);
    setSelectedLeadIds(new Set());

    try {
      const searchRes = await fetch("/api/lead-generator/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ niche: niche.trim(), location: location.trim() }),
      });

      if (!searchRes.ok) {
        const err = await searchRes.json();
        throw new Error(err.error || "Search failed");
      }

      const { searchId, leadsCount, withoutWebsite, badWebsite } =
        await searchRes.json();

      setPhase("completed");
      setPhaseMessage(
        `Found ${leadsCount} businesses — ${withoutWebsite} without a website, ${badWebsite} with a bad website!`
      );
      await loadLeads(searchId);

      const { data: updatedSearches } = await supabase
        .from("lead_searches")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(20);
      setPastSearches(updatedSearches || []);
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
    const res = await fetch("/api/lead-generator/lists", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    if (res.ok) await refreshLists();
  };

  const handleCreateListWithSelected = async (name: string) => {
    const leadIds = Array.from(selectedLeadIds);
    const res = await fetch("/api/lead-generator/lists", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, leadIds }),
    });
    if (res.ok) {
      await refreshLists();
      setSelectedLeadIds(new Set());
    }
  };

  const handleAddToList = async (listId: string) => {
    const leadIds = Array.from(selectedLeadIds);
    await fetch(`/api/lead-generator/lists/${listId}/items`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ leadIds }),
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
          niche: list.keywords?.[0] || niche,
          location: list.keywords?.[1] || location,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Expand failed");

      setPhase("completed");
      setPhaseMessage(`Added ${data.added} new leads to "${list.name}"!`);
      await loadListItems(listId);
      await refreshLists();
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
      const data = await res.json();
      if (data.template) {
        const lead = leads.find((l) => l.id === leadId) ||
          listItems.find((i) => i.lead_id === leadId)?.lead;
        setOutreachModal({
          businessName: lead?.business_name || "Business",
          template: data.template,
        });
      }
    } catch {
      // Silently fail
    }
    setGeneratingOutreachId(null);
  };

  // Filter logic
  const displayLeads = viewTab === "lists" && activeListId
    ? listItems.map((i) => i.lead!).filter(Boolean)
    : leads;

  const filteredLeads = displayLeads.filter((l) => {
    if (filterNoWebsite && l.has_website) return false;
    if (filterBadWebsite && !(l.website_quality === "dead" || l.website_quality === "outdated" || l.website_quality === "poor")) return false;
    return true;
  });

  const noWebsiteCount = displayLeads.filter((l) => !l.has_website).length;
  const badWebsiteCount = displayLeads.filter((l) =>
    l.has_website && (l.website_quality === "dead" || l.website_quality === "outdated" || l.website_quality === "poor")
  ).length;

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
                className="input-minimal pl-10"
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
                className="input-minimal pl-10"
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
            {phase === "analyzing" ? (
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
                  {[
                    "Query expansion",
                    "Maps",
                    "Search",
                    "PagesJaunes",
                    "Facebook",
                    "Web check",
                  ].map((s) => (
                    <span
                      key={s}
                      className="border border-border px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground"
                    >
                      {s}
                    </span>
                  ))}
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
              <div className="mb-6 flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-muted-foreground">
                    {filteredLeads.length} shown
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setFilterNoWebsite(!filterNoWebsite);
                      setFilterBadWebsite(false);
                    }}
                    className={`border px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.08em] transition-colors ${
                      filterNoWebsite
                        ? "border-foreground bg-foreground text-primary-foreground"
                        : "border-border text-muted-foreground hover:border-foreground/25"
                    }`}
                  >
                    No site ({noWebsiteCount})
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setFilterBadWebsite(!filterBadWebsite);
                      setFilterNoWebsite(false);
                    }}
                    className={`border px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.08em] transition-colors ${
                      filterBadWebsite
                        ? "border-foreground bg-foreground text-primary-foreground"
                        : "border-border text-muted-foreground hover:border-foreground/25"
                    }`}
                  >
                    Weak site ({badWebsiteCount})
                  </button>
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
                      ? "Clear selection"
                      : "Select all"}
                  </button>
                ) : null}
              </div>

              {/* Lead cards */}
              <div className="space-y-3">
                {filteredLeads.map((lead) => (
                  <LeadCard
                    key={lead.id}
                    lead={lead}
                    selected={selectedLeadIds.has(lead.id)}
                    onSelect={toggleSelect}
                    onGenerateOutreach={handleGenerateOutreach}
                    generatingOutreach={generatingOutreachId === lead.id}
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
    </div>
  );
}
