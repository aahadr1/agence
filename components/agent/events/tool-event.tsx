"use client";

import { useState } from "react";
import { Wrench, ChevronRight, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  content: string;
  tool?: string;
  status?: string;
}

export function ToolEvent({ content, tool, status }: Props) {
  const [open, setOpen] = useState(false);
  const isError = status === "error";

  return (
    <div className="ml-10 animate-fade-in">
      <button
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-md",
          "border border-[var(--border)] bg-transparent",
          "px-2 py-0.5 font-mono text-[11px]",
          isError
            ? "text-red-600 border-red-500/30"
            : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]",
        )}
      >
        {isError ? (
          <AlertTriangle className="h-3 w-3" />
        ) : (
          <Wrench className="h-3 w-3" />
        )}
        <span>{tool || "tool"}</span>
        {status && status !== "ok" && (
          <span className="rounded bg-[var(--muted)] px-1 py-0 text-[9.5px] uppercase">
            {status}
          </span>
        )}
        <ChevronRight
          className={cn(
            "h-3 w-3 transition-transform",
            open && "rotate-90",
          )}
        />
      </button>
      {open && (
        <pre
          className={cn(
            "ml-2 mt-1 max-h-64 overflow-auto whitespace-pre-wrap rounded-md border border-[var(--border)]",
            "bg-[var(--muted)]/40 px-3 py-2 font-mono text-[11px] leading-relaxed text-[var(--foreground)]/80",
          )}
        >
          {content}
        </pre>
      )}
    </div>
  );
}
