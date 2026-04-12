"use client";

import { PageHeader } from "@/components/ui/page-header";
import { Panel } from "@/components/ui/panel";
import { createClient } from "@/lib/supabase/client";
import type { BusinessAnalysis } from "@/lib/types";
import {
  Radar,
  Search,
  MapPin,
  Hash,
  Loader2,
  AlertCircle,
  XCircle,
  History,
  ArrowRight,
} from "lucide-react";
import { useState, useEffect, useCallback } from "react";
import { AnalysisReport } from "./components/analysis-report";
import { ScoreGauge } from "./components/score-gauge";

type InputMode = "name" | "url" | "siret";

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

export default function BusinessAnalyzerPage() {
  const [inputMode, setInputMode] = useState<InputMode>("name");
  const [nameInput, setNameInput] = useState("");
  const [cityInput, setCityInput] = useState("");
  const [urlInput, setUrlInput] = useState("");
  const [siretInput, setSiretInput] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [currentAnalysis, setCurrentAnalysis] = useState<BusinessAnalysis | null>(null);
  const [pastAnalyses, setPastAnalyses] = useState<BusinessAnalysis[]>([]);

  const supabase = createClient();

  // Load past analyses
  useEffect(() => {
    const load = async () => {
      const { data } = await supabase
        .from("business_analyses")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(20);
      setPastAnalyses(data || []);
    };
    load();
  }, [supabase]);

  const loadAnalysis = useCallback(
    async (id: string) => {
      const { data } = await supabase
        .from("business_analyses")
        .select("*")
        .eq("id", id)
        .single();
      if (data) setCurrentAnalysis(data as BusinessAnalysis);
    },
    [supabase]
  );

  const handleAnalyze = async () => {
    let inputType: "name_city" | "google_maps_url" | "siret";
    let inputValue: string;
    let city: string | undefined;

    if (inputMode === "name") {
      if (!nameInput.trim() || !cityInput.trim()) return;
      inputType = "name_city";
      inputValue = `${nameInput.trim()} ${cityInput.trim()}`;
      city = cityInput.trim();
    } else if (inputMode === "url") {
      if (!urlInput.trim()) return;
      inputType = "google_maps_url";
      inputValue = urlInput.trim();
    } else {
      if (!siretInput.trim()) return;
      inputType = "siret";
      inputValue = siretInput.trim();
    }

    setAnalyzing(true);
    setError(null);
    setCurrentAnalysis(null);
    setProgress("Launching browser agent...");

    const steps = [
      "Searching Google Maps...",
      "Analyzing website quality, HTTPS, scheduling signals, chatbot...",
      "Checking Facebook Ad Library for active ads...",
      "Getting legal information (Societe.com)...",
      "Searching social media (Facebook, Instagram)...",
      "Finding owner on LinkedIn...",
      "Searching owner contact details...",
      "Analyzing local competitors...",
      "AI sector read — what “digital” means for this business...",
      "AI synthesis — contextual gaps & tailored offers...",
    ];
    let step = 0;
    const interval = setInterval(() => {
      if (step < steps.length) {
        setProgress(steps[step]);
        step++;
      }
    }, 12000);

    try {
      const res = await fetch("/api/business-analyzer/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inputType, inputValue, city }),
      });

      const data = await safeJson(res);
      if (!res.ok) throw new Error((data.error as string) || "Analysis failed");

      const analysis = data.analysis as BusinessAnalysis;
      setCurrentAnalysis(analysis);

      // Refresh past analyses
      const { data: updated } = await supabase
        .from("business_analyses")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(20);
      setPastAnalyses(updated || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Analysis failed");
    } finally {
      clearInterval(interval);
      setAnalyzing(false);
      setProgress("");
    }
  };

  const canSubmit =
    inputMode === "name"
      ? nameInput.trim() && cityInput.trim()
      : inputMode === "url"
        ? urlInput.trim()
        : siretInput.trim();

  return (
    <div className="animate-fade-in">
      <PageHeader
        eyebrow="Intelligence"
        title="Business Analyzer"
        description="Enter a business and get a comprehensive digital analysis with potential score, pain points, and recommended offers."
      />

      {/* ── Input Panel ── */}
      <Panel padding="md" className="mb-8 mt-8 rounded-sm">
        {/* Input mode tabs */}
        <div className="mb-6 flex border border-border">
          {([
            { mode: "name" as const, label: "Nom + Ville", icon: Search },
            { mode: "url" as const, label: "Lien Google Maps", icon: MapPin },
            { mode: "siret" as const, label: "SIRET / SIREN", icon: Hash },
          ]).map(({ mode, label, icon: Icon }) => (
            <button
              key={mode}
              type="button"
              onClick={() => setInputMode(mode)}
              className={`flex flex-1 items-center justify-center gap-1.5 border-b-2 py-2.5 text-[10px] font-medium uppercase tracking-[0.1em] transition-colors ${
                inputMode === mode
                  ? "-mb-px border-foreground text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className="h-3 w-3" strokeWidth={1.5} /> {label}
            </button>
          ))}
        </div>

        {/* Input fields */}
        {inputMode === "name" && (
          <div className="mb-6 grid grid-cols-1 gap-5 md:grid-cols-2">
            <div>
              <label className="label-eyebrow mb-2 block">Business Name</label>
              <input
                type="text"
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                placeholder="Restaurant Le Petit Bistrot, Salon Beauté…"
                className="input-minimal"
                disabled={analyzing}
              />
            </div>
            <div>
              <label className="label-eyebrow mb-2 block">Ville</label>
              <input
                type="text"
                value={cityInput}
                onChange={(e) => setCityInput(e.target.value)}
                placeholder="Paris, Lyon, Marseille…"
                className="input-minimal"
                disabled={analyzing}
                onKeyDown={(e) => e.key === "Enter" && handleAnalyze()}
              />
            </div>
          </div>
        )}

        {inputMode === "url" && (
          <div className="mb-6">
            <label className="label-eyebrow mb-2 block">Google Maps URL</label>
            <input
              type="text"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              placeholder="https://www.google.com/maps/place/..."
              className="input-minimal"
              disabled={analyzing}
              onKeyDown={(e) => e.key === "Enter" && handleAnalyze()}
            />
          </div>
        )}

        {inputMode === "siret" && (
          <div className="mb-6">
            <label className="label-eyebrow mb-2 block">SIRET ou SIREN</label>
            <input
              type="text"
              value={siretInput}
              onChange={(e) => setSiretInput(e.target.value)}
              placeholder="123 456 789 00012 ou 123 456 789"
              className="input-minimal"
              disabled={analyzing}
              onKeyDown={(e) => e.key === "Enter" && handleAnalyze()}
            />
          </div>
        )}

        <button
          type="button"
          onClick={handleAnalyze}
          disabled={!canSubmit || analyzing}
          className="btn-solid disabled:cursor-not-allowed"
        >
          {analyzing ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Analyzing…
            </>
          ) : (
            <>
              <Radar className="h-4 w-4" strokeWidth={1.5} />
              Analyze Business
            </>
          )}
        </button>

        {/* Progress */}
        {analyzing && progress && (
          <div className="mt-6 flex items-start gap-3 border-t border-border pt-6">
            <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
            <div>
              <p className="text-sm text-foreground">{progress}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {["Maps", "Website", "Ad Library", "Societe.com", "Facebook", "LinkedIn", "Owner", "Competitors", "Sector AI", "Offers AI"].map((s) => (
                  <span
                    key={s}
                    className="border border-border px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground"
                  >
                    {s}
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}

        {error && (
          <div className="mt-4 flex items-center gap-2 border border-destructive/25 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            <XCircle className="h-4 w-4 shrink-0" strokeWidth={1.25} />
            {error}
          </div>
        )}
      </Panel>

      {/* ── Main content: analysis or history ── */}
      <div className="grid grid-cols-1 gap-8 border-t border-border pt-10 lg:grid-cols-4">
        {/* Sidebar: past analyses */}
        <div className="lg:col-span-1">
          <Panel padding="sm" className="rounded-sm">
            <h3 className="label-eyebrow mb-4 flex items-center gap-2">
              <History className="h-3.5 w-3.5" strokeWidth={1.5} />
              Recent
            </h3>
            {pastAnalyses.length === 0 ? (
              <p className="text-xs text-muted-foreground">No analyses yet.</p>
            ) : (
              <div className="divide-y divide-border border border-border">
                {pastAnalyses.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => loadAnalysis(a.id)}
                    className={`w-full px-3 py-3 text-left transition-colors hover:bg-secondary/40 ${
                      currentAnalysis?.id === a.id ? "bg-secondary/50" : ""
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-sm font-medium text-foreground">
                        {a.business_name}
                      </p>
                      {a.status === "completed" && a.potential_score != null && (
                        <ScoreGauge score={a.potential_score} size="sm" label="" />
                      )}
                    </div>
                    <div className="mt-1 flex items-center justify-between">
                      <span className="font-mono text-[10px] text-muted-foreground">
                        {new Date(a.created_at).toLocaleDateString()}
                      </span>
                      {a.status !== "completed" && (
                        <span className="text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
                          {a.status}
                        </span>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </Panel>
        </div>

        {/* Main area: report */}
        <div className="lg:col-span-3">
          {currentAnalysis ? (
            <AnalysisReport analysis={currentAnalysis} />
          ) : !analyzing ? (
            <Panel padding="lg" className="rounded-sm text-center">
              <Radar className="mx-auto mb-5 h-8 w-8 text-muted-foreground" strokeWidth={1} />
              <p className="label-eyebrow mb-2">Start</p>
              <h2 className="font-display text-xl font-medium text-foreground md:text-2xl">
                Analyze a business
              </h2>
              <p className="mx-auto mt-2 max-w-lg text-sm leading-relaxed text-muted-foreground">
                Enter a business name, Google Maps link, or SIRET number. The AI agent will generate a complete 
                digital report with potential score, pain points, competitor analysis, and recommended offers.
              </p>
              <div className="mx-auto mt-6 flex flex-col items-center gap-2 text-xs text-muted-foreground">
                {[
                  "Google Maps data + reviews",
                  "Website quality + HTTPS + booking + chatbot detection",
                  "Facebook Ad Library check",
                  "Legal data (Societe.com / Pappers)",
                  "Owner LinkedIn profile",
                  "3-5 competitor comparison",
                  "AI potential scoring (1-100)",
                ].map((feature) => (
                  <span key={feature} className="flex items-center gap-2">
                    <ArrowRight className="h-3 w-3 text-muted-foreground" strokeWidth={1.5} />
                    {feature}
                  </span>
                ))}
              </div>
            </Panel>
          ) : null}
        </div>
      </div>
    </div>
  );
}
