"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  content: string;
  active?: boolean;
}

function previewText(content: string): string {
  const compact = content.replace(/\s+/g, " ").trim();
  if (!compact) return "Analyse interne";
  return compact.length > 132 ? `${compact.slice(0, 129).trim()}…` : compact;
}

export function ThinkingEvent({ content, active }: Props) {
  const [open, setOpen] = useState(false);
  const [visibleContent, setVisibleContent] = useState(active ? "" : content);
  const preview = useMemo(() => previewText(content), [content]);

  useEffect(() => {
    if (!active) return;

    let index = 0;
    let interval: number | undefined;
    const step = Math.max(1, Math.ceil(content.length / 180));
    const frame = window.requestAnimationFrame(() => {
      setVisibleContent("");
      interval = window.setInterval(() => {
        index = Math.min(content.length, index + step);
        setVisibleContent(content.slice(0, index));
        if (index >= content.length && interval) window.clearInterval(interval);
      }, 16);
    });

    return () => {
      window.cancelAnimationFrame(frame);
      if (interval) window.clearInterval(interval);
    };
  }, [active, content]);

  if (active) {
    return (
      <div className="animate-fade-in border-l border-[var(--border)] pl-4">
        <div className="mb-1 flex items-center gap-2 text-[11.5px] font-medium text-[var(--muted-foreground)]">
          <span>Réflexion en cours</span>
          <span className="agent-caret" />
        </div>
        <pre
          className={cn(
            "max-h-56 overflow-auto whitespace-pre-wrap rounded-lg border border-[var(--border)]",
            "bg-[var(--muted)]/25 px-3 py-2.5 font-mono text-[11.5px] leading-relaxed",
            "text-[var(--foreground)]/85",
          )}
        >
          {visibleContent}
        </pre>
      </div>
    );
  }

  return (
    <div className="animate-fade-in border-l border-[var(--border)] pl-4">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className={cn(
          "group flex w-full items-center gap-2 rounded-lg border border-[var(--border)]",
          "bg-[var(--card)] px-3 py-2 text-left transition-colors",
          "hover:bg-[var(--muted)]/35 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]",
        )}
        aria-expanded={open}
      >
        <span className="shrink-0 text-[11.5px] font-semibold text-[var(--foreground)]">
          Réflexion
        </span>
        {!open && (
          <span className="min-w-0 flex-1 truncate text-[11.5px] text-[var(--muted-foreground)]">
            {preview}
          </span>
        )}
        <ChevronRight
          className={cn(
            "ml-auto h-3.5 w-3.5 shrink-0 text-[var(--muted-foreground)] transition-transform",
            open && "rotate-90",
          )}
          strokeWidth={1.75}
        />
      </button>

      {open && (
        <pre
          className={cn(
            "mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded-lg border border-[var(--border)]",
            "bg-[var(--muted)]/25 px-3 py-2.5 font-mono text-[11.5px] leading-relaxed",
            "text-[var(--foreground)]/85",
          )}
        >
          {content}
        </pre>
      )}
    </div>
  );
}
