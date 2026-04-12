"use client";

import type { ProspectListItem } from "@/lib/crm/types";
import { Download } from "lucide-react";

function escapeCSV(val: string) {
  if (val.includes(",") || val.includes('"') || val.includes("\n")) {
    return `"${val.replace(/"/g, '""')}"`;
  }
  return val;
}

export function ExportButton({ prospects }: { prospects: ProspectListItem[] }) {
  const handleExport = () => {
    const headers = [
      "Name",
      "Company",
      "Stage",
      "Status",
      "Amount (EUR)",
      "Probability",
      "Contact",
      "Contact Email",
      "Contact Phone",
      "Source",
      "Tags",
      "Temperature",
      "Created",
    ];

    const rows = prospects.map((p) => [
      p.title,
      p.account_name || "",
      p.stage_name,
      p.status,
      (p.amount_cents / 100).toFixed(2),
      `${p.probability}%`,
      p.contact_name || "",
      p.contact_email || "",
      p.contact_phone || "",
      p.source,
      (p.tags || []).join("; "),
      p.temperature,
      new Date(p.created_at).toLocaleDateString("fr-FR"),
    ]);

    const csv = [headers, ...rows].map((row) => row.map(escapeCSV).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `prospects-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <button
      type="button"
      onClick={handleExport}
      className="flex items-center gap-1.5 rounded-[var(--radius)] border border-border px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:border-foreground/20 hover:text-foreground"
    >
      <Download className="h-3.5 w-3.5" />
      Export
    </button>
  );
}
