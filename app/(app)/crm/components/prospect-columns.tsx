import type { ProspectTableColumn } from "@/lib/crm/types";

const STORAGE_KEY = "crm-table-columns";

export const DEFAULT_COLUMNS: ProspectTableColumn[] = [
  { key: "title", label: "Prospect", visible: true, sortable: true },
  { key: "account_name", label: "Company", visible: true, sortable: false },
  { key: "stage_name", label: "Stage", visible: true, sortable: false },
  { key: "status", label: "Status", visible: true, sortable: true },
  { key: "amount_cents", label: "Amount", visible: true, sortable: true },
  { key: "probability", label: "Probability", visible: true, sortable: true },
  { key: "temperature", label: "Temp.", visible: true, sortable: false },
  { key: "contact_name", label: "Contact", visible: true, sortable: false },
  { key: "contact_email", label: "Contact email", visible: false, sortable: false },
  { key: "contact_phone", label: "Contact phone", visible: false, sortable: false },
  { key: "contact_role", label: "Role", visible: false, sortable: false },
  { key: "account_email", label: "Company email", visible: false, sortable: false },
  { key: "account_phone", label: "Company phone", visible: false, sortable: false },
  { key: "account_website", label: "Website", visible: false, sortable: false },
  { key: "source", label: "Source", visible: true, sortable: false },
  { key: "tags", label: "Tags", visible: true, sortable: false },
  { key: "expected_close_date", label: "Close date", visible: true, sortable: true },
  { key: "last_activity_at", label: "Last activity", visible: true, sortable: false },
  { key: "open_task_count", label: "Tasks", visible: true, sortable: false },
  { key: "created_at", label: "Created", visible: false, sortable: true },
];

export function loadColumns(): ProspectTableColumn[] {
  if (typeof window === "undefined") return DEFAULT_COLUMNS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_COLUMNS;
    const saved: ProspectTableColumn[] = JSON.parse(raw);
    const savedMap = new Map(saved.map((c) => [c.key, c]));
    return DEFAULT_COLUMNS.map((def) => {
      const s = savedMap.get(def.key);
      return s ? { ...def, visible: s.visible } : def;
    }).sort((a, b) => {
      const ai = saved.findIndex((s) => s.key === a.key);
      const bi = saved.findIndex((s) => s.key === b.key);
      if (ai === -1 && bi === -1) return 0;
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    });
  } catch {
    return DEFAULT_COLUMNS;
  }
}

export function saveColumns(columns: ProspectTableColumn[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(columns));
}
