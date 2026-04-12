"use client";

import { useDraggable } from "@dnd-kit/core";
import { TemperatureDot } from "./temperature-badge";
import type { ProspectTemperature } from "@/lib/crm/types";

export type BoardCardData = {
  id: string;
  stage_id: string;
  title: string;
  account_name: string | null;
  amount_cents: number;
  source: string;
  open_task_count: number;
  overdue_task_count: number;
  last_activity_at: string | null;
  temperature: ProspectTemperature;
};

function formatCurrency(cents: number) {
  return (cents / 100).toLocaleString("fr-FR", { style: "currency", currency: "EUR" });
}

function relativeTime(dateStr: string | null) {
  if (!dateStr) return "No activity";
  const diff = Date.now() - new Date(dateStr).getTime();
  const days = Math.floor(diff / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 30) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString("fr-FR", { month: "short", day: "numeric" });
}

export function BoardCard({
  item,
  onClick,
}: {
  item: BoardCardData;
  onClick: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({ id: item.id });

  const style = transform
    ? {
        transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
        opacity: isDragging ? 0.7 : 1,
        zIndex: isDragging ? 50 : undefined,
      }
    : undefined;

  return (
    <button
      type="button"
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={onClick}
      className="w-full rounded-[var(--radius)] border border-border bg-card p-3 text-left transition-colors hover:border-foreground/20"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium text-foreground leading-snug">{item.title}</p>
        <TemperatureDot temperature={item.temperature} />
      </div>
      {item.account_name && (
        <p className="mt-0.5 text-[10px] text-muted-foreground truncate">{item.account_name}</p>
      )}
      <div className="mt-2 flex items-center justify-between">
        <span className="text-[11px] font-medium tabular-nums text-foreground">
          {formatCurrency(item.amount_cents)}
        </span>
        <span className="text-[10px] text-muted-foreground">{relativeTime(item.last_activity_at)}</span>
      </div>
      {(item.open_task_count > 0 || item.overdue_task_count > 0) && (
        <div className="mt-1.5 flex items-center gap-2 text-[10px]">
          <span className="text-muted-foreground">{item.open_task_count} tasks</span>
          {item.overdue_task_count > 0 && (
            <span className="font-semibold text-destructive">{item.overdue_task_count} overdue</span>
          )}
        </div>
      )}
    </button>
  );
}
