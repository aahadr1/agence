"use client";

import { Globe, Target, Mail, Compass, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CapabilityPreset } from "./types";

interface Props {
  presets: CapabilityPreset[];
  selected: CapabilityPreset;
  onSelect: (p: CapabilityPreset) => void;
  suggestions: string[];
  onSuggestion: (s: string) => void;
}

const PRESET_ICON: Record<string, typeof Globe> = {
  assistant: Compass,
  "lead-gen": Target,
  "email-ops": Mail,
  autonomous: Globe,
};

export function EmptyState({
  presets,
  selected,
  onSelect,
  suggestions,
  onSuggestion,
}: Props) {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col items-center justify-center px-4 py-10">
      <div className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-full bg-[var(--foreground)] text-[var(--primary-foreground)]">
        <Sparkles className="h-5 w-5" strokeWidth={1.5} />
      </div>
      <h2 className="text-[20px] font-semibold tracking-tight">
        Que voulez-vous faire aujourd&apos;hui ?
      </h2>
      <p className="mt-1 max-w-lg text-center text-[13px] text-[var(--muted-foreground)]">
        Décrivez votre objectif. L&apos;agent planifie, utilise des outils,
        réfléchit à voix haute, et vous demande votre aval avant toute action
        sensible.
      </p>

      <div className="mt-6 grid w-full grid-cols-1 gap-2 sm:grid-cols-2">
        {presets.map((p) => {
          const Icon = PRESET_ICON[p.id] || Compass;
          const active = selected.id === p.id;
          return (
            <button
              key={p.id}
              onClick={() => onSelect(p)}
              className={cn(
                "group rounded-xl border px-3.5 py-3 text-left transition-all",
                active
                  ? "border-[var(--foreground)] bg-[var(--card)] shadow-sm"
                  : "border-[var(--border)] bg-[var(--card)] hover:border-[var(--control-border-hover)]",
              )}
            >
              <div className="mb-1 flex items-center gap-2">
                <div
                  className={cn(
                    "inline-flex h-6 w-6 items-center justify-center rounded-md",
                    active
                      ? "bg-[var(--foreground)] text-[var(--primary-foreground)]"
                      : "bg-[var(--muted)] text-[var(--foreground)]",
                  )}
                >
                  <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />
                </div>
                <p className="text-[13px] font-semibold">{p.label}</p>
                {active && (
                  <span className="ml-auto rounded-full bg-[var(--foreground)] px-1.5 py-0 text-[9.5px] font-semibold uppercase tracking-wider text-[var(--primary-foreground)]">
                    Actif
                  </span>
                )}
              </div>
              <p className="text-[11.5px] text-[var(--muted-foreground)]">
                {p.description}
              </p>
            </button>
          );
        })}
      </div>

      {suggestions.length > 0 && (
        <div className="mt-6 w-full">
          <p className="mb-2 text-[10.5px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
            Exemples
          </p>
          <div className="flex flex-col gap-1.5">
            {suggestions.map((s) => (
              <button
                key={s}
                onClick={() => onSuggestion(s)}
                className={cn(
                  "rounded-lg border border-[var(--border)] bg-[var(--card)]",
                  "px-3 py-2 text-left text-[12.5px] text-[var(--foreground)]/85",
                  "transition-all hover:border-[var(--control-border-hover)] hover:bg-[var(--muted)]/50",
                )}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
