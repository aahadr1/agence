"use client";

import type { ProspectTableColumn } from "@/lib/crm/types";
import { GripVertical, X, Eye, EyeOff } from "lucide-react";
import { useState, useCallback } from "react";

export function ColumnCustomizer({
  columns,
  onChange,
  open,
  onClose,
}: {
  columns: ProspectTableColumn[];
  onChange: (cols: ProspectTableColumn[]) => void;
  open: boolean;
  onClose: () => void;
}) {
  const [dragIdx, setDragIdx] = useState<number | null>(null);

  const toggleVisibility = useCallback(
    (key: string) => {
      onChange(
        columns.map((col) =>
          col.key === key ? { ...col, visible: !col.visible } : col
        )
      );
    },
    [columns, onChange]
  );

  const handleDragStart = (idx: number) => setDragIdx(idx);

  const handleDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    if (dragIdx === null || dragIdx === idx) return;
    const reordered = [...columns];
    const [moved] = reordered.splice(dragIdx, 1);
    reordered.splice(idx, 0, moved);
    onChange(reordered);
    setDragIdx(idx);
  };

  const handleDragEnd = () => setDragIdx(null);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/30"
        onClick={onClose}
      />
      <div className="relative z-10 w-full max-w-sm rounded-[var(--radius)] border border-border bg-card p-5 shadow-xl">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-foreground">Customize columns</h3>
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="mt-1 text-[11px] text-muted-foreground">
          Drag to reorder, toggle visibility. Changes are saved automatically.
        </p>
        <div className="mt-4 max-h-80 space-y-0.5 overflow-y-auto">
          {columns.map((col, idx) => (
            <div
              key={col.key}
              draggable
              onDragStart={() => handleDragStart(idx)}
              onDragOver={(e) => handleDragOver(e, idx)}
              onDragEnd={handleDragEnd}
              className={`flex cursor-grab items-center gap-2 rounded px-2 py-1.5 text-xs transition-colors ${
                dragIdx === idx ? "bg-secondary" : "hover:bg-secondary/40"
              }`}
            >
              <GripVertical className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />
              <span className="flex-1 text-foreground">{col.label}</span>
              <button
                type="button"
                onClick={() => toggleVisibility(col.key)}
                className="text-muted-foreground hover:text-foreground"
              >
                {col.visible ? (
                  <Eye className="h-3.5 w-3.5" />
                ) : (
                  <EyeOff className="h-3.5 w-3.5 opacity-40" />
                )}
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
