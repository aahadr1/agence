"use client";

import { useEffect, useState } from "react";
import { BookOpen, Lightbulb, X } from "lucide-react";
import type { GuideSection } from "@/components/help/product-guide";

const STORAGE_KEY = "lahaut-crm-quickstart-v1";

type Props = {
  onOpenGuide: (section?: GuideSection) => void;
};

export function CrmQuickStart({ onOpenGuide }: Props) {
  const [visible, setVisible] = useState<boolean | null>(null);

  useEffect(() => {
    const id = requestAnimationFrame(() => {
      try {
        setVisible(localStorage.getItem(STORAGE_KEY) !== "1");
      } catch {
        setVisible(true);
      }
    });
    return () => cancelAnimationFrame(id);
  }, []);

  const dismiss = () => {
    try {
      localStorage.setItem(STORAGE_KEY, "1");
    } catch {
      /* ignore */
    }
    setVisible(false);
  };

  if (visible !== true) return null;

  return (
    <div className="mb-6 rounded-[var(--radius)] border border-border bg-card p-4 shadow-sm sm:p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex gap-3 min-w-0">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius)] bg-muted text-foreground">
            <Lightbulb className="h-5 w-5" strokeWidth={1.5} />
          </div>
          <div className="min-w-0">
            <h2 className="font-display text-lg font-medium tracking-tight text-display-title">
              Get started with CRM
            </h2>
            <ul className="mt-2 space-y-1.5 text-sm text-muted-foreground">
              <li>
                <span className="text-foreground/80">Table</span> — filter, sort, save views, export.
              </li>
              <li>
                <span className="text-foreground/80">Board</span> — drag deals across stages.
              </li>
              <li>
                <span className="text-foreground/80">Row menu</span> — open a prospect for notes, tasks, and history.
              </li>
            </ul>
            <button
              type="button"
              onClick={() => onOpenGuide("crm")}
              className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-foreground underline-offset-4 hover:underline"
            >
              <BookOpen className="h-3.5 w-3.5" strokeWidth={1.5} />
              Open full CRM guide
            </button>
          </div>
        </div>
        <button
          type="button"
          onClick={dismiss}
          className="self-end rounded-[var(--radius)] p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground sm:self-start"
          aria-label="Dismiss"
        >
          <X className="h-4 w-4" strokeWidth={1.5} />
        </button>
      </div>
    </div>
  );
}
