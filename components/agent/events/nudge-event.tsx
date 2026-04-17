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
};

export function NudgeEvent({
  content,
  reason,
}: {
  content: string;
  reason: string;
}) {
  const [open, setOpen] = useState(false);
  const label = REASON_LABEL[reason] || reason;

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
        <span>Auto-correction · {label}</span>
        <ChevronRight
          className={cn(
            "h-3 w-3 transition-transform",
            open && "rotate-90",
          )}
        />
      </button>
      {open && (
        <div className="mt-1.5 rounded-md border border-dashed border-[var(--border)] bg-[var(--muted)]/40 px-3 py-2 text-[11.5px] leading-relaxed text-[var(--muted-foreground)] whitespace-pre-wrap">
          {content}
        </div>
      )}
    </div>
  );
}
