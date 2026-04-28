"use client";

import { useState } from "react";
import { Sparkles, ChevronRight, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  iteration: number;
  observation: string;
  conclusion: string;
  next_action: string | null;
}

export function ReflectionEvent({
  iteration,
  observation,
  conclusion,
  next_action,
}: Props) {
  const [open, setOpen] = useState(false);
  const previewSource = next_action || conclusion || observation;
  const preview =
    previewSource && previewSource.length > 120
      ? `${previewSource.slice(0, 117).trim()}…`
      : previewSource;

  return (
    <div className="ml-10 animate-fade-in">
      <div
        className={cn(
          "rounded-xl border border-[var(--border)] bg-[var(--card)]",
          "overflow-hidden",
        )}
      >
        <button
          onClick={() => setOpen((o) => !o)}
          className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-[var(--muted)]/40"
        >
          <Sparkles
            className="h-3.5 w-3.5 text-[var(--blue)]"
            strokeWidth={1.75}
          />
          <span className="text-[11.5px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
            Réflexion
          </span>
          <span className="rounded bg-[var(--muted)] px-1.5 py-0.5 text-[10px] font-mono text-[var(--muted-foreground)]">
            iter {iteration}
          </span>
          {!open && preview && (
            <span className="min-w-0 flex-1 truncate text-[11.5px] font-normal normal-case tracking-normal text-[var(--muted-foreground)]">
              {preview}
            </span>
          )}
          <span className="ml-auto">
            <ChevronRight
              className={cn(
                "h-3.5 w-3.5 text-[var(--muted-foreground)] transition-transform",
                open && "rotate-90",
              )}
            />
          </span>
        </button>

        {open && (
          <div className="space-y-2 border-t border-[var(--border)] px-3 py-2.5 text-[12.5px] leading-relaxed">
            {observation && (
              <div>
                <p className="mb-0.5 text-[10.5px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                  Observation
                </p>
                <p className="text-[var(--foreground)]/90 whitespace-pre-wrap">
                  {observation}
                </p>
              </div>
            )}
            {conclusion && (
              <div>
                <p className="mb-0.5 text-[10.5px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
                  Conclusion
                </p>
                <p className="text-[var(--foreground)]/90 whitespace-pre-wrap">
                  {conclusion}
                </p>
              </div>
            )}
            {next_action && (
              <div className="flex items-start gap-1.5 rounded-md bg-[var(--blue-subtle)] px-2.5 py-1.5 text-[var(--foreground)]">
                <ArrowRight
                  className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--blue)]"
                  strokeWidth={2}
                />
                <span className="whitespace-pre-wrap">{next_action}</span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
