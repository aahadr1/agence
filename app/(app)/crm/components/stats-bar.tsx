"use client";

import type { ProspectListItem } from "@/lib/crm/types";

function formatCurrency(cents: number) {
  return (cents / 100).toLocaleString("fr-FR", { style: "currency", currency: "EUR" });
}

export function StatsBar({ prospects, total }: { prospects: ProspectListItem[]; total: number }) {
  const open = prospects.filter((p) => p.status === "open");
  const pipelineValue = open.reduce((sum, p) => sum + p.amount_cents, 0);
  const weightedValue = open.reduce((sum, p) => sum + (p.amount_cents * p.probability) / 100, 0);

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const wonThisMonth = prospects.filter(
    (p) => p.status === "won" && new Date(p.updated_at) >= monthStart
  );
  const wonValue = wonThisMonth.reduce((sum, p) => sum + p.amount_cents, 0);

  const closed = prospects.filter((p) => p.status === "won" || p.status === "lost");
  const conversionRate = closed.length > 0
    ? Math.round((prospects.filter((p) => p.status === "won").length / closed.length) * 100)
    : 0;

  const overdueTasks = prospects.reduce((sum, p) => sum + p.overdue_task_count, 0);

  const stats = [
    { label: "Total prospects", value: total.toString() },
    { label: "Pipeline", value: formatCurrency(pipelineValue) },
    { label: "Weighted", value: formatCurrency(weightedValue) },
    { label: "Won this month", value: `${wonThisMonth.length} (${formatCurrency(wonValue)})` },
    { label: "Conversion", value: `${conversionRate}%` },
    {
      label: "Overdue tasks",
      value: overdueTasks.toString(),
      alert: overdueTasks > 0,
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {stats.map((stat) => (
        <div
          key={stat.label}
          className="rounded-[var(--radius)] border border-border bg-card px-3 py-2.5"
        >
          <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            {stat.label}
          </p>
          <p
            className={`mt-0.5 text-sm font-semibold ${
              "alert" in stat && stat.alert ? "text-destructive" : "text-foreground"
            }`}
          >
            {stat.value}
          </p>
        </div>
      ))}
    </div>
  );
}
