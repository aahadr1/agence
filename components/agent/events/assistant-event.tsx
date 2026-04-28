"use client";

import { useState } from "react";
import { Copy, Check } from "lucide-react";
import { Markdown } from "../markdown";
import { cn } from "@/lib/utils";

interface Props {
  content: string;
  metadata?: Record<string, unknown> | null;
  last?: boolean;
}

export function AssistantEvent({ content, metadata, last }: Props) {
  const [copied, setCopied] = useState(false);
  const askOptions =
    metadata &&
    (metadata.kind === "ask_user"
      ? ((metadata.options as string[] | undefined) || [])
      : []);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      /* noop */
    }
  };

  return (
    <div
      className={cn(
        "group w-full animate-fade-in border-l border-[var(--border)] pl-4",
        last && "pb-1",
      )}
    >
      <div className="min-w-0">
        <Markdown content={content || "…"} />

        {Array.isArray(askOptions) && askOptions.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {askOptions.map((o) => (
              <span
                key={o}
                className="rounded-full border border-[var(--border)] bg-[var(--card)] px-2.5 py-0.5 text-[11px] text-[var(--muted-foreground)]"
              >
                {o}
              </span>
            ))}
          </div>
        )}

        <div className="mt-1 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          <button
            onClick={handleCopy}
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10.5px] text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)]"
            title="Copier"
          >
            {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
            {copied ? "Copié" : "Copier"}
          </button>
        </div>
      </div>
    </div>
  );
}
