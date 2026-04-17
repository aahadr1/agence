"use client";

import { useState, useMemo } from "react";
import {
  ListTodo,
  CheckCircle2,
  Circle,
  Loader2,
  XCircle,
  ChevronDown,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { Todo } from "./types";

interface Props {
  todos: Todo[];
}

export function TodoTracker({ todos }: Props) {
  const [open, setOpen] = useState(true);

  const stats = useMemo(() => {
    const done = todos.filter((t) => t.status === "completed").length;
    const active = todos.filter((t) => t.status === "in_progress").length;
    const cancelled = todos.filter((t) => t.status === "cancelled").length;
    const total = todos.length;
    const remaining = total - done - cancelled;
    const pct = total === 0 ? 0 : Math.round((done / Math.max(1, total - cancelled)) * 100);
    return { done, active, cancelled, total, remaining, pct };
  }, [todos]);

  if (todos.length === 0) return null;

  return (
    <div
      className={cn(
        "sticky top-0 z-10 border-b border-[var(--border)]",
        "bg-[var(--background)]/85 backdrop-blur-md",
      )}
    >
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-4 py-2 text-left"
      >
        <ListTodo
          className="h-3.5 w-3.5 text-[var(--muted-foreground)]"
          strokeWidth={1.75}
        />
        <span className="text-[11.5px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
          Tâches
        </span>
        <span className="text-[11.5px] text-[var(--muted-foreground)]">
          {stats.done}/{stats.total - stats.cancelled}
          {stats.cancelled > 0 && (
            <span className="ml-1 text-[var(--muted-foreground)]/70">
              ({stats.cancelled} annulée{stats.cancelled > 1 ? "s" : ""})
            </span>
          )}
        </span>

        <div className="ml-2 flex-1">
          <div className="relative h-1 rounded-full bg-[var(--muted)] overflow-hidden">
            <div
              className="absolute inset-y-0 left-0 rounded-full bg-[var(--blue)] transition-all"
              style={{ width: `${stats.pct}%` }}
            />
          </div>
        </div>

        <span className="text-[11px] font-mono text-[var(--muted-foreground)]">
          {stats.pct}%
        </span>
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 text-[var(--muted-foreground)] transition-transform",
            !open && "-rotate-90",
          )}
        />
      </button>

      {open && (
        <ul className="space-y-0.5 px-4 pb-2">
          {todos.map((t) => (
            <li
              key={t.id}
              className={cn(
                "flex items-start gap-2 rounded-md px-1.5 py-1 text-[12.5px] leading-snug",
                t.status === "in_progress" && "bg-[var(--blue-subtle)]",
              )}
            >
              {t.status === "completed" ? (
                <CheckCircle2
                  className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500"
                  strokeWidth={1.75}
                />
              ) : t.status === "in_progress" ? (
                <Loader2
                  className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin text-[var(--blue)]"
                  strokeWidth={2}
                />
              ) : t.status === "cancelled" ? (
                <XCircle
                  className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--muted-foreground)]"
                  strokeWidth={1.75}
                />
              ) : (
                <Circle
                  className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--muted-foreground)]"
                  strokeWidth={1.75}
                />
              )}
              <span
                className={cn(
                  "flex-1",
                  t.status === "completed" &&
                    "text-[var(--muted-foreground)] line-through",
                  t.status === "cancelled" &&
                    "text-[var(--muted-foreground)]/70 line-through",
                  t.status === "in_progress" && "font-medium",
                )}
              >
                {t.content}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
