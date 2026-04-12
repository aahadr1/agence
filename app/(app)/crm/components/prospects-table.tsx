"use client";

import type { ProspectListItem, ProspectTableColumn, CrmStage } from "@/lib/crm/types";
import { StageBadge, StatusBadge } from "./status-badge";
import { TemperatureBadge } from "./temperature-badge";
import { ProspectRowActions, type RowAction } from "./prospect-row-actions";
import { EmptyState } from "./empty-state";
import { ArrowUpDown, ArrowUp, ArrowDown, ChevronLeft, ChevronRight } from "lucide-react";
import { useRouter } from "next/navigation";

function formatCurrency(cents: number) {
  return (cents / 100).toLocaleString("fr-FR", { style: "currency", currency: "EUR" });
}

function formatRelativeTime(dateStr: string | null) {
  if (!dateStr) return "-";
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString("fr-FR");
}

function CellContent({
  colKey,
  prospect,
}: {
  colKey: string;
  prospect: ProspectListItem;
}) {
  switch (colKey) {
    case "title":
      return (
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-foreground">{prospect.title}</p>
          {prospect.description && (
            <p className="truncate text-[11px] text-muted-foreground">{prospect.description}</p>
          )}
        </div>
      );
    case "account_name":
      return <span className="text-xs text-foreground">{prospect.account_name || "-"}</span>;
    case "stage_name":
      return <StageBadge name={prospect.stage_name} color={prospect.stage_color} />;
    case "status":
      return <StatusBadge status={prospect.status} />;
    case "amount_cents":
      return <span className="text-xs tabular-nums text-foreground">{formatCurrency(prospect.amount_cents)}</span>;
    case "probability":
      return (
        <div className="flex items-center gap-1.5">
          <div className="h-1 w-10 overflow-hidden rounded-full bg-secondary">
            <div
              className="h-full rounded-full bg-foreground/40"
              style={{ width: `${prospect.probability}%` }}
            />
          </div>
          <span className="text-[11px] tabular-nums text-muted-foreground">{prospect.probability}%</span>
        </div>
      );
    case "temperature":
      return <TemperatureBadge temperature={prospect.temperature} />;
    case "contact_name":
      return (
        <div className="min-w-0">
          <p className="truncate text-xs text-foreground">{prospect.contact_name || "-"}</p>
          {prospect.contact_role && (
            <p className="truncate text-[10px] text-muted-foreground">{prospect.contact_role}</p>
          )}
        </div>
      );
    case "contact_email":
      return prospect.contact_email ? (
        <a href={`mailto:${prospect.contact_email}`} className="truncate text-xs text-blue hover:underline">{prospect.contact_email}</a>
      ) : <span className="text-xs text-muted-foreground">-</span>;
    case "contact_phone":
      return prospect.contact_phone ? (
        <a href={`tel:${prospect.contact_phone}`} className="text-xs text-foreground">{prospect.contact_phone}</a>
      ) : <span className="text-xs text-muted-foreground">-</span>;
    case "contact_role":
      return <span className="text-xs text-foreground">{prospect.contact_role || "-"}</span>;
    case "account_email":
      return prospect.account_email ? (
        <a href={`mailto:${prospect.account_email}`} className="truncate text-xs text-blue hover:underline">{prospect.account_email}</a>
      ) : <span className="text-xs text-muted-foreground">-</span>;
    case "account_phone":
      return prospect.account_phone ? (
        <a href={`tel:${prospect.account_phone}`} className="text-xs text-foreground">{prospect.account_phone}</a>
      ) : <span className="text-xs text-muted-foreground">-</span>;
    case "account_website":
      return prospect.account_website ? (
        <a href={prospect.account_website} target="_blank" rel="noopener noreferrer" className="truncate text-xs text-blue hover:underline">
          {prospect.account_website.replace(/^https?:\/\//, "")}
        </a>
      ) : <span className="text-xs text-muted-foreground">-</span>;
    case "source":
      return <span className="text-xs capitalize text-muted-foreground">{prospect.source.replace("_", " ")}</span>;
    case "tags":
      return prospect.tags.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {prospect.tags.map((tag) => (
            <span key={tag} className="rounded-full bg-secondary px-1.5 py-0.5 text-[10px] text-foreground">{tag}</span>
          ))}
        </div>
      ) : <span className="text-xs text-muted-foreground">-</span>;
    case "expected_close_date":
      return prospect.expected_close_date ? (
        <span className="text-xs tabular-nums text-foreground">
          {new Date(prospect.expected_close_date).toLocaleDateString("fr-FR")}
        </span>
      ) : <span className="text-xs text-muted-foreground">-</span>;
    case "last_activity_at":
      return <span className="text-xs text-muted-foreground">{formatRelativeTime(prospect.last_activity_at)}</span>;
    case "open_task_count":
      return (
        <div className="flex items-center gap-1">
          <span className="text-xs tabular-nums text-foreground">{prospect.open_task_count}</span>
          {prospect.overdue_task_count > 0 && (
            <span className="text-[10px] font-semibold text-destructive">({prospect.overdue_task_count} late)</span>
          )}
        </div>
      );
    case "created_at":
      return <span className="text-xs tabular-nums text-muted-foreground">{new Date(prospect.created_at).toLocaleDateString("fr-FR")}</span>;
    default:
      return <span className="text-xs text-muted-foreground">-</span>;
  }
}

export function ProspectsTable({
  prospects,
  columns,
  total,
  page,
  perPage,
  sortBy,
  sortDir,
  selectedIds,
  stages,
  onSort,
  onPageChange,
  onPerPageChange,
  onSelect,
  onSelectAll,
  onRowAction,
}: {
  prospects: ProspectListItem[];
  columns: ProspectTableColumn[];
  total: number;
  page: number;
  perPage: number;
  sortBy: string;
  sortDir: "asc" | "desc";
  selectedIds: Set<string>;
  stages: CrmStage[];
  onSort: (key: string) => void;
  onPageChange: (page: number) => void;
  onPerPageChange: (perPage: number) => void;
  onSelect: (id: string) => void;
  onSelectAll: () => void;
  onRowAction: (id: string, action: RowAction) => void;
}) {
  const router = useRouter();
  const visibleCols = columns.filter((c) => c.visible);
  const totalPages = Math.ceil(total / perPage);
  const allSelected = prospects.length > 0 && prospects.every((p) => selectedIds.has(p.id));

  if (prospects.length === 0 && total === 0) {
    return <EmptyState variant="no-prospects" />;
  }
  if (prospects.length === 0) {
    return <EmptyState variant="no-results" />;
  }

  return (
    <div>
      {/* Desktop table */}
      <div className="hidden overflow-x-auto lg:block">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border">
              <th className="w-10 py-2 pl-3 pr-1">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={onSelectAll}
                  className="h-3.5 w-3.5 accent-foreground"
                />
              </th>
              {visibleCols.map((col) => (
                <th
                  key={col.key}
                  className="px-3 py-2 text-left text-[11px] font-medium uppercase tracking-wider text-muted-foreground"
                >
                  {col.sortable ? (
                    <button
                      type="button"
                      onClick={() => onSort(col.key)}
                      className="flex items-center gap-1 hover:text-foreground"
                    >
                      {col.label}
                      {sortBy === col.key ? (
                        sortDir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
                      ) : (
                        <ArrowUpDown className="h-3 w-3 opacity-30" />
                      )}
                    </button>
                  ) : (
                    col.label
                  )}
                </th>
              ))}
              <th className="w-10 px-2 py-2" />
            </tr>
          </thead>
          <tbody>
            {prospects.map((prospect) => (
              <tr
                key={prospect.id}
                onClick={() => router.push(`/crm/${prospect.id}`)}
                className={`cursor-pointer border-b border-border transition-colors hover:bg-secondary/30 ${
                  selectedIds.has(prospect.id) ? "bg-blue-subtle" : ""
                }`}
              >
                <td className="py-2.5 pl-3 pr-1">
                  <input
                    type="checkbox"
                    checked={selectedIds.has(prospect.id)}
                    onChange={(e) => {
                      e.stopPropagation();
                      onSelect(prospect.id);
                    }}
                    onClick={(e) => e.stopPropagation()}
                    className="h-3.5 w-3.5 accent-foreground"
                  />
                </td>
                {visibleCols.map((col) => (
                  <td key={col.key} className="max-w-[200px] px-3 py-2.5">
                    <CellContent colKey={col.key} prospect={prospect} />
                  </td>
                ))}
                <td className="px-2 py-2.5">
                  <ProspectRowActions
                    onAction={(action) => onRowAction(prospect.id, action)}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <div className="space-y-2 lg:hidden">
        {prospects.map((prospect) => (
          <div
            key={prospect.id}
            onClick={() => router.push(`/crm/${prospect.id}`)}
            className={`cursor-pointer rounded-[var(--radius)] border border-border p-3 transition-colors hover:bg-secondary/30 ${
              selectedIds.has(prospect.id) ? "bg-blue-subtle" : "bg-card"
            }`}
          >
            <div className="flex items-start justify-between">
              <div className="flex items-start gap-2 min-w-0">
                <input
                  type="checkbox"
                  checked={selectedIds.has(prospect.id)}
                  onChange={(e) => {
                    e.stopPropagation();
                    onSelect(prospect.id);
                  }}
                  onClick={(e) => e.stopPropagation()}
                  className="mt-1 h-3.5 w-3.5 accent-foreground"
                />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">{prospect.title}</p>
                  <p className="text-xs text-muted-foreground">{prospect.account_name || "No company"}</p>
                </div>
              </div>
              <ProspectRowActions onAction={(action) => onRowAction(prospect.id, action)} />
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <StageBadge name={prospect.stage_name} color={prospect.stage_color} />
              <TemperatureBadge temperature={prospect.temperature} />
              <span className="text-xs tabular-nums text-foreground">{formatCurrency(prospect.amount_cents)}</span>
            </div>
            {prospect.contact_name && (
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                {prospect.contact_name}{prospect.contact_role ? ` - ${prospect.contact_role}` : ""}
              </p>
            )}
          </div>
        ))}
      </div>

      {/* Pagination */}
      <div className="mt-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Rows per page:</span>
          <select
            value={perPage}
            onChange={(e) => onPerPageChange(Number(e.target.value))}
            className="rounded border border-border bg-card px-1.5 py-0.5 text-xs text-foreground"
          >
            <option value={25}>25</option>
            <option value={50}>50</option>
            <option value={100}>100</option>
          </select>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {(page - 1) * perPage + 1}-{Math.min(page * perPage, total)} of {total}
          </span>
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => onPageChange(page - 1)}
            className="rounded p-1 text-muted-foreground hover:bg-secondary disabled:opacity-30"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            disabled={page >= totalPages}
            onClick={() => onPageChange(page + 1)}
            className="rounded p-1 text-muted-foreground hover:bg-secondary disabled:opacity-30"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
