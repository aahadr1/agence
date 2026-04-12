"use client";

import type { CrmStage } from "@/lib/crm/types";
import { Archive, Tag, X, ArrowRight } from "lucide-react";
import { useState, useRef, useEffect } from "react";

export function BulkActionsBar({
  count,
  stages,
  onChangeStage,
  onArchive,
  onAddTag,
  onClear,
}: {
  count: number;
  stages: CrmStage[];
  onChangeStage: (stageId: string) => void;
  onArchive: () => void;
  onAddTag: (tag: string) => void;
  onClear: () => void;
}) {
  const [stageOpen, setStageOpen] = useState(false);
  const [tagOpen, setTagOpen] = useState(false);
  const [tagInput, setTagInput] = useState("");
  const stageRef = useRef<HTMLDivElement>(null);
  const tagRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (stageRef.current && !stageRef.current.contains(e.target as Node)) setStageOpen(false);
      if (tagRef.current && !tagRef.current.contains(e.target as Node)) setTagOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  if (count === 0) return null;

  return (
    <div className="fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-[var(--radius)] border border-border bg-card px-4 py-2.5 shadow-xl">
      <span className="text-xs font-medium text-foreground">
        {count} selected
      </span>
      <div className="h-4 w-px bg-border" />

      <div ref={stageRef} className="relative">
        <button
          type="button"
          onClick={() => setStageOpen(!stageOpen)}
          className="flex items-center gap-1.5 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-secondary hover:text-foreground"
        >
          <ArrowRight className="h-3.5 w-3.5" />
          Move stage
        </button>
        {stageOpen && (
          <div className="absolute bottom-full left-0 z-50 mb-1 min-w-[160px] rounded-[var(--radius)] border border-border bg-card p-1 shadow-lg">
            {stages.map((stage) => (
              <button
                key={stage.id}
                type="button"
                onClick={() => {
                  onChangeStage(stage.id);
                  setStageOpen(false);
                }}
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-secondary/50"
              >
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: stage.color }}
                />
                {stage.name}
              </button>
            ))}
          </div>
        )}
      </div>

      <div ref={tagRef} className="relative">
        <button
          type="button"
          onClick={() => setTagOpen(!tagOpen)}
          className="flex items-center gap-1.5 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-secondary hover:text-foreground"
        >
          <Tag className="h-3.5 w-3.5" />
          Add tag
        </button>
        {tagOpen && (
          <div className="absolute bottom-full left-0 z-50 mb-1 rounded-[var(--radius)] border border-border bg-card p-2 shadow-lg">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (tagInput.trim()) {
                  onAddTag(tagInput.trim());
                  setTagInput("");
                  setTagOpen(false);
                }
              }}
            >
              <input
                type="text"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                placeholder="Tag name..."
                className="input-minimal py-1 text-xs"
                autoFocus
              />
            </form>
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={onArchive}
        className="flex items-center gap-1.5 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-secondary hover:text-foreground"
      >
        <Archive className="h-3.5 w-3.5" />
        Archive
      </button>

      <div className="h-4 w-px bg-border" />
      <button
        type="button"
        onClick={onClear}
        className="flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}
