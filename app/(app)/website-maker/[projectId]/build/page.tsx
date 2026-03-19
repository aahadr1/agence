"use client";

import { Stepper } from "@/components/website-maker/stepper";
import { cn } from "@/lib/utils";
import {
  AlertTriangle,
  Check,
  Code2,
  ExternalLink,
  Eye,
  Globe,
  Loader2,
  Monitor,
  RefreshCw,
  Rocket,
  Smartphone,
  Tablet,
} from "lucide-react";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

type BuildPhase =
  | "idle"
  | "generating"
  | "parsing"
  | "saving"
  | "preview"
  | "deploying"
  | "deployed"
  | "failed";

const PHASE_INFO: Record<
  string,
  { label: string; description: string }
> = {
  idle: { label: "Initializing...", description: "Checking for existing builds" },
  generating: { label: "Generating your website", description: "AI is writing all 5 pages of your site" },
  parsing: { label: "Processing output", description: "Extracting files from AI response" },
  saving: { label: "Saving files", description: "Storing your website for preview" },
  preview: { label: "Website ready!", description: "Your site is ready for preview" },
  deploying: { label: "Publishing...", description: "Deploying to production" },
  deployed: { label: "Published!", description: "Your website is live on the internet" },
  failed: { label: "Build failed", description: "Something went wrong" },
};

const PROGRESS_STEPS = [
  {
    key: "generate",
    label: "Generate",
    icon: Code2,
    activePhases: ["generating", "parsing"],
  },
  {
    key: "preview",
    label: "Preview",
    icon: Eye,
    activePhases: ["saving", "preview"],
  },
  {
    key: "deploy",
    label: "Publish",
    icon: Rocket,
    activePhases: ["deploying", "deployed"],
  },
];

type ViewportMode = "desktop" | "tablet" | "mobile";

async function safeJson(res: Response) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(text.slice(0, 300) || `HTTP ${res.status}`);
  }
}

function sanitizeJsonControlChars(input: string): string {
  let result = "";
  let inString = false;
  let escaped = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (escaped) { result += ch; escaped = false; continue; }
    if (ch === "\\" && inString) { result += ch; escaped = true; continue; }
    if (ch === '"') { inString = !inString; result += ch; continue; }
    if (inString && ch.charCodeAt(0) < 0x20) {
      if (ch === "\n") { result += "\\n"; continue; }
      if (ch === "\r") { result += "\\r"; continue; }
      if (ch === "\t") { result += "\\t"; continue; }
      continue;
    }
    result += ch;
  }
  return result;
}

function parseFilesFromOutput(raw: string): { path: string; content: string }[] {
  // Strip thinking tags and markdown fences
  const cleaned = raw
    .replace(/<think>[\s\S]*?<\/think>/g, "")
    .replace(/```(?:json)?\s*/g, "")
    .replace(/```\s*/g, "")
    .trim();

  const jsonMatch = cleaned.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    throw new Error("No JSON array found in AI output");
  }

  // Try parsing as-is, then with sanitization, then truncation recovery
  const attempts = [jsonMatch[0], sanitizeJsonControlChars(jsonMatch[0])];
  for (const attempt of attempts) {
    try {
      const parsed = JSON.parse(attempt);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    } catch { /* try next */ }
  }

  // Last resort: try truncation recovery on sanitized version
  const sanitized = sanitizeJsonControlChars(jsonMatch[0]);
  for (let i = sanitized.lastIndexOf("}"); i >= 0; i--) {
    if (sanitized[i] !== "}") continue;
    try {
      const attempt = sanitized.slice(0, i + 1) + "]";
      const parsed = JSON.parse(attempt);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    } catch { continue; }
  }
  throw new Error("Could not parse generated files — AI output may be truncated");
}

export default function BuildPage() {
  const { projectId } = useParams<{ projectId: string }>();

  const [phase, setPhase] = useState<BuildPhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [buildId, setBuildId] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [vercelUrl, setVercelUrl] = useState<string | null>(null);
  const [filesCount, setFilesCount] = useState(0);
  const [viewportMode, setViewportMode] = useState<ViewportMode>("desktop");
  const [activePage, setActivePage] = useState("index.html");
  const [pages, setPages] = useState<{ path: string; label: string }[]>([]);

  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    const checkExistingBuild = async () => {
      try {
        const res = await fetch(
          `/api/generate-website/build-status?projectId=${projectId}`
        );
        if (!res.ok) {
          startBuild();
          return;
        }
        const { build } = await res.json();

        if (build) {
          setBuildId(build.id);

          const hasFiles =
            build.files && (build.files as unknown[]).length > 0;

          if (
            (build.status === "deployed" || build.status === "deploying") &&
            hasFiles
          ) {
            const files = build.files as { path: string; content: string }[];
            setFilesCount(files.length);
            setPages(filesToPages(files));
            setPreviewUrl(`/api/sites/${build.id}/`);

            if (build.vercel_url) {
              setVercelUrl(build.vercel_url);
              setPhase("deployed");
            } else {
              setPhase("preview");
            }
            return;
          }

          if (build.status === "failed") {
            setPhase("failed");
            setError(build.error || "Previous build failed");
            return;
          }
        }
      } catch {
        // ignore
      }
      startBuild();
    };

    checkExistingBuild();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const filesToPages = (
    files: { path: string; content: string }[]
  ): { path: string; label: string }[] => {
    const labelMap: Record<string, string> = {
      "index.html": "Accueil",
      "about.html": "À propos",
      "menu.html": "Menu",
      "services.html": "Services",
      "gallery.html": "Galerie",
      "contact.html": "Contact",
    };
    return files
      .filter((f) => f.path.endsWith(".html"))
      .map((f) => ({
        path: f.path,
        label: labelMap[f.path] || f.path.replace(".html", ""),
      }));
  };

  const pollPrediction = useCallback(
    async (
      predictionId: string
    ): Promise<string> => {
      for (let i = 0; i < 200; i++) {
        await new Promise((r) => setTimeout(r, 3000));
        try {
          const res = await fetch(`/api/predictions/${predictionId}`);
          if (!res.ok) continue;
          const data = await safeJson(res);

          if (data.status === "succeeded") {
            if (!data.rawOutput) {
              throw new Error("AI returned empty output");
            }
            return data.rawOutput;
          }
          if (data.status === "failed" || data.status === "canceled") {
            throw new Error(
              `AI generation failed: ${data.error || "unknown reason"}`
            );
          }
        } catch (e) {
          if (
            e instanceof Error &&
            (e.message.includes("AI generation failed") ||
              e.message.includes("AI returned empty"))
          ) {
            throw e;
          }
        }
      }
      throw new Error("Generation timed out after 10 minutes");
    },
    []
  );

  const startBuild = useCallback(async () => {
    setPhase("generating");
    setError(null);

    try {
      const genRes = await fetch("/api/generate-website/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId }),
      });

      if (!genRes.ok) {
        const err = await safeJson(genRes);
        throw new Error(err.error || "Failed to start generation");
      }

      const { buildId: newBuildId, predictionId } = await safeJson(genRes);
      setBuildId(newBuildId);

      const rawOutput = await pollPrediction(predictionId);

      setPhase("parsing");
      const files = parseFilesFromOutput(rawOutput);
      setFilesCount(files.length);
      setPages(filesToPages(files));

      setPhase("saving");
      const saveRes = await fetch("/api/generate-website/build-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ buildId: newBuildId, files }),
      });

      if (!saveRes.ok) {
        const err = await safeJson(saveRes);
        throw new Error(err.error || "Failed to save files");
      }

      const { previewUrl: url } = await safeJson(saveRes);
      setPreviewUrl(url);
      setPhase("preview");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Build failed";
      console.error("Build error:", msg);
      setError(msg);
      setPhase("failed");
    }
  }, [projectId, pollPrediction]);

  const handleRetry = async () => {
    if (buildId) {
      await fetch(
        `/api/generate-website/build-status?buildId=${buildId}`,
        { method: "DELETE" }
      );
    }
    startedRef.current = false;
    setBuildId(null);
    setPreviewUrl(null);
    setVercelUrl(null);
    setFilesCount(0);
    setPages([]);
    startBuild();
  };

  const handleDeploy = async () => {
    if (!buildId) return;
    setPhase("deploying");

    try {
      const res = await fetch("/api/generate-website/deploy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ buildId }),
      });

      if (!res.ok) {
        const err = await safeJson(res);
        throw new Error(err.error || "Deployment failed");
      }

      const { url } = await safeJson(res);
      setVercelUrl(url);
      setPhase("deployed");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Deploy failed";
      setError(msg);
      setPhase("preview");
    }
  };

  const currentStepIndex = PROGRESS_STEPS.findIndex((s) =>
    s.activePhases.includes(phase)
  );

  const iframeWidth =
    viewportMode === "mobile"
      ? "375px"
      : viewportMode === "tablet"
      ? "768px"
      : "100%";

  const showPreview = phase === "preview" || phase === "deploying" || phase === "deployed";

  if (showPreview && previewUrl) {
    return (
      <div className="animate-fade-in max-w-[1400px] mx-auto">
        <Stepper currentStep={4} />

        {/* Header */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
          <div>
            <div className="flex items-center gap-3 mb-1">
              {phase === "deployed" && vercelUrl ? (
                <div className="flex items-center gap-2 text-green-400">
                  <Globe className="w-5 h-5" />
                  <h2 className="text-xl font-bold text-foreground">
                    Your website is live!
                  </h2>
                </div>
              ) : (
                <div className="flex items-center gap-2 text-primary">
                  <Eye className="w-5 h-5" />
                  <h2 className="text-xl font-bold text-foreground">
                    Website Preview
                  </h2>
                </div>
              )}
            </div>
            <p className="text-muted-foreground text-sm">
              {filesCount} pages generated
              {vercelUrl && (
                <>
                  {" "}—{" "}
                  <a
                    href={vercelUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline"
                  >
                    {vercelUrl}
                  </a>
                </>
              )}
            </p>
          </div>

          <div className="flex items-center gap-2">
            {phase === "deploying" ? (
              <div className="inline-flex items-center gap-2 rounded-xl bg-secondary px-4 py-2.5 text-sm text-muted-foreground">
                <Loader2 className="w-4 h-4 animate-spin" />
                Publishing...
              </div>
            ) : vercelUrl ? (
              <a
                href={vercelUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-xl bg-green-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-green-500 transition-all shadow-lg shadow-green-600/25"
              >
                <ExternalLink className="w-4 h-4" />
                Open Live Site
              </a>
            ) : (
              <button
                onClick={handleDeploy}
                className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-all shadow-lg shadow-primary/25"
              >
                <Rocket className="w-4 h-4" />
                Publish to Web
              </button>
            )}
            <button
              onClick={handleRetry}
              className="inline-flex items-center gap-2 rounded-xl border border-border px-4 py-2.5 text-sm font-medium text-muted-foreground hover:text-foreground hover:border-primary/30 transition-all"
            >
              <RefreshCw className="w-4 h-4" />
              Regenerate
            </button>
          </div>
        </div>

        {/* Page tabs + Viewport controls */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-4">
          {/* Page tabs */}
          <div className="flex items-center gap-1 overflow-x-auto pb-1">
            {pages.map((page) => (
              <button
                key={page.path}
                onClick={() => setActivePage(page.path)}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-all",
                  activePage === page.path
                    ? "bg-primary text-primary-foreground shadow-md"
                    : "text-muted-foreground hover:text-foreground hover:bg-secondary"
                )}
              >
                {page.label}
              </button>
            ))}
          </div>

          {/* Viewport switcher */}
          <div className="flex items-center gap-1 bg-secondary rounded-lg p-1">
            {[
              { mode: "desktop" as ViewportMode, icon: Monitor, label: "Desktop" },
              { mode: "tablet" as ViewportMode, icon: Tablet, label: "Tablet" },
              { mode: "mobile" as ViewportMode, icon: Smartphone, label: "Mobile" },
            ].map(({ mode, icon: Icon, label }) => (
              <button
                key={mode}
                onClick={() => setViewportMode(mode)}
                title={label}
                className={cn(
                  "p-2 rounded-md transition-all",
                  viewportMode === mode
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <Icon className="w-4 h-4" />
              </button>
            ))}
          </div>
        </div>

        {/* Browser chrome + iframe */}
        <div className="rounded-2xl border border-border overflow-hidden shadow-xl bg-card">
          {/* Browser bar */}
          <div className="flex items-center gap-2 px-4 py-3 bg-secondary/50 border-b border-border">
            <div className="flex gap-1.5">
              <div className="w-3 h-3 rounded-full bg-red-400" />
              <div className="w-3 h-3 rounded-full bg-yellow-400" />
              <div className="w-3 h-3 rounded-full bg-green-400" />
            </div>
            <div className="flex-1 flex items-center justify-center">
              <div className="flex items-center gap-2 bg-background rounded-lg px-3 py-1.5 text-xs text-muted-foreground max-w-md w-full">
                <Globe className="w-3 h-3 shrink-0" />
                <span className="truncate">
                  {vercelUrl || `preview — ${activePage}`}
                </span>
              </div>
            </div>
            <a
              href={previewUrl + activePage}
              target="_blank"
              rel="noopener noreferrer"
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              <ExternalLink className="w-4 h-4" />
            </a>
          </div>

          {/* Iframe container */}
          <div
            className="bg-white flex justify-center"
            style={{ minHeight: "80vh" }}
          >
            <iframe
              key={activePage}
              src={previewUrl + activePage}
              className="border-0 transition-all duration-300"
              style={{
                width: iframeWidth,
                height: "80vh",
                maxWidth: "100%",
              }}
              title="Website Preview"
            />
          </div>
        </div>

        {error && (
          <div className="mt-4 rounded-xl border border-yellow-500/30 bg-yellow-500/5 p-4 text-center">
            <p className="text-sm text-yellow-400">{error}</p>
          </div>
        )}
      </div>
    );
  }

  // Building / Error states
  return (
    <div className="animate-fade-in max-w-3xl mx-auto">
      <Stepper currentStep={4} />

      <div className="text-center mb-10">
        <h2 className="text-xl font-bold text-foreground mb-2">
          Building Your Website
        </h2>
        <p className="text-muted-foreground text-sm">
          AI is generating a complete multi-page website from your selected
          design
        </p>
      </div>

      {/* Progress steps */}
      <div className="space-y-4 mb-10">
        {PROGRESS_STEPS.map((step, index) => {
          const isCurrent = index === currentStepIndex;
          const isDone = index < currentStepIndex;
          const isFailed =
            phase === "failed" && index === currentStepIndex;
          const Icon = step.icon;

          return (
            <div
              key={step.key}
              className={cn(
                "flex items-center gap-4 rounded-xl border p-4 transition-all duration-500",
                isCurrent && !isFailed
                  ? "border-primary bg-primary/5 shadow-lg shadow-primary/10"
                  : isDone
                  ? "border-green-500/30 bg-green-500/5"
                  : isFailed
                  ? "border-red-500/30 bg-red-500/5"
                  : "border-border bg-card opacity-50"
              )}
            >
              <div
                className={cn(
                  "flex items-center justify-center w-10 h-10 rounded-xl transition-all",
                  isCurrent && !isFailed
                    ? "bg-primary text-primary-foreground"
                    : isDone
                    ? "bg-green-500/10 text-green-400"
                    : isFailed
                    ? "bg-red-500/10 text-red-400"
                    : "bg-secondary text-muted-foreground"
                )}
              >
                {isDone ? (
                  <Check className="w-5 h-5" />
                ) : isFailed ? (
                  <AlertTriangle className="w-5 h-5" />
                ) : isCurrent ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <Icon className="w-5 h-5" />
                )}
              </div>
              <div className="flex-1">
                <p
                  className={cn(
                    "font-semibold text-sm",
                    isCurrent || isDone
                      ? "text-foreground"
                      : "text-muted-foreground"
                  )}
                >
                  {step.label}
                </p>
                {isCurrent && (
                  <p className="text-xs text-muted-foreground mt-0.5 animate-fade-in">
                    {PHASE_INFO[phase]?.description}
                  </p>
                )}
                {isDone && (
                  <p className="text-xs text-green-400 mt-0.5">
                    Complete
                  </p>
                )}
              </div>
              {isCurrent && filesCount > 0 && (
                <div className="text-xs text-muted-foreground">
                  {filesCount} pages
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Generating animation */}
      {phase === "generating" && (
        <div className="text-center animate-fade-in">
          <div className="inline-flex flex-col items-center gap-3 rounded-2xl border border-border bg-card p-8">
            <div className="relative">
              <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
                <Code2 className="w-8 h-8 text-primary" />
              </div>
              <div className="absolute -top-1 -right-1 w-6 h-6 rounded-full bg-primary flex items-center justify-center animate-pulse">
                <Loader2 className="w-3 h-3 text-primary-foreground animate-spin" />
              </div>
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">
                AI is writing your website...
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                This usually takes 2-4 minutes
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Error state */}
      {phase === "failed" && error && (
        <div className="text-center animate-fade-in">
          <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-6 mb-6">
            <AlertTriangle className="w-8 h-8 text-red-400 mx-auto mb-3" />
            <p className="text-sm text-red-400 font-medium mb-1">
              Build Failed
            </p>
            <p className="text-xs text-muted-foreground max-w-md mx-auto">
              {error}
            </p>
          </div>
          <button
            onClick={handleRetry}
            className="inline-flex items-center gap-2 rounded-xl bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-all"
          >
            <RefreshCw className="w-4 h-4" />
            Retry Build
          </button>
        </div>
      )}
    </div>
  );
}
