"use client";

import { Stepper } from "@/components/website-maker/stepper";
import { Variant } from "@/lib/types";
import { Loader2, Sparkles, Wand2 } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

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
          const data = await res.json();

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
        // Step 1: Generate concepts with AI
        const ideationRes = await fetch("/api/ideation", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ projectId }),
        });

        if (!ideationRes.ok) {
          const data = await ideationRes.json();
          throw new Error(data.error || "Ideation failed");
        }

        const { variants: newVariants } = await ideationRes.json();
        setVariants(newVariants);
        setGenerating(false);

        // Step 2: Generate images for each variant
        const initialStatuses: Record<string, "pending" | "generating" | "done" | "failed"> = {};
        newVariants.forEach(
          (v: Variant) => (initialStatuses[v.id] = "generating")
        );
        setImageStatuses(initialStatuses);

        for (const variant of newVariants) {
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
              const errData = await imgRes.json().catch(() => ({}));
              console.error(`[generate-image] variant ${variant.id} failed:`, errData);
              setImageStatuses((prev) => ({
                ...prev,
                [variant.id]: "failed",
              }));
              continue;
            }

            const { predictionId } = await imgRes.json();
            pollPrediction(predictionId, variant.id);
          } catch {
            setImageStatuses((prev) => ({
              ...prev,
              [variant.id]: "failed",
            }));
          }
        }
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
    <div className="animate-fade-in max-w-5xl mx-auto">
      <Stepper currentStep={2} />

      <div className="text-center mb-8">
        <div className="inline-flex items-center justify-center p-3 rounded-2xl bg-primary/10 mb-4">
          <Wand2 className="w-7 h-7 text-primary" />
        </div>
        <h2 className="text-xl font-bold text-foreground">
          {generating
            ? "AI is designing your concepts..."
            : "Your Website Concepts"}
        </h2>
        <p className="text-muted-foreground mt-1 text-sm">
          {generating
            ? "Creating 3 unique design variations for your business"
            : "3 unique designs generated. Waiting for visuals..."}
        </p>
      </div>

      {error && (
        <p className="text-sm text-destructive bg-destructive/10 rounded-lg px-3 py-2 mb-6 text-center">
          {error}
        </p>
      )}

      {generating ? (
        <div className="flex flex-col items-center py-12">
          <Loader2 className="w-10 h-10 text-primary animate-spin mb-6" />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 w-full">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="rounded-2xl border border-border bg-card overflow-hidden"
              >
                <div className="aspect-[4/3] animate-shimmer" />
                <div className="p-4 space-y-2">
                  <div className="h-4 w-24 rounded animate-shimmer" />
                  <div className="h-3 w-full rounded animate-shimmer" />
                  <div className="h-3 w-3/4 rounded animate-shimmer" />
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {variants.map((variant, index) => (
              <div
                key={variant.id}
                className="rounded-2xl border border-border bg-card overflow-hidden animate-fade-in"
                style={{ animationDelay: `${index * 150}ms` }}
              >
                <div className="aspect-[4/3] relative bg-secondary">
                  {imageStatuses[variant.id] === "done" && variant.image_url ? (
                    <img
                      src={variant.image_url}
                      alt={variant.theme_name}
                      className="w-full h-full object-cover transition-opacity duration-500"
                    />
                  ) : imageStatuses[variant.id] === "failed" ? (
                    <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
                      Failed to generate
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center h-full gap-3">
                      <Loader2 className="w-6 h-6 text-primary animate-spin" />
                      <span className="text-xs text-muted-foreground">
                        Generating image...
                      </span>
                    </div>
                  )}
                </div>
                <div className="p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-xs font-semibold text-primary bg-primary/10 px-2 py-0.5 rounded-full">
                      Variant {index + 1}
                    </span>
                    {variant.color_scheme && (
                      <div className="flex gap-1 ml-auto">
                        {Object.values(variant.color_scheme).map(
                          (color, ci) => (
                            <div
                              key={ci}
                              className="w-4 h-4 rounded-full border border-border"
                              style={{ backgroundColor: color }}
                            />
                          )
                        )}
                      </div>
                    )}
                  </div>
                  <h3 className="font-semibold text-foreground text-sm">
                    {variant.theme_name}
                  </h3>
                </div>
              </div>
            ))}
          </div>

          {allDone && (
            <div className="mt-8 text-center animate-fade-in">
              <button
                onClick={handleProceed}
                className="inline-flex items-center gap-2 rounded-xl bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-all shadow-lg shadow-primary/25"
              >
                <Sparkles className="w-4 h-4" />
                Choose Your Favorite
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
