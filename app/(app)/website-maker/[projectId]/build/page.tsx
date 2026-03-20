"use client";

import { PageHeader } from "@/components/ui/page-header";
import { Panel } from "@/components/ui/panel";
import { Stepper } from "@/components/website-maker/stepper";
import { cn } from "@/lib/utils";
import {
  AlertTriangle,
  Check,
  Code2,
  Eye,
  ExternalLink,
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
          console.warn("[build] Status check failed:", res.status);
          startBuild();
          return;
        }
        const { build } = await res.json();

        if (build) {
          setBuildId(build.id);

          const hasFiles =
            Array.isArray(build.files) && build.files.length > 0;

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

          // Build exists but is still generating — check if it's stale (>15 min)
          const age = Date.now() - new Date(build.created_at).getTime();
          if (age > 15 * 60 * 1000) {
            console.log("[build] Stale generating build, starting fresh");
            startBuild();
            return;
          }

          // Recent generating build — don't start another one, just show generating state
          console.log("[build] Build in progress:", build.status);
          setPhase("generating");
          return;
        }
      } catch (err) {
        console.error("[build] checkExistingBuild error:", err);
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
      <div className="animate-fade-in mx-auto max-w-[1400px]">
        <Stepper currentStep={4} />

        <PageHeader
          eyebrow={phase === "deployed" && vercelUrl ? "Live" : "Build"}
          title={
            phase === "deployed" && vercelUrl
              ? "Site is published"
              : "Preview"
          }
          description={
            <>
              {filesCount} pages
              {vercelUrl ? (
                <>
                  {" · "}
                  <a
                    href={vercelUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline underline-offset-4 hover:no-underline"
                  >
                    {vercelUrl}
                  </a>
                </>
              ) : null}
            </>
          }
          className="mb-8"
        >
          <div className="flex flex-wrap items-center gap-2">
            {phase === "deploying" ? (
              <span className="inline-flex items-center gap-2 border border-border px-3 py-2 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Publishing
              </span>
            ) : vercelUrl ? (
              <a
                href={vercelUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-solid"
              >
                <ExternalLink className="h-4 w-4" strokeWidth={1.25} />
                Open live
              </a>
            ) : (
              <button type="button" onClick={handleDeploy} className="btn-solid">
                <Rocket className="h-4 w-4" strokeWidth={1.25} />
                Publish
              </button>
            )}
            <button type="button" onClick={handleRetry} className="btn-outline">
              <RefreshCw className="h-4 w-4" strokeWidth={1.25} />
              Regenerate
            </button>
          </div>
        </PageHeader>

        <div className="mb-4 flex flex-col justify-between gap-4 border-t border-border pt-8 sm:flex-row sm:items-center">
          <div className="flex items-center gap-1 overflow-x-auto pb-1">
            {pages.map((page) => (
              <button
                key={page.path}
                type="button"
                onClick={() => setActivePage(page.path)}
                className={cn(
                  "whitespace-nowrap border-b-2 px-3 py-2 text-xs font-medium uppercase tracking-[0.08em] transition-colors",
                  activePage === page.path
                    ? "-mb-px border-foreground text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                )}
              >
                {page.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-0 border border-border p-0.5">
            {[
              { mode: "desktop" as ViewportMode, icon: Monitor, label: "Desktop" },
              { mode: "tablet" as ViewportMode, icon: Tablet, label: "Tablet" },
              { mode: "mobile" as ViewportMode, icon: Smartphone, label: "Mobile" },
            ].map(({ mode, icon: Icon, label }) => (
              <button
                key={mode}
                type="button"
                onClick={() => setViewportMode(mode)}
                title={label}
                className={cn(
                  "p-2 transition-colors",
                  viewportMode === mode
                    ? "bg-foreground text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <Icon className="h-4 w-4" strokeWidth={1.25} />
              </button>
            ))}
          </div>
        </div>

        <Panel padding="none" className="overflow-hidden rounded-sm border-border">
          <div className="flex items-center gap-3 border-b border-border bg-secondary/30 px-4 py-3">
            <div className="flex gap-1">
              <span className="h-2 w-2 rounded-full bg-black/15" />
              <span className="h-2 w-2 rounded-full bg-black/10" />
              <span className="h-2 w-2 rounded-full bg-black/20" />
            </div>
            <div className="mx-auto flex max-w-md flex-1 items-center gap-2 border border-border bg-background px-3 py-1.5 font-mono text-[10px] text-muted-foreground">
              <Globe className="h-3 w-3 shrink-0" strokeWidth={1.25} />
              <span className="truncate">
                {vercelUrl || activePage}
              </span>
            </div>
            <a
              href={previewUrl + activePage}
              target="_blank"
              rel="noopener noreferrer"
              className="text-muted-foreground hover:text-foreground"
            >
              <ExternalLink className="h-4 w-4" strokeWidth={1.25} />
            </a>
          </div>

          <div
            className="flex justify-center bg-[var(--preview-chrome)]"
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
        </Panel>

        {error && (
          <div className="mt-4 border border-border bg-secondary/50 p-4 text-center">
            <p className="text-sm text-foreground">{error}</p>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="animate-fade-in mx-auto max-w-3xl">
      <Stepper currentStep={4} />

      <PageHeader
        eyebrow="Build"
        title="Generating site"
        description="One pass writes all pages; preview appears when parsing finishes."
        className="mb-10"
      />

      <div className="mb-10 space-y-0 border border-border bg-card">
        {PROGRESS_STEPS.map((step, index) => {
          const isCurrent = index === currentStepIndex;
          const isDone = index < currentStepIndex;
          const isFailed = phase === "failed" && index === currentStepIndex;
          const Icon = step.icon;

          return (
            <div
              key={step.key}
              className={cn(
                "flex items-center gap-4 border-b border-border p-4 last:border-b-0",
                isCurrent && !isFailed && "bg-secondary/30",
                isFailed && "bg-destructive/5"
              )}
            >
              <div
                className={cn(
                  "flex h-10 w-10 shrink-0 items-center justify-center border border-border bg-background",
                  isDone && "border-foreground bg-foreground text-primary-foreground"
                )}
              >
                {isDone ? (
                  <Check className="h-4 w-4" strokeWidth={2} />
                ) : isFailed ? (
                  <AlertTriangle className="h-4 w-4 text-destructive" />
                ) : isCurrent ? (
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                ) : (
                  <Icon className="h-4 w-4 text-muted-foreground" strokeWidth={1.25} />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p
                  className={cn(
                    "text-sm font-medium",
                    isCurrent || isDone ? "text-foreground" : "text-muted-foreground"
                  )}
                >
                  {step.label}
                </p>
                {isCurrent ? (
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {PHASE_INFO[phase]?.description}
                  </p>
                ) : null}
                {isDone ? (
                  <p className="mt-0.5 text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
                    Done
                  </p>
                ) : null}
              </div>
              {isCurrent && filesCount > 0 ? (
                <span className="font-mono text-[10px] text-muted-foreground">
                  {filesCount} pg
                </span>
              ) : null}
            </div>
          );
        })}
      </div>

      {phase === "generating" && (
        <Panel padding="lg" className="rounded-sm text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center border border-border">
            <Code2 className="h-5 w-5 text-muted-foreground" strokeWidth={1.25} />
          </div>
          <p className="text-sm font-medium text-foreground">Writing pages…</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Typically two to four minutes.
          </p>
        </Panel>
      )}

      {phase === "failed" && error && (
        <div className="text-center">
          <Panel padding="md" className="mb-6 rounded-sm border-destructive/20">
            <AlertTriangle className="mx-auto mb-3 h-7 w-7 text-destructive" />
            <p className="text-sm font-medium text-destructive">Build failed</p>
            <p className="mx-auto mt-2 max-w-md text-xs text-muted-foreground">
              {error}
            </p>
          </Panel>
          <button type="button" onClick={handleRetry} className="btn-solid">
            <RefreshCw className="h-4 w-4" strokeWidth={1.25} />
            Retry
          </button>
        </div>
      )}
    </div>
  );
}
