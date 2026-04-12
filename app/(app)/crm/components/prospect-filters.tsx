"use client";

import type { CrmStage } from "@/lib/crm/types";
import { Search, X } from "lucide-react";
import { useCallback, useState, useRef, useEffect } from "react";

export type FilterState = {
  search: string;
  status: string[];
  stage_id: string[];
  source: string[];
  tag: string[];
};

const STATUS_OPTIONS = [
  { value: "open", label: "Open" },
  { value: "won", label: "Won" },
  { value: "lost", label: "Lost" },
  { value: "archived", label: "Archived" },
];

const SOURCE_OPTIONS = [
  { value: "manual", label: "Manual" },
  { value: "lead_generator", label: "Lead Generator" },
  { value: "referral", label: "Referral" },
  { value: "inbound", label: "Inbound" },
  { value: "outbound", label: "Outbound" },
];

function MultiSelect({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: string; label: string }[];
  value: string[];
  onChange: (val: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const toggle = useCallback(
    (val: string) => {
      onChange(
        value.includes(val) ? value.filter((v) => v !== val) : [...value, val]
      );
    },
    [value, onChange]
  );

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={`flex items-center gap-1.5 rounded-[var(--radius)] border px-2.5 py-1.5 text-xs transition-colors ${
          value.length > 0
            ? "border-foreground/30 bg-foreground/5 text-foreground"
            : "border-border text-muted-foreground hover:border-foreground/20"
        }`}
      >
        {label}
        {value.length > 0 && (
          <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-foreground px-1 text-[10px] font-bold text-primary-foreground">
            {value.length}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 min-w-[180px] rounded-[var(--radius)] border border-border bg-card p-1 shadow-lg">
          {options.map((opt) => (
            <label
              key={opt.value}
              className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-secondary/50"
            >
              <input
                type="checkbox"
                checked={value.includes(opt.value)}
                onChange={() => toggle(opt.value)}
                className="h-3.5 w-3.5 rounded border-border accent-foreground"
              />
              {opt.label}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

export function ProspectFilters({
  filters,
  onChange,
  stages,
}: {
  filters: FilterState;
  onChange: (filters: FilterState) => void;
  stages: CrmStage[];
}) {
  const hasFilters =
    filters.search ||
    filters.status.length > 0 ||
    filters.stage_id.length > 0 ||
    filters.source.length > 0 ||
    filters.tag.length > 0;

  const stageOptions = stages.map((s) => ({ value: s.id, label: s.name }));

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative flex-1 min-w-[200px] max-w-xs">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <input
          type="text"
          value={filters.search}
          onChange={(e) => onChange({ ...filters, search: e.target.value })}
          placeholder="Search prospects..."
          className="input-minimal py-1.5 pl-8 pr-3 text-xs"
        />
      </div>

      <MultiSelect
        label="Status"
        options={STATUS_OPTIONS}
        value={filters.status}
        onChange={(status) => onChange({ ...filters, status })}
      />
      <MultiSelect
        label="Stage"
        options={stageOptions}
        value={filters.stage_id}
        onChange={(stage_id) => onChange({ ...filters, stage_id })}
      />
      <MultiSelect
        label="Source"
        options={SOURCE_OPTIONS}
        value={filters.source}
        onChange={(source) => onChange({ ...filters, source })}
      />

      {hasFilters && (
        <button
          type="button"
          onClick={() =>
            onChange({ search: "", status: [], stage_id: [], source: [], tag: [] })
          }
          className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
        >
          <X className="h-3 w-3" />
          Clear
        </button>
      )}
    </div>
  );
}
