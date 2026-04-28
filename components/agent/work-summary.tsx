"use client";

import { useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

import type { Approval, Session, TimelineEvent, Todo } from "./types";
import { StreamEvent } from "./stream-event";
import { TodoTracker } from "./todo-tracker";

interface Props {
  session: Session;
  events: TimelineEvent[];
  todos?: Todo[];
  approvals: Approval[];
  onRespondApproval: (id: string, decision: "approve" | "reject") => void;
}

function formatWorkedDuration(ms: number): string {
  const totalSeconds = Math.max(1, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  if (minutes > 0) return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
  return `${seconds}s`;
}

function elapsedMs(session: Session): number {
  const startedAt = new Date(session.created_at).getTime();
  const terminalStatuses = new Set(["completed", "failed", "cancelled"]);
  const endedAtSource =
    terminalStatuses.has(String(session.status)) && session.updated_at
      ? session.updated_at
      : new Date().toISOString();
  const endedAt = new Date(endedAtSource).getTime();

  if (
    !Number.isFinite(startedAt) ||
    !Number.isFinite(endedAt) ||
    endedAt <= startedAt
  ) {
    return 1000;
  }

  return endedAt - startedAt;
}

export function WorkSummary({
  session,
  events,
  todos = [],
  approvals,
  onRespondApproval,
}: Props) {
  const [open, setOpen] = useState(false);
  const duration = useMemo(
    () => formatWorkedDuration(elapsedMs(session)),
    [session],
  );

  if (events.length === 0) return null;

  return (
    <section className="animate-fade-in">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className={cn(
          "group flex w-full items-center gap-1.5 border-b border-[var(--border)] pb-2 text-left",
          "text-[12px] font-medium text-[var(--muted-foreground)] transition-colors",
          "hover:text-[var(--foreground)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]",
        )}
        aria-expanded={open}
      >
        <span>Worked for {duration}</span>
        <ChevronRight
          className={cn(
            "h-3.5 w-3.5 transition-transform",
            open && "rotate-90",
          )}
          strokeWidth={1.75}
        />
      </button>

      {open && (
        <div className="space-y-5 pt-4">
          {todos.length > 0 && <TodoTracker todos={todos} />}
          {events.map((event, index) => (
            <StreamEvent
              key={event.id}
              event={event}
              approvals={approvals}
              onRespondApproval={onRespondApproval}
              last={index === events.length - 1}
            />
          ))}
        </div>
      )}
    </section>
  );
}
