"use client";

import type { SavedView } from "@/lib/crm/types";
import type { FilterState } from "./prospect-filters";
import { Bookmark, Plus, Trash2, X } from "lucide-react";
import { useState, useRef, useEffect, useCallback } from "react";

const STORAGE_KEY = "crm-saved-views";

function loadViews(): SavedView[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  } catch {
    return [];
  }
}

function persistViews(views: SavedView[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(views));
}

export function useSavedViews() {
  const [views, setViews] = useState<SavedView[]>([]);

  useEffect(() => {
    setViews(loadViews());
  }, []);

  const saveView = useCallback(
    (name: string, filters: FilterState, columns: string[], sortBy: string, sortDir: "asc" | "desc") => {
      const view: SavedView = {
        id: crypto.randomUUID(),
        name,
        filters,
        columns,
        sort_by: sortBy,
        sort_dir: sortDir,
      };
      const updated = [...views, view];
      setViews(updated);
      persistViews(updated);
    },
    [views]
  );

  const deleteView = useCallback(
    (id: string) => {
      const updated = views.filter((v) => v.id !== id);
      setViews(updated);
      persistViews(updated);
    },
    [views]
  );

  return { views, saveView, deleteView };
}

export function SavedViewsPicker({
  views,
  onSelect,
  onDelete,
  onSave,
}: {
  views: SavedView[];
  onSelect: (view: SavedView) => void;
  onDelete: (id: string) => void;
  onSave: (name: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setCreating(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={`flex items-center gap-1.5 rounded-[var(--radius)] border px-2.5 py-1.5 text-xs transition-colors ${
          open
            ? "border-foreground/30 text-foreground"
            : "border-border text-muted-foreground hover:border-foreground/20"
        }`}
      >
        <Bookmark className="h-3.5 w-3.5" />
        Views
        {views.length > 0 && (
          <span className="text-[10px] text-muted-foreground">({views.length})</span>
        )}
      </button>
      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 min-w-[200px] rounded-[var(--radius)] border border-border bg-card p-1 shadow-lg">
          {views.length === 0 && !creating && (
            <p className="px-2 py-2 text-[11px] text-muted-foreground">No saved views yet.</p>
          )}
          {views.map((view) => (
            <div
              key={view.id}
              className="flex items-center gap-1 rounded px-2 py-1.5 hover:bg-secondary/50"
            >
              <button
                type="button"
                onClick={() => {
                  onSelect(view);
                  setOpen(false);
                }}
                className="flex-1 text-left text-xs text-foreground"
              >
                {view.name}
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(view.id);
                }}
                className="text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          ))}
          <div className="border-t border-border pt-1 mt-1">
            {creating ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (name.trim()) {
                    onSave(name.trim());
                    setName("");
                    setCreating(false);
                  }
                }}
                className="flex items-center gap-1 px-1"
              >
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="View name..."
                  className="input-minimal py-1 text-xs"
                  autoFocus
                />
                <button type="button" onClick={() => setCreating(false)} className="text-muted-foreground">
                  <X className="h-3 w-3" />
                </button>
              </form>
            ) : (
              <button
                type="button"
                onClick={() => setCreating(true)}
                className="flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-xs text-muted-foreground hover:bg-secondary/50 hover:text-foreground"
              >
                <Plus className="h-3 w-3" />
                Save current view
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
