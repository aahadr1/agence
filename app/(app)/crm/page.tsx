"use client";

import { useCallback, useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import type { ProspectListItem, ProspectTableColumn, CrmStage, SavedView } from "@/lib/crm/types";
import type { RowAction } from "./components/prospect-row-actions";
import type { FilterState } from "./components/prospect-filters";
import { ProspectsTable } from "./components/prospects-table";
import { ProspectFilters } from "./components/prospect-filters";
import { StatsBar } from "./components/stats-bar";
import { BulkActionsBar } from "./components/bulk-actions-bar";
import { ColumnCustomizer } from "./components/column-customizer";
import { AddProspectModal } from "./components/add-prospect-modal";
import { ExportButton } from "./components/export-button";
import { SavedViewsPicker, useSavedViews } from "./components/saved-views";
import { loadColumns, saveColumns } from "./components/prospect-columns";
import { Plus, Settings2, KanbanSquare } from "lucide-react";
import Link from "next/link";

export default function CrmPage() {
  const router = useRouter();
  const [prospects, setProspects] = useState<ProspectListItem[]>([]);
  const [stages, setStages] = useState<CrmStage[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(25);
  const [sortBy, setSortBy] = useState("created_at");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [filters, setFilters] = useState<FilterState>({
    search: "",
    status: [],
    stage_id: [],
    source: [],
    tag: [],
  });
  const [columns, setColumns] = useState<ProspectTableColumn[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [colCustomizerOpen, setColCustomizerOpen] = useState(false);
  const [addModalOpen, setAddModalOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const { views, saveView, deleteView } = useSavedViews();

  useEffect(() => {
    setColumns(loadColumns());
  }, []);

  const fetchProspects = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set("page", String(page));
      params.set("per_page", String(perPage));
      params.set("sort_by", sortBy);
      params.set("sort_dir", sortDir);
      if (filters.search) params.set("search", filters.search);
      filters.status.forEach((s) => params.append("status", s));
      filters.stage_id.forEach((s) => params.append("stage_id", s));
      filters.source.forEach((s) => params.append("source", s));
      filters.tag.forEach((t) => params.append("tag", t));

      const res = await fetch(`/api/crm/v2/prospects?${params}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load prospects");

      setProspects(data.prospects || []);
      setTotal(data.total || 0);
      if (data.stages) setStages(data.stages);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load prospects");
    } finally {
      setLoading(false);
    }
  }, [page, perPage, sortBy, sortDir, filters]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(fetchProspects, 200);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [fetchProspects]);

  const handleSort = (key: string) => {
    if (sortBy === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(key);
      setSortDir("desc");
    }
    setPage(1);
  };

  const handleColumnsChange = (cols: ProspectTableColumn[]) => {
    setColumns(cols);
    saveColumns(cols);
  };

  const handleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSelectAll = () => {
    if (prospects.every((p) => selectedIds.has(p.id))) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(prospects.map((p) => p.id)));
    }
  };

  const handleBulkStageChange = async (stageId: string) => {
    await fetch("/api/crm/v2/prospects/bulk", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: [...selectedIds], stage_id: stageId }),
    });
    setSelectedIds(new Set());
    fetchProspects();
  };

  const handleBulkArchive = async () => {
    await fetch("/api/crm/v2/prospects/bulk", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: [...selectedIds], status: "archived" }),
    });
    setSelectedIds(new Set());
    fetchProspects();
  };

  const handleBulkAddTag = async (tag: string) => {
    await fetch("/api/crm/v2/prospects/bulk", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: [...selectedIds], add_tag: tag }),
    });
    setSelectedIds(new Set());
    fetchProspects();
  };

  const handleRowAction = async (id: string, action: RowAction) => {
    switch (action) {
      case "view":
        router.push(`/crm/${id}`);
        break;
      case "mark-won":
        await fetch(`/api/crm/v2/opportunities/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "won" }),
        });
        fetchProspects();
        break;
      case "mark-lost":
        await fetch(`/api/crm/v2/opportunities/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "lost" }),
        });
        fetchProspects();
        break;
      case "archive":
        await fetch(`/api/crm/v2/opportunities/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "archived" }),
        });
        fetchProspects();
        break;
      case "add-note":
      case "add-task":
      case "schedule-meeting":
      case "edit":
        router.push(`/crm/${id}`);
        break;
      case "delete":
        await fetch(`/api/crm/v2/opportunities/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "archived" }),
        });
        fetchProspects();
        break;
    }
  };

  const handleSelectView = (view: SavedView) => {
    const f = view.filters as FilterState;
    if (f) setFilters(f);
    if (view.sort_by) setSortBy(view.sort_by);
    if (view.sort_dir) setSortDir(view.sort_dir);
    setPage(1);
  };

  const handleSaveView = (name: string) => {
    saveView(
      name,
      filters,
      columns.filter((c) => c.visible).map((c) => c.key),
      sortBy,
      sortDir
    );
  };

  return (
    <div className="animate-fade-in">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="label-eyebrow">CRM</p>
          <h1 className="mt-1 text-xl font-semibold text-foreground sm:text-2xl">Prospects</h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Track your pipeline, manage follow-ups, and close deals.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/crm/board"
            className="flex items-center gap-1.5 rounded-[var(--radius)] border border-border px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:border-foreground/20 hover:text-foreground"
          >
            <KanbanSquare className="h-3.5 w-3.5" />
            Board
          </Link>
          <button
            type="button"
            onClick={() => setAddModalOpen(true)}
            className="btn-solid flex items-center gap-1.5 text-xs"
          >
            <Plus className="h-3.5 w-3.5" />
            New prospect
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="mt-6">
        <StatsBar prospects={prospects} total={total} />
      </div>

      {/* Toolbar */}
      <div className="mt-5 flex flex-wrap items-center gap-2">
        <div className="flex-1 min-w-0">
          <ProspectFilters filters={filters} onChange={(f) => { setFilters(f); setPage(1); }} stages={stages} />
        </div>
        <div className="flex items-center gap-2">
          <SavedViewsPicker
            views={views}
            onSelect={handleSelectView}
            onDelete={deleteView}
            onSave={handleSaveView}
          />
          <ExportButton prospects={prospects} />
          <button
            type="button"
            onClick={() => setColCustomizerOpen(true)}
            className="flex items-center gap-1.5 rounded-[var(--radius)] border border-border px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:border-foreground/20 hover:text-foreground"
          >
            <Settings2 className="h-3.5 w-3.5" />
            Columns
          </button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="mt-4 rounded-[var(--radius)] border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Table */}
      <div className={`mt-4 ${loading ? "opacity-60" : ""}`}>
        <ProspectsTable
          prospects={prospects}
          columns={columns}
          total={total}
          page={page}
          perPage={perPage}
          sortBy={sortBy}
          sortDir={sortDir}
          selectedIds={selectedIds}
          stages={stages}
          onSort={handleSort}
          onPageChange={setPage}
          onPerPageChange={(pp) => { setPerPage(pp); setPage(1); }}
          onSelect={handleSelect}
          onSelectAll={handleSelectAll}
          onRowAction={handleRowAction}
        />
      </div>

      {/* Bulk actions */}
      <BulkActionsBar
        count={selectedIds.size}
        stages={stages}
        onChangeStage={handleBulkStageChange}
        onArchive={handleBulkArchive}
        onAddTag={handleBulkAddTag}
        onClear={() => setSelectedIds(new Set())}
      />

      {/* Modals */}
      <ColumnCustomizer
        columns={columns}
        onChange={handleColumnsChange}
        open={colCustomizerOpen}
        onClose={() => setColCustomizerOpen(false)}
      />
      <AddProspectModal
        open={addModalOpen}
        onClose={() => setAddModalOpen(false)}
        onCreated={fetchProspects}
        stages={stages}
      />
    </div>
  );
}
