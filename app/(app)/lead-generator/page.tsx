"use client";

import { createClient } from "@/lib/supabase/client";
import { Lead, LeadSearch } from "@/lib/types";
import {
  Search,
  MapPin,
  Loader2,
  Building2,
  Phone,
  Mail,
  Star,
  Globe,
  ExternalLink,
  AlertCircle,
  CheckCircle2,
  XCircle,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { useState, useEffect, useCallback } from "react";

type SearchPhase = "idle" | "searching" | "analyzing" | "saving" | "completed" | "failed";

export default function LeadGeneratorPage() {
  const [niche, setNiche] = useState("");
  const [location, setLocation] = useState("");
  const [phase, setPhase] = useState<SearchPhase>("idle");
  const [phaseMessage, setPhaseMessage] = useState("");
  const [leads, setLeads] = useState<Lead[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pastSearches, setPastSearches] = useState<LeadSearch[]>([]);
  const [selectedSearchId, setSelectedSearchId] = useState<string | null>(null);
  const [expandedLead, setExpandedLead] = useState<string | null>(null);
  const [filterNoWebsite, setFilterNoWebsite] = useState(false);

  const supabase = createClient();

  // Load past searches on mount
  useEffect(() => {
    const fetchSearches = async () => {
      const { data } = await supabase
        .from("lead_searches")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(20);
      setPastSearches(data || []);
    };
    fetchSearches();
  }, [supabase]);

  // Load leads for a search
  const loadLeads = useCallback(
    async (searchId: string) => {
      const { data } = await supabase
        .from("leads")
        .select("*")
        .eq("search_id", searchId)
        .order("has_website", { ascending: true });
      setLeads(data || []);
      setSelectedSearchId(searchId);
    },
    [supabase]
  );

  const handleSearch = async () => {
    if (!niche.trim() || !location.trim()) return;

    setPhase("searching");
    setPhaseMessage("Launching browser agent — navigating Google Maps...");
    setError(null);
    setLeads([]);
    setSelectedSearchId(null);

    try {
      // Single call: agent browses Google Maps, extracts businesses, saves to DB
      setPhase("analyzing");
      setPhaseMessage(
        "AI agent is browsing Google Maps, clicking through each business to check for websites... this takes 2-4 minutes"
      );

      const searchRes = await fetch("/api/lead-generator/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          niche: niche.trim(),
          location: location.trim(),
        }),
      });

      if (!searchRes.ok) {
        const err = await searchRes.json();
        throw new Error(err.error || "Search failed");
      }

      const { searchId, leadsCount, withoutWebsite } = await searchRes.json();

      // Load results
      setPhase("completed");
      setPhaseMessage(
        `Found ${leadsCount} businesses — ${withoutWebsite} without a website!`
      );
      await loadLeads(searchId);

      // Refresh past searches
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

  const filteredLeads = filterNoWebsite
    ? leads.filter((l) => !l.has_website)
    : leads;

  const noWebsiteCount = leads.filter((l) => !l.has_website).length;

  return (
    <div className="animate-fade-in">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-foreground">Lead Generator</h1>
        <p className="text-muted-foreground mt-1">
          Find businesses without websites — your next clients
        </p>
      </div>

      {/* Search form */}
      <div className="rounded-2xl border border-border bg-card p-6 mb-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">
              Business Niche
            </label>
            <div className="relative">
              <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                type="text"
                value={niche}
                onChange={(e) => setNiche(e.target.value)}
                placeholder="e.g. Restaurant, Plumber, Hair salon..."
                className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all text-sm"
                disabled={phase !== "idle" && phase !== "completed" && phase !== "failed"}
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">
              Location
            </label>
            <div className="relative">
              <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                type="text"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="e.g. Montreal, Paris 11e, Brooklyn NY..."
                className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all text-sm"
                disabled={phase !== "idle" && phase !== "completed" && phase !== "failed"}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSearch();
                }}
              />
            </div>
          </div>
        </div>
        <button
          onClick={handleSearch}
          disabled={
            !niche.trim() ||
            !location.trim() ||
            (phase !== "idle" && phase !== "completed" && phase !== "failed")
          }
          className="inline-flex items-center gap-2 rounded-xl bg-primary px-6 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-all shadow-lg shadow-primary/25 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {phase === "searching" || phase === "analyzing" || phase === "saving" ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Researching...
            </>
          ) : (
            <>
              <Search className="w-4 h-4" />
              Find Leads
            </>
          )}
        </button>

        {/* Progress indicator */}
        {phase !== "idle" && phaseMessage && (
          <div className="mt-4 flex items-start gap-3 p-3 rounded-xl bg-secondary/50">
            {phase === "searching" || phase === "analyzing" || phase === "saving" ? (
              <Loader2 className="w-4 h-4 animate-spin text-primary mt-0.5 shrink-0" />
            ) : phase === "completed" ? (
              <CheckCircle2 className="w-4 h-4 text-green-400 mt-0.5 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
            )}
            <div>
              <p className="text-sm text-foreground">{phaseMessage}</p>
              {(phase === "searching" || phase === "analyzing") && (
                <div className="flex gap-2 mt-2">
                  {["Browser", "Google Maps", "Gemini Vision", "Extract Data"].map(
                    (s) => (
                      <span
                        key={s}
                        className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-primary/10 text-primary"
                      >
                        {s}
                      </span>
                    )
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {error && (
          <div className="mt-4 flex items-center gap-2 p-3 rounded-xl bg-red-500/10 text-red-400 text-sm">
            <XCircle className="w-4 h-4 shrink-0" />
            {error}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Past searches sidebar */}
        <div className="lg:col-span-1">
          <div className="rounded-2xl border border-border bg-card p-4">
            <h3 className="text-sm font-semibold text-foreground mb-3">
              Search History
            </h3>
            {pastSearches.length === 0 ? (
              <p className="text-xs text-muted-foreground">No searches yet</p>
            ) : (
              <div className="space-y-2">
                {pastSearches.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => loadLeads(s.id)}
                    className={`w-full text-left p-3 rounded-xl transition-all text-sm ${
                      selectedSearchId === s.id
                        ? "bg-primary/15 border border-primary/30"
                        : "bg-secondary/50 hover:bg-secondary border border-transparent"
                    }`}
                  >
                    <p className="font-medium text-foreground truncate">
                      {s.niche}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">
                      {s.location}
                    </p>
                    <div className="flex items-center justify-between mt-1.5">
                      <span className="text-[10px] text-muted-foreground">
                        {new Date(s.created_at).toLocaleDateString()}
                      </span>
                      {s.status === "completed" ? (
                        <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-green-500/20 text-green-400">
                          {s.leads_count} leads
                        </span>
                      ) : s.status === "failed" ? (
                        <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-red-500/20 text-red-400">
                          Failed
                        </span>
                      ) : (
                        <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-yellow-500/20 text-yellow-400">
                          {s.status}
                        </span>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Results */}
        <div className="lg:col-span-3">
          {leads.length > 0 ? (
            <>
              {/* Filter bar */}
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <span className="text-sm text-muted-foreground">
                    {filteredLeads.length} businesses
                  </span>
                  <button
                    onClick={() => setFilterNoWebsite(!filterNoWebsite)}
                    className={`inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full transition-all ${
                      filterNoWebsite
                        ? "bg-primary/20 text-primary border border-primary/30"
                        : "bg-secondary text-muted-foreground hover:text-foreground border border-transparent"
                    }`}
                  >
                    <XCircle className="w-3 h-3" />
                    No website only ({noWebsiteCount})
                  </button>
                </div>
              </div>

              {/* Lead cards */}
              <div className="space-y-3">
                {filteredLeads.map((lead) => (
                  <div
                    key={lead.id}
                    className={`rounded-2xl border bg-card p-5 transition-all duration-200 ${
                      lead.has_website
                        ? "border-border opacity-60"
                        : "border-primary/20 shadow-sm shadow-primary/5"
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <h3 className="font-semibold text-foreground truncate">
                            {lead.business_name}
                          </h3>
                          {!lead.has_website ? (
                            <span className="shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full bg-green-500/20 text-green-400">
                              NO WEBSITE
                            </span>
                          ) : (
                            <span className="shrink-0 text-[10px] font-medium px-2 py-0.5 rounded-full bg-secondary text-muted-foreground">
                              Has website
                            </span>
                          )}
                        </div>
                        {lead.description && (
                          <p className="text-sm text-muted-foreground mb-2 line-clamp-2">
                            {lead.description}
                          </p>
                        )}

                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                          {lead.address && (
                            <span className="flex items-center gap-1">
                              <MapPin className="w-3 h-3" />
                              {lead.address}
                            </span>
                          )}
                          {lead.phone && (
                            <a
                              href={`tel:${lead.phone}`}
                              className="flex items-center gap-1 text-primary hover:underline"
                            >
                              <Phone className="w-3 h-3" />
                              {lead.phone}
                            </a>
                          )}
                          {lead.email && (
                            <a
                              href={`mailto:${lead.email}`}
                              className="flex items-center gap-1 text-primary hover:underline"
                            >
                              <Mail className="w-3 h-3" />
                              {lead.email}
                            </a>
                          )}
                          {lead.rating && (
                            <span className="flex items-center gap-1">
                              <Star className="w-3 h-3 text-yellow-400" />
                              {lead.rating}
                              {lead.review_count && (
                                <span className="text-muted-foreground">
                                  ({lead.review_count} reviews)
                                </span>
                              )}
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-2 ml-4 shrink-0">
                        {lead.google_maps_url && (
                          <a
                            href={lead.google_maps_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="p-2 rounded-lg bg-secondary hover:bg-secondary/80 transition-all"
                            title="View on Google Maps"
                          >
                            <MapPin className="w-4 h-4 text-muted-foreground" />
                          </a>
                        )}
                        {lead.website_url && (
                          <a
                            href={lead.website_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="p-2 rounded-lg bg-secondary hover:bg-secondary/80 transition-all"
                            title="Visit website"
                          >
                            <Globe className="w-4 h-4 text-muted-foreground" />
                          </a>
                        )}
                        <button
                          onClick={() =>
                            setExpandedLead(
                              expandedLead === lead.id ? null : lead.id
                            )
                          }
                          className="p-2 rounded-lg bg-secondary hover:bg-secondary/80 transition-all"
                        >
                          {expandedLead === lead.id ? (
                            <ChevronUp className="w-4 h-4 text-muted-foreground" />
                          ) : (
                            <ChevronDown className="w-4 h-4 text-muted-foreground" />
                          )}
                        </button>
                      </div>
                    </div>

                    {/* Expanded details */}
                    {expandedLead === lead.id && (
                      <div className="mt-4 pt-4 border-t border-border space-y-3">
                        {lead.review_highlights &&
                          lead.review_highlights.length > 0 && (
                            <div>
                              <p className="text-xs font-semibold text-foreground mb-1.5">
                                Review Highlights
                              </p>
                              <div className="space-y-1">
                                {lead.review_highlights.map((r, i) => (
                                  <p
                                    key={i}
                                    className="text-xs text-muted-foreground pl-3 border-l-2 border-primary/30"
                                  >
                                    &ldquo;{r}&rdquo;
                                  </p>
                                ))}
                              </div>
                            </div>
                          )}
                        {lead.source && (
                          <p className="text-[10px] text-muted-foreground">
                            Source: {lead.source}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </>
          ) : phase === "idle" ? (
            <div className="rounded-2xl border border-border bg-card p-12 text-center">
              <div className="inline-flex items-center justify-center p-4 rounded-2xl bg-secondary mb-4">
                <Search className="w-10 h-10 text-muted-foreground" />
              </div>
              <h2 className="text-lg font-semibold text-foreground mb-2">
                Find your next clients
              </h2>
              <p className="text-muted-foreground text-sm max-w-md mx-auto">
                Enter a business niche and location above. The AI will search
                Google Maps, directories, and review sites to find businesses
                that don&apos;t have a website yet.
              </p>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
