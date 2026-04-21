"use client";

import { useState } from "react";
import { RotateCcw, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

const REASON_LABEL: Record<string, string> = {
  pseudo_tool_call: "outil écrit en texte",
  intent_without_action: "annonce sans action",
  open_work_remaining: "travail non terminé",
  auto_finalize: "clôture automatique",
  course_correction: "auto-correction",
  planning_roadmap_no_tools: "plan sans outils",
  deliverable_incomplete: "livrable incomplet",
  deliverable_blocks_auto_finalize: "CRM incomplet",
};

function shortHintForReason(reason: string): string {
  switch (reason) {
    case "pseudo_tool_call":
      return "L’agent reprend en appelant un vrai outil au lieu de simuler du code.";
    case "intent_without_action":
      return "Le prochain message doit inclure au moins un appel d’outil utile.";
    case "open_work_remaining":
      return "La mission continue : étapes ou CRM encore ouverts.";
    case "deliverable_incomplete":
    case "deliverable_blocks_auto_finalize":
      return "Objectif CRM pas encore atteint — poursuite attendue.";
    case "planning_roadmap_no_tools":
      return "Un plan en texte seul ne suffit pas — exécution requise.";
    default:
      return "Ajustement interne pour garder l’agent sur les rails.";
  }
}

export function NudgeEvent({
  content,
  reason,
}: {
  content: string;
  reason: string;
}) {
  const [open, setOpen] = useState(false);
  const label = REASON_LABEL[reason] || reason;
  const hint = shortHintForReason(reason);

  return (
    <div className="ml-10 animate-fade-in">
      <button
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full",
          "border border-[var(--border)] bg-transparent",
          "px-2.5 py-0.5 text-[11px] text-[var(--muted-foreground)]",
          "hover:border-[var(--control-border-hover)] hover:text-[var(--foreground)]",
        )}
      >
        <RotateCcw className="h-3 w-3" strokeWidth={2} />
        <span>Ajustement · {label}</span>
        <ChevronRight
          className={cn(
            "h-3 w-3 transition-transform",
            open && "rotate-90",
          )}
        />
      </button>
      {!open && (
        <p className="mt-1 ml-1 text-[11px] text-[var(--muted-foreground)] leading-snug max-w-md">
          {hint}
        </p>
      )}
      {open && (
        <div className="mt-1.5 rounded-md border border-dashed border-[var(--border)] bg-[var(--muted)]/40 px-3 py-2 text-[11.5px] leading-relaxed text-[var(--muted-foreground)] whitespace-pre-wrap">
          <p className="mb-2 text-[11px] text-[var(--foreground)]">
            Détail technique (modèle uniquement)
          </p>
          {content}
        </div>
      )}
    </div>
  );
}
