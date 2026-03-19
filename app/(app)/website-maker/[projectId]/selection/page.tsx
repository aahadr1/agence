"use client";

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
          // Already confirmed — go to build page
          router.push(`/website-maker/${projectId}/build`);
          return;
        }
      }
      setLoading(false);
    };
    fetchVariants();
  }, [projectId, supabase]);

  const handleSelect = (id: string) => {
    if (confirmed) return;
    setSelectedId(id);
  };

  const handleConfirm = async () => {
    if (!selectedId) return;
    setConfirming(true);

    try {
      // Update variant as selected
      await supabase
        .from("variants")
        .update({ selected: false })
        .eq("project_id", projectId);

      await supabase
        .from("variants")
        .update({ selected: true })
        .eq("id", selectedId);

      // Update project
      await supabase
        .from("projects")
        .update({
          selected_variant_id: selectedId,
          status: "completed",
          updated_at: new Date().toISOString(),
        })
        .eq("id", projectId);

      setConfirmed(true);
      // Redirect to build page
      router.push(`/website-maker/${projectId}/build`);
    } catch {
      // Handle error silently
    }
    setConfirming(false);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
      </div>
    );
  }

  if (confirmed) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="w-8 h-8 text-primary animate-spin" />
      </div>
    );
  }

  return (
    <div className="animate-fade-in max-w-5xl mx-auto">
      <Stepper currentStep={3} />

      <div className="text-center mb-8">
        <h2 className="text-xl font-bold text-foreground">
          Choose Your Design
        </h2>
        <p className="text-muted-foreground mt-1 text-sm">
          Select the website design that best represents the business
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {variants.map((variant, index) => {
          const isSelected = selectedId === variant.id;
          const isOther = selectedId && !isSelected;

          return (
            <button
              key={variant.id}
              onClick={() => handleSelect(variant.id)}
              className={cn(
                "group relative rounded-2xl border-2 bg-card overflow-hidden transition-all duration-500 text-left",
                isSelected
                  ? "border-primary shadow-xl shadow-primary/20 scale-[1.03] z-10"
                  : isOther
                  ? "border-border opacity-50 scale-[0.97] hover:opacity-75"
                  : "border-border hover:border-primary/40 hover:shadow-lg"
              )}
            >
              {/* Selected checkmark */}
              {isSelected && (
                <div className="absolute top-3 right-3 z-20 flex items-center justify-center w-8 h-8 rounded-full bg-primary text-primary-foreground shadow-lg animate-fade-in">
                  <Check className="w-4 h-4" />
                </div>
              )}

              {/* Glow effect when selected */}
              {isSelected && (
                <div className="absolute inset-0 z-0 bg-gradient-to-t from-primary/10 to-transparent pointer-events-none" />
              )}

              <div className="aspect-[4/3] relative bg-secondary">
                {variant.image_url ? (
                  <img
                    src={variant.image_url}
                    alt={variant.theme_name}
                    className={cn(
                      "w-full h-full object-cover transition-all duration-500",
                      isSelected && "brightness-110"
                    )}
                  />
                ) : (
                  <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
                    No image
                  </div>
                )}
              </div>

              <div className="p-4 relative z-10">
                <div className="flex items-center gap-2 mb-2">
                  <span
                    className={cn(
                      "text-xs font-semibold px-2 py-0.5 rounded-full transition-colors",
                      isSelected
                        ? "bg-primary text-primary-foreground"
                        : "bg-primary/10 text-primary"
                    )}
                  >
                    Variant {index + 1}
                  </span>
                  {variant.color_scheme && (
                    <div className="flex gap-1 ml-auto">
                      {Object.values(variant.color_scheme).map((color, ci) => (
                        <div
                          key={ci}
                          className="w-4 h-4 rounded-full border border-border"
                          style={{ backgroundColor: color }}
                        />
                      ))}
                    </div>
                  )}
                </div>
                <h3 className="font-semibold text-foreground text-sm">
                  {variant.theme_name}
                </h3>
              </div>
            </button>
          );
        })}
      </div>

      {selectedId && (
        <div className="mt-8 text-center animate-fade-in">
          <button
            onClick={handleConfirm}
            disabled={confirming}
            className="inline-flex items-center gap-2 rounded-xl bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-all shadow-lg shadow-primary/25 disabled:opacity-50"
          >
            {confirming ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Check className="w-4 h-4" />
            )}
            Confirm Selection
          </button>
        </div>
      )}
    </div>
  );
}
