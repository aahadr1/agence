"use client";

import { useDroppable } from "@dnd-kit/core";
import type { ReactNode } from "react";

export type BoardStage = {
  id: string;
  name: string;
  color: string;
  sort_order: number;
};

function formatCurrency(cents: number) {
  return (cents / 100).toLocaleString("fr-FR", { style: "currency", currency: "EUR" });
}

export function BoardColumn({
  stage,
  count,
  totalCents,
  children,
}: {
  stage: BoardStage;
  count: number;
  totalCents: number;
  children: ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id });

  return (
    <div
      ref={setNodeRef}
      className={`flex min-h-[500px] min-w-[280px] flex-1 flex-col rounded-[var(--radius)] border transition-colors ${
        isOver ? "border-foreground/20 bg-secondary/40" : "border-border bg-secondary/10"
      }`}
    >
      <div
        className="flex items-center justify-between rounded-t-[var(--radius)] border-b border-border px-3 py-2.5"
        style={{ borderTopWidth: 3, borderTopColor: stage.color }}
      >
        <div className="flex items-center gap-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-foreground">
            {stage.name}
          </p>
          <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-foreground/10 px-1 text-[10px] font-bold text-foreground">
            {count}
          </span>
        </div>
        <span className="text-[10px] tabular-nums text-muted-foreground">
          {formatCurrency(totalCents)}
        </span>
      </div>
      <div className="flex-1 space-y-2 p-2">{children}</div>
    </div>
  );
}
