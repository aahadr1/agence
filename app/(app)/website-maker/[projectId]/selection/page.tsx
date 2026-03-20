"use client";

import { PageHeader } from "@/components/ui/page-header";
import { Stepper } from "@/components/website-maker/stepper";
import { createClient } from "@/lib/supabase/client";
import { Variant } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Check, Loader2 } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

export default function SelectionPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const router = useRouter();
  const [variants, setVariants] = useState<Variant[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const supabase = createClient();

  useEffect(() => {
    const fetchVariants = async () => {
      const { data } = await supabase
        .from("variants")
        .select("*")
        .eq("project_id", projectId)
        .order("created_at", { ascending: true });

      if (data) {
        setVariants(data);
        const selected = data.find((v) => v.selected);
        if (selected) {
          router.push(`/website-maker/${projectId}/build`);
          return;
        }
      }
      setLoading(false);
    };
    fetchVariants();
  }, [projectId, router, supabase]);

  const handleSelect = (id: string) => {
    if (confirmed) return;
    setSelectedId(id);
  };

  const handleConfirm = async () => {
    if (!selectedId) return;
    setConfirming(true);

    try {
      await supabase
        .from("variants")
        .update({ selected: false })
        .eq("project_id", projectId);

      await supabase
        .from("variants")
        .update({ selected: true })
        .eq("id", selectedId);

      await supabase
        .from("projects")
        .update({
          selected_variant_id: selectedId,
          status: "completed",
          updated_at: new Date().toISOString(),
        })
        .eq("id", projectId);

      setConfirmed(true);
      router.push(`/website-maker/${projectId}/build`);
    } catch {
      // silent
    }
    setConfirming(false);
  };

  if (loading || confirmed) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="animate-fade-in mx-auto max-w-5xl">
      <Stepper currentStep={3} />

      <PageHeader
        eyebrow="Selection"
        title="Pick one direction"
        description="The concept you choose sets the layout, palette, and tone for the full build. Click a card to select, then confirm — the AI will write every page to match."
        className="mb-10"
      />

      <div className="grid grid-cols-1 gap-6 border-t border-border pt-10 md:grid-cols-3">
        {variants.map((variant, index) => {
          const isSelected = selectedId === variant.id;
          const isOther = selectedId && !isSelected;

          return (
            <button
              key={variant.id}
              type="button"
              onClick={() => handleSelect(variant.id)}
              className={cn(
                "group relative overflow-hidden border bg-card text-left transition-colors",
                isSelected
                  ? "border-foreground"
                  : isOther
                    ? "border-border opacity-45 hover:opacity-70"
                    : "border-border hover:border-foreground/25"
              )}
            >
              {isSelected && (
                <span className="absolute right-3 top-3 z-10 flex h-7 w-7 items-center justify-center border border-foreground bg-foreground text-primary-foreground">
                  <Check className="h-3.5 w-3.5" strokeWidth={2} />
                </span>
              )}

              <div className="aspect-[4/3] bg-secondary">
                {variant.image_url ? (
                  <img
                    src={variant.image_url}
                    alt={variant.theme_name}
                    className={cn(
                      "h-full w-full object-cover",
                      isSelected && "brightness-[1.02]"
                    )}
                  />
                ) : (
                  <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                    No image
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
                        .filter(
                          (c): c is string =>
                            typeof c === "string" && c.startsWith("#")
                        )
                        .map((color, ci) => (
                          <div
                            key={ci}
                            className="h-3 w-3 border border-border"
                            style={{ backgroundColor: color }}
                          />
                        ))}
                    </div>
                  )}
                </div>
                  <h3 className="text-sm font-medium text-foreground">
                    {variant.theme_name}
                  </h3>
                  {variant.theme_description && (
                    <p className="mt-1.5 text-[12px] leading-snug text-muted-foreground line-clamp-2">
                      {variant.theme_description}
                    </p>
                  )}
              </div>
            </button>
          );
        })}
      </div>

      {selectedId && (
        <div className="mt-12 flex justify-center border-t border-border pt-10">
          <button
            type="button"
            onClick={handleConfirm}
            disabled={confirming}
            className="btn-solid disabled:opacity-50"
          >
            {confirming ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Check className="h-4 w-4" strokeWidth={1.5} />
            )}
            Confirm
          </button>
        </div>
      )}
    </div>
  );
}
