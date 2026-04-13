"use client";

import type { CrmOpportunityStatus } from "@/lib/crm/types";

const STATUS_CONFIG: Record<CrmOpportunityStatus, { label: string; className: string }> = {
  open: { label: "Open", className: "bg-zinc-500/10 text-zinc-800 dark:text-zinc-300" },
  won: { label: "Won", className: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300" },
  lost: { label: "Lost", className: "bg-red-500/10 text-red-700 dark:text-red-300" },
  archived: { label: "Archived", className: "bg-muted text-muted-foreground" },
};

export function StatusBadge({ status }: { status: CrmOpportunityStatus }) {
  const config = STATUS_CONFIG[status] || STATUS_CONFIG.open;
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${config.className}`}
    >
      {config.label}
    </span>
  );
}

export function StageBadge({ name, color }: { name: string; color: string }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium"
      style={{ backgroundColor: `${color}18`, color }}
    >
      <span
        className="h-1.5 w-1.5 rounded-full"
        style={{ backgroundColor: color }}
      />
      {name}
    </span>
  );
}
