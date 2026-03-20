"use client";

import { PageHeader } from "@/components/ui/page-header";
import { Panel } from "@/components/ui/panel";
import { Stepper } from "@/components/website-maker/stepper";
import { Variant } from "@/lib/types";
import { Loader2, Sparkles } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

async function safeJson(res: Response) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(text.slice(0, 200) || `HTTP ${res.status}`);
  }
}

export default function IdeationPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const router = useRouter();
  const [variants, setVariants] = useState<Variant[]>([]);
  const [generating, setGenerating] = useState(true);
  const [imageStatuses, setImageStatuses] = useState<
    Record<string, "pending" | "generating" | "done" | "failed">
  >({});
  const [error, setError] = useState("");
  const initiated = useRef(false);

  const pollPrediction = useCallback(
    async (predictionId: string, variantId: string) => {
      const maxAttempts = 120;
      for (let i = 0; i < maxAttempts; i++) {
        await new Promise((r) => setTimeout(r, 3000));
        try {
          const res = await fetch(`/api/predictions/${predictionId}`);
          const data = await safeJson(res);

          if (data.status === "succeeded") {
            setImageStatuses((prev) => ({ ...prev, [variantId]: "done" }));
            setVariants((prev) =>
              prev.map((v) =>
                v.id === variantId ? { ...v, image_url: data.imageUrl } : v
              )
            );
            return;
          } else if (data.status === "failed" || data.status === "canceled") {
            setImageStatuses((prev) => ({ ...prev, [variantId]: "failed" }));
            return;
          }
        } catch {
          // Retry on network error
        }
      }
      setImageStatuses((prev) => ({ ...prev, [variantId]: "failed" }));
    },
    []
  );

  useEffect(() => {
    if (initiated.current) return;
    initiated.current = true;

    const startIdeation = async () => {
      try {
        const ideationRes = await fetch("/api/ideation", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId }),
        });

        if (!ideationRes.ok) {
          const data = await safeJson(ideationRes);
          throw new Error(data.error || "Ideation failed");
        }

        const ideationData = await safeJson(ideationRes);
        const ideationPredId = ideationData.predictionId;
        if (!ideationPredId) {
          throw new Error("Ideation API did not return a prediction ID");
        }

        let ideationOutput: string | null = null;
        for (let i = 0; i < 120; i++) {
          await new Promise((r) => setTimeout(r, 3000));
          try {
            const pollRes = await fetch(`/api/predictions/${ideationPredId}`);
            if (!pollRes.ok) continue;
            const pollData = await safeJson(pollRes);
            if (pollData.status === "succeeded") {
              ideationOutput = pollData.rawOutput;
              break;
            }
            if (pollData.status === "failed" || pollData.status === "canceled") {
              throw new Error(`Ideation failed: ${pollData.error || "unknown"}`);
            }
          } catch (e) {
            if (e instanceof Error && e.message.includes("Ideation failed")) throw e;
          }
        }
        if (!ideationOutput) throw new Error("Ideation timed out");

        const saveRes = await fetch("/api/ideation/save", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId, rawOutput: ideationOutput }),
        });
        if (!saveRes.ok) {
          const data = await safeJson(saveRes);
          throw new Error(data.error || "Failed to save concepts");
        }

        const saveData = await safeJson(saveRes);
        const newVariants = saveData.variants;
        if (!newVariants || !Array.isArray(newVariants) || newVariants.length === 0) {
          throw new Error("No design concepts were generated — please try again");
        }
        setVariants(newVariants);
        setGenerating(false);

        const initialStatuses: Record<
          string,
          "pending" | "generating" | "done" | "failed"
        > = {};
        newVariants.forEach(
          (v: Variant) => (initialStatuses[v.id] = "generating")
        );
        setImageStatuses(initialStatuses);

        const imagePromises = newVariants.map(async (variant: Variant) => {
          try {
            const imgRes = await fetch("/api/generate-image", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                variantId: variant.id,
                prompt: variant.prompt,
                projectId,
              }),
            });

            if (!imgRes.ok) {
              setImageStatuses((prev) => ({
                ...prev,
                [variant.id]: "failed",
              }));
              return;
            }

            const { predictionId } = await safeJson(imgRes);
            pollPrediction(predictionId, variant.id);
          } catch {
            setImageStatuses((prev) => ({
              ...prev,
              [variant.id]: "failed",
            }));
          }
        });

        await Promise.all(imagePromises);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong");
        setGenerating(false);
      }
    };

    startIdeation();
  }, [projectId, pollPrediction]);

  const allDone =
    variants.length > 0 &&
    variants.every(
      (v) =>
        imageStatuses[v.id] === "done" || imageStatuses[v.id] === "failed"
    );

  const handleProceed = () => {
    router.push(`/website-maker/${projectId}/selection`);
  };

  return (
    <div className="animate-fade-in mx-auto max-w-5xl">
      <Stepper currentStep={2} />

      <PageHeader
        eyebrow="Concepts"
        title={
          generating
            ? "Designing directions"
            : "Three directions"
        }
        description={
          generating
            ? "Research-backed themes and mockups are being prepared."
            : "Review thumbnails. When all three finish, continue to selection."
        }
        className="mb-10"
      />

      {error ? (
        <p className="mb-8 border border-destructive/25 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {generating ? (
        <div className="flex flex-col items-center border-t border-border py-14">
          <Loader2 className="mb-6 h-8 w-8 animate-spin text-muted-foreground" />
          <div className="grid w-full grid-cols-1 gap-4 md:grid-cols-3">
            {[1, 2, 3].map((i) => (
              <Panel key={i} padding="none" className="overflow-hidden rounded-sm">
                <div className="aspect-[4/3] animate-shimmer" />
                <div className="space-y-2 border-t border-border p-4">
                  <div className="h-3 w-20 animate-shimmer" />
                  <div className="h-2 w-full animate-shimmer" />
                </div>
              </Panel>
            ))}
          </div>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-6 border-t border-border pt-10 md:grid-cols-3">
            {variants.map((variant, index) => (
              <Panel
                key={variant.id}
                padding="none"
                className="overflow-hidden rounded-sm animate-fade-in"
              >
                <div className="aspect-[4/3] bg-secondary">
                  {imageStatuses[variant.id] === "done" &&
                  variant.image_url ? (
                    <img
                      src={variant.image_url}
                      alt={variant.theme_name}
                      className="h-full w-full object-cover"
                    />
                  ) : imageStatuses[variant.id] === "failed" ? (
                    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                      Failed
                    </div>
                  ) : (
                    <div className="flex h-full flex-col items-center justify-center gap-2">
                      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                      <span className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                        Rendering
                      </span>
                    </div>
                  )}
                </div>
                <div className="border-t border-border p-4">
                  <div className="mb-2 flex items-center gap-2">
                    <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    {variant.color_scheme && (
                      <div className="ml-auto flex gap-1">
                        {Object.values(variant.color_scheme)
                          .filter((c) => typeof c === "string" && c.startsWith("#"))
                          .map((color, ci) => (
                            <div
                              key={ci}
                              className="h-3 w-3 border border-border"
                              style={{ backgroundColor: color as string }}
                            />
                          ))}
                      </div>
                    )}
                  </div>
                  <h3 className="text-sm font-medium text-foreground">
                    {variant.theme_name}
                  </h3>
                </div>
              </Panel>
            ))}
          </div>

          {allDone && (
            <div className="mt-12 flex justify-center border-t border-border pt-10">
              <button
                type="button"
                onClick={handleProceed}
                className="btn-solid"
              >
                <Sparkles className="h-4 w-4" strokeWidth={1.25} />
                Choose a design
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
