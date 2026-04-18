"use client";

import type { ReactNode } from "react";
import { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/utils";

interface OsRow {
  id: string;
  created_at: string;
  [k: string]: unknown;
}

export function OsContextPanel({
  sessionId,
  enabled,
}: {
  sessionId: string;
  enabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [sources, setSources] = useState<OsRow[]>([]);
  const [artifacts, setArtifacts] = useState<OsRow[]>([]);
  const [decisions, setDecisions] = useState<OsRow[]>([]);
  const [audit, setAudit] = useState<OsRow[]>([]);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!enabled) return;
    try {
      const res = await fetch(`/api/agent/sessions/${sessionId}/os-context`);
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(j.error || res.statusText);
        return;
      }
      setErr(null);
      setSources(j.sources || []);
      setArtifacts(j.artifacts || []);
      setDecisions(j.decisions || []);
      setAudit(j.audit || []);
    } catch {
      setErr("fetch failed");
    }
  }, [sessionId, enabled]);

  useEffect(() => {
    if (!enabled || !open) return;
    void load();
    const t = setInterval(() => void load(), 12_000);
    return () => clearInterval(t);
  }, [enabled, open, load]);

  if (!enabled) return null;

  return (
    <div className="border-b border-[var(--border)] bg-[var(--muted)]/30 px-4 py-2 text-[12px]">
      <button
        type="button"
        onClick={() => {
          setOpen((o) => !o);
          if (!open) void load();
        }}
        className="flex w-full items-center justify-between font-medium text-[var(--foreground)]"
      >
        <span>Trace Agent OS</span>
        <span className="text-[var(--muted-foreground)]">{open ? "▼" : "▶"}</span>
      </button>
      {open && (
        <div className="mt-2 max-h-64 space-y-3 overflow-y-auto text-[11px]">
          {err && (
            <p className="text-red-600 dark:text-red-400">
              {err} (appliquez la migration 025 si les tables manquent)
            </p>
          )}
          <Section title={`Sources (${sources.length})`}>
            {sources.slice(0, 12).map((s) => (
              <Row key={s.id}>
                <span className="truncate font-mono text-[10px]">
                  {(s.title as string) || (s.url as string)?.slice(0, 72)}
                </span>
              </Row>
            ))}
          </Section>
          <Section title={`Artefacts (${artifacts.length})`}>
            {artifacts.slice(0, 8).map((a) => (
              <Row key={a.id}>
                {(a.kind as string) || "—"} — {(a.title as string) || "sans titre"}
              </Row>
            ))}
          </Section>
          <Section title={`Décisions (${decisions.length})`}>
            {decisions.slice(0, 8).map((d) => (
              <Row key={d.id}>
                <span className="line-clamp-2">{String(d.decision || "")}</span>
              </Row>
            ))}
          </Section>
          <Section title={`Audit outils (${audit.length})`}>
            {audit.slice(0, 15).map((l) => (
              <Row key={l.id}>
                <span
                  className={cn(
                    (l.ok as boolean) === false
                      ? "text-red-600 dark:text-red-400"
                      : "text-emerald-700 dark:text-emerald-400",
                  )}
                >
                  {(l.tool_name as string) || "?"}
                </span>{" "}
                <span className="text-[var(--muted-foreground)]">
                  {(l.risk_class as string) || "green"}
                </span>
              </Row>
            ))}
          </Section>
        </div>
      )}
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
        {title}
      </div>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

function Row({ children }: { children: ReactNode }) {
  return <div className="rounded border border-[var(--border)]/60 bg-[var(--card)] px-2 py-1">{children}</div>;
}
