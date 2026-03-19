"use client";

import { Stepper } from "@/components/website-maker/stepper";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import {
  Check,
  Code2,
  ExternalLink,
  FileCode,
  Globe,
  Loader2,
  Rocket,
  RefreshCw,
  AlertTriangle,
} from "lucide-react";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

type BuildPhase =
  | "starting"
  | "generating_foundation"
  | "polling_foundation"
  | "generating_pages"
  | "polling_pages"
  | "deploying"
  | "polling_deploy"
  | "deployed"
  | "failed";

const PHASE_LABELS: Record<BuildPhase, string> = {
  starting: "Initializing build...",
  generating_foundation: "Generating project foundation & home page...",
  polling_foundation: "AI is coding the foundation...",
  generating_pages: "Generating additional pages...",
  polling_pages: "AI is coding all pages...",
  deploying: "Deploying to Vercel...",
  polling_deploy: "Building & deploying your website...",
  deployed: "Your website is live!",
  failed: "Build failed",
};

const PHASE_STEPS = [
  { phases: ["starting", "generating_foundation", "polling_foundation"], label: "Foundation", icon: FileCode },
  { phases: ["generating_pages", "polling_pages"], label: "Pages", icon: Code2 },
  { phases: ["deploying", "polling_deploy"], label: "Deploy", icon: Rocket },
  { phases: ["deployed"], label: "Live", icon: Globe },
];

async function safeJson(res: Response) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(text.slice(0, 300) || `HTTP ${res.status}`);
  }
}

export default function BuildPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const supabase = createClient();

  const [phase, setPhase] = useState<BuildPhase>("starting");
  const [error, setError] = useState<string | null>(null);
  const [deployUrl, setDeployUrl] = useState<string | null>(null);
  const [buildId, setBuildId] = useState<string | null>(null);
  const [filesGenerated, setFilesGenerated] = useState(0);
  const startedRef = useRef(false);

  // Check for existing build
  useEffect(() => {
    const checkExistingBuild = async () => {
      const { data: builds } = await supabase
        .from("website_builds")
        .select("*")
        .eq("project_id", projectId)
        .order("created_at", { ascending: false })
        .limit(1);

      if (builds && builds.length > 0) {
        const build = builds[0];
        setBuildId(build.id);

        if (build.status === "deployed" && build.vercel_url) {
          setPhase("deployed");
          setDeployUrl(build.vercel_url);
          setFilesGenerated((build.files as unknown[])?.length || 0);
          return;
        }

        if (build.status === "failed") {
          setPhase("failed");
          setError(build.error || "Previous build failed");
          return;
        }
      }

      // No completed build — start building
      if (!startedRef.current) {
        startedRef.current = true;
        startBuild();
      }
    };
    checkExistingBuild();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const pollPrediction = useCallback(
    async (predictionId: string): Promise<{ rawOutput: string | null; imageUrl: string | null }> => {
      for (let i = 0; i < 180; i++) {
        await new Promise((r) => setTimeout(r, 3000));
        const res = await fetch(`/api/predictions/${predictionId}`);
        if (!res.ok) continue;
        const data = await safeJson(res);

        if (data.status === "succeeded") {
          return { rawOutput: data.rawOutput, imageUrl: data.imageUrl };
        }
        if (data.status === "failed" || data.status === "canceled") {
          throw new Error(`AI prediction failed: ${data.error || "unknown reason"}`);
        }
      }
      throw new Error("Prediction timed out");
    },
    []
  );

  const parseFilesJson = (raw: string): { path: string; content: string }[] => {
    const jsonMatch = raw.match(/\[[\s\S]*\]/);
    if (!jsonMatch) throw new Error("Failed to parse generated files — no JSON array found");

    try {
      return JSON.parse(jsonMatch[0]);
    } catch {
      // Try to repair truncated JSON — find last complete object
      const text = jsonMatch[0];
      // Find the last complete "}" followed by possible whitespace/comma before truncation
      const lastCompleteObj = text.lastIndexOf('}');
      if (lastCompleteObj === -1) throw new Error("Failed to parse generated files — no complete objects");

      // Try progressively shorter substrings to find valid JSON
      for (let i = lastCompleteObj; i >= 0; i--) {
        if (text[i] !== '}') continue;
        const attempt = text.slice(0, i + 1) + ']';
        try {
          const parsed = JSON.parse(attempt);
          if (Array.isArray(parsed) && parsed.length > 0) {
            console.warn(`Repaired truncated JSON: recovered ${parsed.length} files`);
            return parsed;
          }
        } catch {
          continue;
        }
      }
      throw new Error("Failed to parse generated files — JSON is too corrupted to repair");
    }
  };

  const startBuild = useCallback(async () => {
    setPhase("starting");
    setError(null);

    try {
      // Get selected variant
      const { data: project } = await supabase
        .from("projects")
        .select("selected_variant_id")
        .eq("id", projectId)
        .single();

      if (!project?.selected_variant_id) {
        throw new Error("No variant selected");
      }

      // === STEP 1: Foundation ===
      setPhase("generating_foundation");

      const foundationRes = await fetch("/api/generate-website/foundation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          variantId: project.selected_variant_id,
        }),
      });

      if (!foundationRes.ok) {
        const err = await safeJson(foundationRes);
        throw new Error(err.error || "Foundation generation failed");
      }

      const { buildId: newBuildId, predictionId: foundationPredId } =
        await safeJson(foundationRes);
      setBuildId(newBuildId);

      // Poll foundation prediction
      setPhase("polling_foundation");
      const foundationResult = await pollPrediction(foundationPredId);

      if (!foundationResult.rawOutput) {
        throw new Error("No foundation output received");
      }

      const foundationFiles = parseFilesJson(foundationResult.rawOutput);
      setFilesGenerated(foundationFiles.length);

      // === STEP 2: Pages ===
      setPhase("generating_pages");

      const pagesRes = await fetch("/api/generate-website/pages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          buildId: newBuildId,
          foundationFiles,
        }),
      });

      if (!pagesRes.ok) {
        const err = await safeJson(pagesRes);
        throw new Error(err.error || "Pages generation failed");
      }

      const { predictionId: pagesPredId } = await safeJson(pagesRes);

      // Poll pages prediction
      setPhase("polling_pages");
      const pagesResult = await pollPrediction(pagesPredId);

      if (!pagesResult.rawOutput) {
        throw new Error("No pages output received");
      }

      const pageFiles = parseFilesJson(pagesResult.rawOutput);
      setFilesGenerated(foundationFiles.length + pageFiles.length);

      // === STEP 3: Deploy ===
      setPhase("deploying");

      const deployRes = await fetch("/api/generate-website/deploy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          buildId: newBuildId,
          pageFiles,
        }),
      });

      if (!deployRes.ok) {
        const err = await safeJson(deployRes);
        throw new Error(err.error || "Deploy failed");
      }

      const { deploymentId, url } = await safeJson(deployRes);

      // Poll Vercel deployment status
      setPhase("polling_deploy");

      for (let i = 0; i < 120; i++) {
        await new Promise((r) => setTimeout(r, 5000));

        const statusRes = await fetch(
          `/api/generate-website/deploy-status?deploymentId=${deploymentId}&buildId=${newBuildId}`
        );
        if (!statusRes.ok) continue;
        const statusData = await safeJson(statusRes);

        if (statusData.status === "READY") {
          setDeployUrl(statusData.url || url);
          setPhase("deployed");
          return;
        }
        if (statusData.status === "ERROR" || statusData.status === "CANCELED") {
          throw new Error("Vercel build failed — check the generated code for errors");
        }
      }

      throw new Error("Deployment timed out");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Build failed";
      console.error("Build error:", msg);
      setError(msg);
      setPhase("failed");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, pollPrediction]);

  const handleRetry = async () => {
    // Delete failed build if exists
    if (buildId) {
      await supabase.from("website_builds").delete().eq("id", buildId);
    }
    startedRef.current = false;
    startBuild();
  };

  const currentPhaseIndex = PHASE_STEPS.findIndex((step) =>
    step.phases.includes(phase)
  );

  // Deployed state
  if (phase === "deployed" && deployUrl) {
    return (
      <div className="animate-fade-in max-w-6xl mx-auto">
        <Stepper currentStep={4} />

        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center p-4 rounded-full bg-green-500/10 mb-4 animate-pulse-ring">
            <Globe className="w-10 h-10 text-green-400" />
          </div>
          <h2 className="text-2xl font-bold text-foreground mb-2">
            Your website is live!
          </h2>
          <p className="text-muted-foreground mb-4">
            {filesGenerated} files generated and deployed successfully
          </p>
          <a
            href={deployUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-xl bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-all shadow-lg shadow-primary/25"
          >
            <ExternalLink className="w-4 h-4" />
            Open Website
          </a>
        </div>

        {/* iframe preview */}
        <div className="rounded-2xl border border-border overflow-hidden shadow-xl bg-card">
          <div className="flex items-center gap-2 px-4 py-3 bg-secondary/50 border-b border-border">
            <div className="flex gap-1.5">
              <div className="w-3 h-3 rounded-full bg-red-400" />
              <div className="w-3 h-3 rounded-full bg-yellow-400" />
              <div className="w-3 h-3 rounded-full bg-green-400" />
            </div>
            <div className="flex-1 flex items-center justify-center">
              <div className="flex items-center gap-2 bg-background rounded-lg px-3 py-1.5 text-xs text-muted-foreground max-w-md w-full">
                <Globe className="w-3 h-3 shrink-0" />
                <span className="truncate">{deployUrl}</span>
              </div>
            </div>
            <a
              href={deployUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              <ExternalLink className="w-4 h-4" />
            </a>
          </div>
          <iframe
            src={deployUrl}
            className="w-full border-0"
            style={{ height: "80vh" }}
            title="Website Preview"
          />
        </div>
      </div>
    );
  }

  // Building / Error state
  return (
    <div className="animate-fade-in max-w-3xl mx-auto">
      <Stepper currentStep={4} />

      <div className="text-center mb-10">
        <h2 className="text-xl font-bold text-foreground mb-2">
          Building Your Website
        </h2>
        <p className="text-muted-foreground text-sm">
          AI is generating a complete Next.js website and deploying it to Vercel
        </p>
      </div>

      {/* Build progress steps */}
      <div className="space-y-4 mb-10">
        {PHASE_STEPS.map((step, index) => {
          const isCurrent = index === currentPhaseIndex;
          const isDone = index < currentPhaseIndex;
          const isFailed = phase === "failed" && index === currentPhaseIndex;
          const Icon = step.icon;

          return (
            <div
              key={step.label}
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
                    {PHASE_LABELS[phase]}
                  </p>
                )}
                {isDone && (
                  <p className="text-xs text-green-400 mt-0.5">Complete</p>
                )}
              </div>
              {isCurrent && !isFailed && filesGenerated > 0 && (
                <div className="text-xs text-muted-foreground">
                  {filesGenerated} files
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Error state */}
      {phase === "failed" && error && (
        <div className="text-center animate-fade-in">
          <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-6 mb-6">
            <AlertTriangle className="w-8 h-8 text-red-400 mx-auto mb-3" />
            <p className="text-sm text-red-400 font-medium mb-1">
              Build Failed
            </p>
            <p className="text-xs text-muted-foreground">{error}</p>
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
