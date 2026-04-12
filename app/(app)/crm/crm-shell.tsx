"use client";

import { Panel } from "@/components/ui/panel";
import {
  DndContext,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

type CrmTab = "board" | "prospect" | "tasks" | "reporting";

type Stage = {
  id: string;
  name: string;
  color: string;
  sort_order: number;
};

type OpportunityCard = {
  id: string;
  stage_id: string;
  title: string;
  owner_user_id: string | null;
  amount_cents: number;
  source: string;
  openTaskCount: number;
  overdueTaskCount: number;
};

type Task = {
  id: string;
  opportunity_id: string | null;
  title: string;
  status: string;
  priority: string;
  due_at: string | null;
  assigned_to: string | null;
};

function DraggableCard({ item }: { item: OpportunityCard }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({
      id: item.id,
    });

  const style = transform
    ? {
        transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
        opacity: isDragging ? 0.8 : 1,
      }
    : undefined;

  return (
    <button
      type="button"
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className="w-full border border-border bg-card p-3 text-left text-xs transition-colors hover:border-foreground/30"
    >
      <p className="font-medium text-foreground">{item.title}</p>
      <p className="mt-1 text-[10px] text-muted-foreground">
        {(item.amount_cents / 100).toLocaleString("fr-FR", {
          style: "currency",
          currency: "EUR",
        })}{" "}
        - {item.source}
      </p>
      <p className="mt-1 text-[10px] text-muted-foreground">
        Tasks: {item.openTaskCount} ({item.overdueTaskCount} overdue)
      </p>
    </button>
  );
}

function DropColumn({
  stage,
  children,
}: {
  stage: Stage;
  children: ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id });
  return (
    <div
      ref={setNodeRef}
      className={`min-h-[460px] min-w-[260px] flex-1 border border-border bg-secondary/20 ${
        isOver ? "ring-1 ring-primary/40" : ""
      }`}
    >
      <div
        className="border-b border-border px-3 py-2"
        style={{ borderTopColor: stage.color, borderTopWidth: 3 }}
      >
        <p className="text-[11px] font-semibold uppercase tracking-wide text-foreground">
          {stage.name}
        </p>
      </div>
      <div className="space-y-2 p-2">{children}</div>
    </div>
  );
}

export function CrmShell() {
  const [tab, setTab] = useState<CrmTab>("board");
  const [stages, setStages] = useState<Stage[]>([]);
  const [opportunities, setOpportunities] = useState<OpportunityCard[]>([]);
  const [selectedOpportunityId, setSelectedOpportunityId] = useState<string | null>(null);
  const [prospect, setProspect] = useState<Record<string, unknown> | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [reporting, setReporting] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [taskDraft, setTaskDraft] = useState({ title: "", due_at: "" });
  const [activityDraft, setActivityDraft] = useState("");

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  const loadBoard = useCallback(async () => {
    const boardRes = await fetch("/api/crm/v2/board");
    const board = await boardRes.json();
    if (!boardRes.ok) {
      throw new Error(board.error || "Unable to load CRM board");
    }
    setStages(board.stages || []);
    setOpportunities(board.opportunities || []);
    if (!selectedOpportunityId && board.opportunities?.length) {
      setSelectedOpportunityId(board.opportunities[0].id);
    }
  }, [selectedOpportunityId]);

  const loadTasks = useCallback(async () => {
    const res = await fetch("/api/crm/v2/tasks");
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Unable to load tasks");
    setTasks(data.tasks || []);
  }, []);

  const loadReporting = useCallback(async () => {
    const res = await fetch("/api/crm/v2/reporting");
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Unable to load reporting");
    setReporting(data);
  }, []);

  const loadProspect = useCallback(async (id: string) => {
    const res = await fetch(`/api/crm/v2/prospects/${id}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Unable to load prospect");
    setProspect(data);
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      await Promise.all([loadBoard(), loadTasks(), loadReporting()]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [loadBoard, loadReporting, loadTasks]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (selectedOpportunityId) {
      loadProspect(selectedOpportunityId).catch(() => undefined);
    }
  }, [loadProspect, selectedOpportunityId]);

  const onDragEnd = async (event: DragEndEvent) => {
    if (!event.over) return;
    const opportunityId = String(event.active.id);
    const stageId = String(event.over.id);
    const original = opportunities;
    setOpportunities((prev) =>
      prev.map((o) => (o.id === opportunityId ? { ...o, stage_id: stageId } : o))
    );
    const res = await fetch(`/api/crm/v2/opportunities/${opportunityId}/move`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stage_id: stageId }),
    });
    if (!res.ok) {
      setOpportunities(original);
      const data = await res.json();
      setError(data.error || "Unable to move opportunity");
      return;
    }
    if (selectedOpportunityId === opportunityId) {
      await loadProspect(opportunityId);
    }
  };

  const addTask = async () => {
    if (!taskDraft.title.trim() || !selectedOpportunityId) return;
    const res = await fetch("/api/crm/v2/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: taskDraft.title.trim(),
        due_at: taskDraft.due_at ? new Date(taskDraft.due_at).toISOString() : null,
        opportunity_id: selectedOpportunityId,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "Unable to create task");
      return;
    }
    setTaskDraft({ title: "", due_at: "" });
    await Promise.all([loadTasks(), loadProspect(selectedOpportunityId), loadBoard()]);
  };

  const addNote = async () => {
    if (!selectedOpportunityId || !activityDraft.trim()) return;
    const res = await fetch(
      `/api/crm/v2/opportunities/${selectedOpportunityId}/activities`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "note", body: activityDraft.trim() }),
      }
    );
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "Unable to add note");
      return;
    }
    setActivityDraft("");
    await loadProspect(selectedOpportunityId);
  };

  const createMeeting = async () => {
    if (!selectedOpportunityId) return;
    const startsAt = new Date(Date.now() + 1000 * 60 * 60).toISOString();
    const endsAt = new Date(Date.now() + 1000 * 60 * 90).toISOString();
    const res = await fetch("/api/crm/v2/calendar-link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        opportunity_id: selectedOpportunityId,
        title: "Follow-up meeting",
        starts_at: startsAt,
        ends_at: endsAt,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error || "Unable to create meeting");
      return;
    }
    await loadProspect(selectedOpportunityId);
  };

  const assignedTasks = useMemo(() => tasks.filter((t) => !!t.assigned_to), [tasks]);

  if (loading) {
    return <Panel className="mt-6 text-center text-sm text-muted-foreground">Loading CRM...</Panel>;
  }

  return (
    <div className="mt-6 space-y-4">
      <div className="flex flex-wrap gap-2 border-b border-border pb-3">
        {[
          { id: "board", label: "Pipeline board" },
          { id: "prospect", label: "Prospect 360" },
          { id: "tasks", label: "Tasks" },
          { id: "reporting", label: "Reporting" },
        ].map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id as CrmTab)}
            className={`border px-3 py-1 text-xs uppercase tracking-wide ${
              tab === item.id
                ? "border-foreground bg-foreground text-primary-foreground"
                : "border-border text-muted-foreground"
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {error ? (
        <Panel className="border-destructive/30 bg-destructive/5 text-sm text-destructive">
          {error}
        </Panel>
      ) : null}

      {tab === "board" ? (
        <DndContext sensors={sensors} onDragEnd={onDragEnd}>
          <div className="flex gap-3 overflow-x-auto pb-3">
            {stages.map((stage) => (
              <DropColumn stage={stage} key={stage.id}>
                {opportunities
                  .filter((o) => o.stage_id === stage.id)
                  .map((op) => (
                    <div key={op.id} onClick={() => setSelectedOpportunityId(op.id)}>
                      <DraggableCard item={op} />
                    </div>
                  ))}
              </DropColumn>
            ))}
          </div>
        </DndContext>
      ) : null}

      {tab === "prospect" ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Panel className="lg:col-span-2" padding="sm">
            {!prospect ? (
              <p className="text-sm text-muted-foreground">Select an opportunity from the board.</p>
            ) : (
              <>
                <h3 className="text-sm font-semibold text-foreground">
                  {(prospect.opportunity as { title?: string })?.title || "Prospect"}
                </h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  {(prospect.account as { name?: string })?.name || "No linked account"}
                </p>
                <div className="mt-4">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Timeline
                  </p>
                  <div className="mt-2 space-y-2">
                    {((prospect.activities as Array<{ id: string; type: string; body: string | null; happened_at: string }>) || []).map(
                      (activity) => (
                        <div key={activity.id} className="border border-border p-2 text-xs">
                          <p className="font-medium text-foreground">{activity.type}</p>
                          <p className="text-muted-foreground">
                            {activity.body || "No details"} -{" "}
                            {new Date(activity.happened_at).toLocaleString()}
                          </p>
                        </div>
                      )
                    )}
                  </div>
                </div>
              </>
            )}
          </Panel>
          <Panel padding="sm">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Add note
            </p>
            <textarea
              value={activityDraft}
              onChange={(e) => setActivityDraft(e.target.value)}
              className="mt-2 w-full border border-border bg-card p-2 text-sm"
              rows={4}
            />
            <button type="button" onClick={addNote} className="btn-solid mt-2">
              Save note
            </button>
            <hr className="my-4 border-border" />
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Add follow-up task
            </p>
            <input
              value={taskDraft.title}
              onChange={(e) => setTaskDraft((prev) => ({ ...prev, title: e.target.value }))}
              className="mt-2 w-full border border-border bg-card p-2 text-sm"
              placeholder="Task title"
            />
            <input
              type="datetime-local"
              value={taskDraft.due_at}
              onChange={(e) => setTaskDraft((prev) => ({ ...prev, due_at: e.target.value }))}
              className="mt-2 w-full border border-border bg-card p-2 text-sm"
            />
            <button type="button" onClick={addTask} className="btn-solid mt-2">
              Create task
            </button>
            <button type="button" onClick={createMeeting} className="btn-solid mt-2 w-full">
              Create calendar meeting
            </button>
          </Panel>
        </div>
      ) : null}

      {tab === "tasks" ? (
        <Panel padding="sm">
          <h3 className="text-sm font-semibold text-foreground">Team tasks</h3>
          <div className="mt-3 space-y-2">
            {tasks.map((task) => (
              <div key={task.id} className="border border-border p-2 text-xs">
                <p className="font-medium text-foreground">{task.title}</p>
                <p className="text-muted-foreground">
                  {task.status} - {task.priority} -{" "}
                  {task.due_at ? new Date(task.due_at).toLocaleString() : "No deadline"}
                </p>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Assigned task count: {assignedTasks.length}
          </p>
        </Panel>
      ) : null}

      {tab === "reporting" ? (
        <Panel padding="sm">
          <h3 className="text-sm font-semibold text-foreground">CRM reporting</h3>
          <pre className="mt-3 overflow-auto border border-border bg-secondary/20 p-3 text-xs text-muted-foreground">
            {JSON.stringify(reporting || {}, null, 2)}
          </pre>
        </Panel>
      ) : null}
    </div>
  );
}
