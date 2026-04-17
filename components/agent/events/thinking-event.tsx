"use client";

import { useState } from "react";
import { Brain, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export function ThinkingEvent({ content }: { content: string }) {
  const [open, setOpen] = useState(false);
  const preview =
    content.length > 120 ? content.slice(0, 117).trim() + "…" : content;

  return (
    <div className="ml-10 animate-fade-in">
      <button
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "group flex w-full items-start gap-2 rounded-md",
          "px-2 py-1 text-left text-[11.5px] text-[var(--muted-foreground)]",
          "hover:bg-[var(--muted)]/40",
        )}
      >
        <Brain
          className="mt-0.5 h-3.5 w-3.5 shrink-0 opacity-70"
          strokeWidth={1.75}
        />
        <span className="line-clamp-1 flex-1 italic">{preview}</span>
        <ChevronRight
          className={cn(
            "mt-0.5 h-3 w-3 shrink-0 transition-transform",
            open && "rotate-90",
          )}
        />
      </button>
      {open && (
        <pre
          className={cn(
            "ml-5 mt-1 whitespace-pre-wrap rounded-md border border-dashed border-[var(--border)]",
            "bg-transparent px-3 py-2 font-mono text-[11px] leading-relaxed text-[var(--muted-foreground)]",
          )}
        >
          {content}
        </pre>
      )}
    </div>
  );
}
