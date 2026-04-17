"use client";

import { useMemo, useState } from "react";
import {
  Plus,
  Search,
  Bot,
  Clock,
  CheckCircle2,
  AlertCircle,
  Pause,
  Play,
  ShieldQuestion,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { Session } from "./types";

interface Props {
  sessions: Session[];
  activeId: string | null;
  onSelect: (s: Session) => void;
  onNew: () => void;
}

const STATUS_DOT: Record<string, string> = {
  running: "bg-emerald-500 animate-pulse",
  pending: "bg-amber-500",
  awaiting_approval: "bg-amber-500",
  paused: "bg-[var(--muted-foreground)]",
  completed: "bg-[var(--muted-foreground)]/40",
  failed: "bg-red-500",
};

const STATUS_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  running: Play,
  pending: Clock,
  awaiting_approval: ShieldQuestion,
  paused: Pause,
  completed: CheckCircle2,
  failed: AlertCircle,
};

export function SessionsRail({ sessions, activeId, onSelect, onNew }: Props) {
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return sessions;
    return sessions.filter((s) =>
      (s.title || "").toLowerCase().includes(needle),
    );
  }, [sessions, q]);

  return (
    <aside
      className={cn(
        "hidden lg:flex",
        "w-[260px] shrink-0 flex-col border-r border-[var(--border)]",
        "bg-[var(--card)]",
      )}
    >
      <div className="flex items-center gap-2 border-b border-[var(--border)] px-3 py-2.5">
        <div className="flex h-6 w-6 items-center justify-center rounded-md bg-[var(--foreground)] text-[var(--primary-foreground)]">
          <Bot className="h-3.5 w-3.5" strokeWidth={1.75} />
        </div>
        <div className="flex-1">
          <p className="text-[12.5px] font-semibold leading-none">Agent</p>
          <p className="text-[10px] text-[var(--muted-foreground)]">
            Autonome · v3
          </p>
        </div>
        <button
          onClick={onNew}
          title="Nouvelle session"
          className={cn(
            "inline-flex h-7 w-7 items-center justify-center rounded-md",
            "bg-[var(--foreground)] text-[var(--primary-foreground)]",
            "hover:opacity-90",
          )}
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={2} />
        </button>
      </div>

      <div className="relative px-3 py-2">
        <Search className="pointer-events-none absolute left-5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--muted-foreground)]" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Rechercher…"
          className={cn(
            "w-full rounded-md border border-[var(--border)] bg-[var(--background)]",
            "py-1.5 pl-7 pr-2 text-[12px]",
            "placeholder:text-[var(--muted-foreground)] focus:outline-none",
            "focus:ring-1 focus:ring-[var(--blue)]",
          )}
        />
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-3">
        {filtered.length === 0 ? (
          <p className="px-2 py-6 text-center text-[11.5px] text-[var(--muted-foreground)]">
            {sessions.length === 0
              ? "Pas encore de sessions."
              : "Aucun résultat."}
          </p>
        ) : (
          <ul className="space-y-0.5">
            {filtered.map((s) => {
              const Icon = STATUS_ICON[s.status] || Clock;
              return (
                <li key={s.id}>
                  <button
                    onClick={() => onSelect(s)}
                    className={cn(
                      "group flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors",
                      activeId === s.id
                        ? "bg-[var(--muted)]"
                        : "hover:bg-[var(--muted)]/60",
                    )}
                  >
                    <span
                      className={cn(
                        "mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full",
                        STATUS_DOT[s.status] || "bg-[var(--muted-foreground)]/40",
                      )}
                    />
                    <div className="min-w-0 flex-1">
                      <p
                        className={cn(
                          "line-clamp-1 text-[12.5px]",
                          activeId === s.id
                            ? "font-medium text-[var(--foreground)]"
                            : "text-[var(--foreground)]/90",
                        )}
                      >
                        {s.title || "(sans titre)"}
                      </p>
                      <div className="mt-0.5 flex items-center gap-1 text-[10.5px] text-[var(--muted-foreground)]">
                        <Icon className="h-3 w-3" />
                        <span className="capitalize">{s.status}</span>
                        {s.capability_packs?.length > 0 && (
                          <>
                            <span>·</span>
                            <span className="line-clamp-1">
                              {s.capability_packs[0]}
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </aside>
  );
}
