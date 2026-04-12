"use client";

import type { CrmTask, CrmTaskStatus, CrmTaskPriority } from "@/lib/crm/types";
import { EmptyState } from "./empty-state";
import { Check, Circle, Clock, AlertTriangle, Plus, CalendarPlus } from "lucide-react";
import { useState } from "react";

const PRIORITY_COLORS: Record<CrmTaskPriority, string> = {
  low: "#64748b",
  medium: "#f59e0b",
  high: "#ef4444",
};

const STATUS_ICONS: Record<CrmTaskStatus, React.ReactNode> = {
  todo: <Circle className="h-3.5 w-3.5 text-muted-foreground" />,
  in_progress: <Clock className="h-3.5 w-3.5 text-blue-500" />,
  done: <Check className="h-3.5 w-3.5 text-emerald-500" />,
  cancelled: <Check className="h-3.5 w-3.5 text-muted-foreground line-through" />,
};

function isOverdue(task: CrmTask) {
  return (
    task.due_at &&
    new Date(task.due_at).getTime() < Date.now() &&
    task.status !== "done" &&
    task.status !== "cancelled"
  );
}

export function TaskList({
  tasks,
  opportunityId,
  onTaskChanged,
}: {
  tasks: CrmTask[];
  opportunityId: string;
  onTaskChanged: () => void;
}) {
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [priority, setPriority] = useState<CrmTaskPriority>("medium");
  const [saving, setSaving] = useState(false);

  const pending = tasks.filter((t) => t.status === "todo" || t.status === "in_progress");
  const completed = tasks.filter((t) => t.status === "done" || t.status === "cancelled");

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/crm/v2/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          due_at: dueAt ? new Date(dueAt).toISOString() : null,
          priority,
          opportunity_id: opportunityId,
        }),
      });
      if (!res.ok) throw new Error("Failed to create task");
      setTitle("");
      setDueAt("");
      setPriority("medium");
      setShowForm(false);
      onTaskChanged();
    } catch {
      // silently fail
    } finally {
      setSaving(false);
    }
  };

  const toggleStatus = async (task: CrmTask) => {
    const newStatus: CrmTaskStatus =
      task.status === "done" ? "todo" : "done";
    await fetch(`/api/crm/v2/tasks/${task.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: newStatus }),
    });
    onTaskChanged();
  };

  const handleQuickFollowUp = async () => {
    const startsAt = new Date(Date.now() + 3_600_000).toISOString();
    const endsAt = new Date(Date.now() + 5_400_000).toISOString();
    await fetch("/api/crm/v2/calendar-link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        opportunity_id: opportunityId,
        title: "Follow-up meeting",
        starts_at: startsAt,
        ends_at: endsAt,
      }),
    });
    onTaskChanged();
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Tasks & follow-ups
        </h3>
        <div className="flex gap-1">
          <button
            type="button"
            onClick={handleQuickFollowUp}
            className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-secondary hover:text-foreground"
          >
            <CalendarPlus className="h-3 w-3" />
            Meeting
          </button>
          <button
            type="button"
            onClick={() => setShowForm(!showForm)}
            className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-secondary hover:text-foreground"
          >
            <Plus className="h-3 w-3" />
            Task
          </button>
        </div>
      </div>

      {showForm && (
        <form onSubmit={handleCreate} className="mb-3 rounded-[var(--radius)] border border-border bg-card p-3">
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Task title..."
            className="input-minimal py-1 text-sm"
            autoFocus
          />
          <div className="mt-2 flex items-center gap-2">
            <input
              type="datetime-local"
              value={dueAt}
              onChange={(e) => setDueAt(e.target.value)}
              className="input-minimal flex-1 py-1 text-xs"
            />
            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value as CrmTaskPriority)}
              className="input-minimal w-24 py-1 text-xs"
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
            <button type="submit" disabled={saving} className="btn-solid py-1 text-xs">
              Add
            </button>
          </div>
        </form>
      )}

      {tasks.length === 0 && !showForm ? (
        <EmptyState variant="no-tasks" />
      ) : (
        <div className="space-y-4">
          {pending.length > 0 && (
            <div className="space-y-1">
              {pending.map((task) => (
                <div
                  key={task.id}
                  className={`flex items-start gap-2 rounded-[var(--radius)] border px-3 py-2 ${
                    isOverdue(task)
                      ? "border-destructive/30 bg-destructive/5"
                      : "border-border bg-card"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => toggleStatus(task)}
                    className="mt-0.5 shrink-0"
                  >
                    {STATUS_ICONS[task.status]}
                  </button>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-foreground">{task.title}</p>
                    <div className="mt-0.5 flex items-center gap-2">
                      {task.due_at && (
                        <span className={`text-[10px] ${isOverdue(task) ? "font-semibold text-destructive" : "text-muted-foreground"}`}>
                          {isOverdue(task) && <AlertTriangle className="mr-0.5 inline h-2.5 w-2.5" />}
                          {new Date(task.due_at).toLocaleDateString("fr-FR", {
                            day: "numeric",
                            month: "short",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      )}
                      <span
                        className="rounded-full px-1.5 py-0 text-[10px] font-medium"
                        style={{
                          backgroundColor: `${PRIORITY_COLORS[task.priority]}18`,
                          color: PRIORITY_COLORS[task.priority],
                        }}
                      >
                        {task.priority}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {completed.length > 0 && (
            <div>
              <p className="mb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                Completed ({completed.length})
              </p>
              <div className="space-y-1">
                {completed.map((task) => (
                  <div
                    key={task.id}
                    className="flex items-start gap-2 rounded-[var(--radius)] border border-border bg-card px-3 py-2 opacity-60"
                  >
                    <button
                      type="button"
                      onClick={() => toggleStatus(task)}
                      className="mt-0.5 shrink-0"
                    >
                      {STATUS_ICONS[task.status]}
                    </button>
                    <p className="text-xs text-foreground line-through">{task.title}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
