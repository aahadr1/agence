import crypto from "crypto";
import { getAgentDb } from "./tools/_db";

export const WORKSET_MEMORY_KEY = "workset:default";

export type WorksetStatus =
  | "new"
  | "active"
  | "contact_found"
  | "legal_found"
  | "ready"
  | "saved"
  | "blocked"
  | "discarded"
  | (string & {});

export interface WorksetAttempt {
  tool?: string | null;
  outcome?: string | null;
  summary?: string | null;
  retryable?: boolean | null;
  at: string;
}

export interface WorksetItem {
  id: string;
  title: string;
  status: WorksetStatus;
  facts: Record<string, unknown>;
  missing: string[];
  next_action: string | null;
  sources: string[];
  attempts: WorksetAttempt[];
  blockers: string[];
  confidence_score: number | null;
  priority: number | null;
  created_at: string;
  updated_at: string;
}

export interface WorksetState {
  version: 1;
  goal: string | null;
  target_count: number | null;
  items: WorksetItem[];
  notes: string[];
  updated_at: string;
}

export interface WorksetUpsertOptions {
  mode?: "merge" | "replace";
  source?: string | null;
  goal?: string | null;
  target_count?: number | null;
}

export interface RawWorksetItem {
  id?: unknown;
  item_id?: unknown;
  title?: unknown;
  name?: unknown;
  business_name?: unknown;
  status?: unknown;
  facts?: unknown;
  missing?: unknown;
  next_action?: unknown;
  sources?: unknown;
  confidence_score?: unknown;
  priority?: unknown;
  [key: string]: unknown;
}

function nowIso(): string {
  return new Date().toISOString();
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function compactString(value: unknown, max = 500): string | null {
  const s = String(value ?? "").replace(/\s+/g, " ").trim();
  return s ? s.slice(0, max) : null;
}

function stringArray(value: unknown, maxItems = 20): string[] {
  const arr = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(",")
      : [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const x of arr) {
    const s = compactString(x, 180);
    if (!s) continue;
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
    if (out.length >= maxItems) break;
  }
  return out;
}

function numberOrNull(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function stableHash(input: string): string {
  return crypto.createHash("sha1").update(input).digest("hex").slice(0, 16);
}

function canonicalTitle(raw: RawWorksetItem): string | null {
  return (
    compactString(raw.title) ||
    compactString(raw.business_name) ||
    compactString(raw.name)
  );
}

function canonicalId(raw: RawWorksetItem, title: string): string {
  const explicit = compactString(raw.id) || compactString(raw.item_id);
  if (explicit) return explicit.slice(0, 120);
  const facts = asRecord(raw.facts);
  const key = [
    title,
    raw.google_maps_url,
    facts.google_maps_url,
    raw.website_url,
    facts.website_url,
    raw.address,
    facts.address,
    raw.phone,
    facts.phone,
  ]
    .filter(Boolean)
    .join("|");
  return `item_${stableHash(key || title)}`;
}

function itemFacts(raw: RawWorksetItem): Record<string, unknown> {
  const facts = { ...asRecord(raw.facts) };
  for (const [key, value] of Object.entries(raw)) {
    if (
      [
        "id",
        "item_id",
        "title",
        "name",
        "business_name",
        "status",
        "facts",
        "missing",
        "next_action",
        "sources",
        "confidence_score",
        "priority",
      ].includes(key)
    ) {
      continue;
    }
    if (value !== undefined && value !== null && value !== "") facts[key] = value;
  }
  return facts;
}

function normalizeState(raw: unknown): WorksetState {
  const obj = asRecord(raw);
  const items = Array.isArray(obj.items) ? obj.items : [];
  const now = nowIso();
  return {
    version: 1,
    goal: compactString(obj.goal, 1000),
    target_count: numberOrNull(obj.target_count),
    notes: stringArray(obj.notes, 50),
    updated_at: compactString(obj.updated_at) || now,
    items: items
      .map((it) => {
        const r = asRecord(it) as RawWorksetItem;
        const title = canonicalTitle(r);
        if (!title) return null;
        const id = canonicalId(r, title);
        return {
          id,
          title,
          status: (compactString(r.status, 80) || "new") as WorksetStatus,
          facts: asRecord(r.facts),
          missing: stringArray(r.missing),
          next_action: compactString(r.next_action, 1000),
          sources: stringArray(r.sources),
          attempts: Array.isArray(r.attempts)
            ? r.attempts.slice(-20).map((a) => {
                const ar = asRecord(a);
                return {
                  tool: compactString(ar.tool, 120),
                  outcome: compactString(ar.outcome, 120),
                  summary: compactString(ar.summary, 1000),
                  retryable:
                    typeof ar.retryable === "boolean" ? ar.retryable : null,
                  at: compactString(ar.at) || now,
                };
              })
            : [],
          blockers: stringArray(r.blockers),
          confidence_score: numberOrNull(r.confidence_score),
          priority: numberOrNull(r.priority),
          created_at: compactString(r.created_at) || now,
          updated_at: compactString(r.updated_at) || now,
        } satisfies WorksetItem;
      })
      .filter(Boolean) as WorksetItem[],
  };
}

export async function readWorksetState(
  sessionId: string,
): Promise<WorksetState> {
  const db = getAgentDb();
  const { data } = await db
    .from("agent_memory")
    .select("value")
    .eq("session_id", sessionId)
    .eq("key", WORKSET_MEMORY_KEY)
    .maybeSingle();
  return normalizeState(data?.value);
}

export async function writeWorksetState(
  sessionId: string,
  state: WorksetState,
): Promise<WorksetState> {
  const db = getAgentDb();
  const clean = normalizeState({ ...state, updated_at: nowIso() });
  const { error } = await db.from("agent_memory").upsert(
    {
      session_id: sessionId,
      key: WORKSET_MEMORY_KEY,
      value: clean,
      updated_at: clean.updated_at,
    },
    { onConflict: "session_id,key" },
  );
  if (error) throw new Error(`workset write failed: ${error.message}`);
  return clean;
}

export async function upsertWorksetItems(
  sessionId: string,
  rawItems: RawWorksetItem[],
  opts: WorksetUpsertOptions = {},
): Promise<WorksetState> {
  const prev =
    opts.mode === "replace"
      ? normalizeState({})
      : await readWorksetState(sessionId);
  const byId = new Map(prev.items.map((item) => [item.id, item]));
  const byTitle = new Map(
    prev.items.map((item) => [item.title.toLowerCase(), item]),
  );
  const ts = nowIso();

  for (const raw of rawItems) {
    const title = canonicalTitle(raw);
    if (!title) continue;
    const id = canonicalId(raw, title);
    const existing = byId.get(id) || byTitle.get(title.toLowerCase()) || null;
    const facts = itemFacts(raw);
    const sources = [
      ...(existing?.sources || []),
      ...stringArray(raw.sources),
      ...(opts.source ? [opts.source] : []),
    ];
    const mergedSources = stringArray(sources, 40);
    const item: WorksetItem = {
      id: existing?.id || id,
      title,
      status:
        (compactString(raw.status, 80) as WorksetStatus | null) ||
        existing?.status ||
        "new",
      facts: { ...(existing?.facts || {}), ...facts },
      missing: stringArray(
        raw.missing !== undefined ? raw.missing : existing?.missing || [],
      ),
      next_action:
        compactString(raw.next_action, 1000) ?? existing?.next_action ?? null,
      sources: mergedSources,
      attempts: existing?.attempts || [],
      blockers: existing?.blockers || [],
      confidence_score:
        numberOrNull(raw.confidence_score) ?? existing?.confidence_score ?? null,
      priority: numberOrNull(raw.priority) ?? existing?.priority ?? null,
      created_at: existing?.created_at || ts,
      updated_at: ts,
    };
    byId.set(item.id, item);
    byTitle.set(item.title.toLowerCase(), item);
  }

  return writeWorksetState(sessionId, {
    version: 1,
    goal: opts.goal !== undefined ? compactString(opts.goal, 1000) : prev.goal,
    target_count:
      opts.target_count !== undefined
        ? numberOrNull(opts.target_count)
        : prev.target_count,
    notes: prev.notes,
    items: Array.from(byId.values()).sort((a, b) => {
      const pa = a.priority ?? Number.MAX_SAFE_INTEGER;
      const pb = b.priority ?? Number.MAX_SAFE_INTEGER;
      if (pa !== pb) return pa - pb;
      return a.created_at.localeCompare(b.created_at);
    }),
    updated_at: ts,
  });
}

export interface WorksetItemPatch {
  item_id?: unknown;
  title?: unknown;
  status?: unknown;
  facts?: unknown;
  missing?: unknown;
  next_action?: unknown;
  source?: unknown;
  attempt?: unknown;
  blocker?: unknown;
  confidence_score?: unknown;
  priority?: unknown;
}

export async function updateWorksetItem(
  sessionId: string,
  patch: WorksetItemPatch,
): Promise<WorksetState> {
  const state = await readWorksetState(sessionId);
  const id = compactString(patch.item_id, 120);
  const title = compactString(patch.title, 500);
  const idx = state.items.findIndex((item) => {
    if (id && item.id === id) return true;
    if (title && item.title.toLowerCase() === title.toLowerCase()) return true;
    return false;
  });
  if (idx < 0) {
    throw new Error(
      "workset_update: item not found. Use workset_read to inspect item ids/titles, or workset_upsert to add it first.",
    );
  }

  const existing = state.items[idx];
  const attemptRaw = asRecord(patch.attempt);
  const attempt =
    Object.keys(attemptRaw).length > 0
      ? ({
          tool: compactString(attemptRaw.tool, 120),
          outcome: compactString(attemptRaw.outcome, 120),
          summary: compactString(attemptRaw.summary, 1000),
          retryable:
            typeof attemptRaw.retryable === "boolean"
              ? attemptRaw.retryable
              : null,
          at: nowIso(),
        } satisfies WorksetAttempt)
      : null;

  state.items[idx] = {
    ...existing,
    status:
      (compactString(patch.status, 80) as WorksetStatus | null) ||
      existing.status,
    facts: { ...existing.facts, ...asRecord(patch.facts) },
    missing:
      patch.missing !== undefined
        ? stringArray(patch.missing)
        : existing.missing,
    next_action:
      patch.next_action !== undefined
        ? compactString(patch.next_action, 1000)
        : existing.next_action,
    sources: stringArray(
      [
        ...existing.sources,
        ...(compactString(patch.source, 180)
          ? [compactString(patch.source, 180)]
          : []),
      ],
      40,
    ),
    attempts: attempt
      ? [...existing.attempts, attempt].slice(-20)
      : existing.attempts,
    blockers: stringArray(
      [
        ...existing.blockers,
        ...(compactString(patch.blocker, 1000)
          ? [compactString(patch.blocker, 1000)]
          : []),
      ],
      20,
    ),
    confidence_score:
      numberOrNull(patch.confidence_score) ?? existing.confidence_score,
    priority: numberOrNull(patch.priority) ?? existing.priority,
    updated_at: nowIso(),
  };

  return writeWorksetState(sessionId, state);
}

export function summarizeWorkset(state: WorksetState) {
  const by_status: Record<string, number> = {};
  for (const item of state.items) {
    by_status[item.status] = (by_status[item.status] || 0) + 1;
  }
  const usable = state.items.filter(
    (i) => !["blocked", "discarded"].includes(String(i.status)),
  ).length;
  const saved = by_status.saved || 0;
  const ready = by_status.ready || 0;
  const target = state.target_count;
  return {
    total: state.items.length,
    usable,
    ready,
    saved,
    target,
    missing_to_target: target != null ? Math.max(0, target - saved) : null,
    by_status,
  };
}

export async function findWorksetItemByTitle(
  sessionId: string,
  title: string,
): Promise<WorksetItem | null> {
  const target = compactString(title, 500);
  if (!target) return null;
  const normalized = target.toLowerCase();
  const state = await readWorksetState(sessionId);
  return (
    state.items.find((item) => item.title.toLowerCase() === normalized) ||
    state.items.find(
      (item) =>
        item.title.toLowerCase().includes(normalized) ||
        normalized.includes(item.title.toLowerCase()),
    ) ||
    null
  );
}
