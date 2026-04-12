"use client";

import type { DriveTemplate } from "@/lib/drive/types";
import { FileText, Sparkles, X } from "lucide-react";

export function DriveTemplatePicker({
  open,
  templates,
  onClose,
  onSelect,
}: {
  open: boolean;
  templates: DriveTemplate[];
  onClose: () => void;
  onSelect: (templateId: string) => void;
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[85vh] w-full max-w-5xl overflow-hidden rounded-[calc(var(--radius)+0.5rem)] border border-border bg-background shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <div>
            <p className="label-eyebrow">Templates</p>
            <h2 className="mt-1 text-xl font-medium text-foreground">
              Start with a strong structure
            </h2>
          </div>
          <button
            type="button"
            className="rounded-xl border border-border p-2 text-muted-foreground hover:bg-muted hover:text-foreground"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="grid gap-4 overflow-y-auto p-6 md:grid-cols-2 xl:grid-cols-3">
          {templates.map((template) => (
            <button
              key={template.id}
              type="button"
              className="group rounded-3xl border border-border bg-card p-5 text-left transition hover:-translate-y-0.5 hover:border-blue hover:shadow-lg"
              onClick={() => onSelect(template.id)}
            >
              <div className="inline-flex rounded-2xl bg-blue-subtle p-3 text-foreground">
                {template.kind === "built_in" ? (
                  <FileText className="h-5 w-5" />
                ) : (
                  <Sparkles className="h-5 w-5" />
                )}
              </div>
              <p className="mt-4 text-base font-medium text-foreground">{template.name}</p>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                {template.description}
              </p>
              <p className="mt-4 text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground group-hover:text-foreground">
                Use template
              </p>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
