"use client";

import {
  DndContext,
  DragEndEvent,
  PointerSensor,
  useDroppable,
  useDraggable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { Panel } from "@/components/ui/panel";
import { useCallback, useEffect, useState } from "react";

type Stage = { id: string; name: string; color: string; sort_order: number };
type Deal = {
  id: string;
  stage_id: string;
  title: string;
  contact_phone: string | null;
  niche: string | null;
  sort_order: number;
  lead_id: string | null;
};

function DealCard({
  deal,
  disabled,
}: {
  deal: Deal;
  disabled?: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({
      id: deal.id,
      disabled,
    });

  const style = transform
    ? {
        transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
        zIndex: isDragging ? 10 : undefined,
        opacity: isDragging ? 0.85 : 1,
      }
    : undefined;

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      className="cursor-grab border border-border bg-card p-3 text-left active:cursor-grabbing"
    >
      <p className="text-xs font-medium text-foreground">{deal.title}</p>
      {deal.niche && (
        <p className="mt-1 text-[10px] text-muted-foreground">{deal.niche}</p>
      )}
      {deal.contact_phone && (
        <p className="mt-1 text-[10px] text-muted-foreground">
          {deal.contact_phone}
        </p>
      )}
    </div>
  );
}

function StageColumn({
  stage,
  deals,
}: {
  stage: Stage;
  deals: Deal[];
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id });

  return (
    <div
      ref={setNodeRef}
      className={`flex min-h-[420px] min-w-[200px] flex-1 flex-col border border-border bg-secondary/20 ${
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
        <p className="text-[10px] text-muted-foreground">{deals.length}</p>
      </div>
      <div className="flex flex-1 flex-col gap-2 p-2">
        {deals.map((d) => (
          <DealCard key={d.id} deal={d} />
        ))}
      </div>
    </div>
  );
}

export function CrmBoard() {
  const [stages, setStages] = useState<Stage[]>([]);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } })
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/crm/board");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load");
      setStages(data.stages || []);
      setDeals(data.deals || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const onDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over) return;
    const dealId = String(active.id);
    const newStageId = String(over.id);
    const deal = deals.find((d) => d.id === dealId);
    if (!deal || deal.stage_id === newStageId) return;

    setDeals((prev) =>
      prev.map((d) =>
        d.id === dealId ? { ...d, stage_id: newStageId } : d
      )
    );

    try {
      const res = await fetch(`/api/crm/deals/${dealId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stage_id: newStageId }),
      });
      if (!res.ok) {
        const j = await res.json();
        throw new Error(j.error || "Update failed");
      }
    } catch {
      load();
    }
  };

  if (loading) {
    return (
      <Panel className="p-8 text-center text-sm text-muted-foreground">
        Chargement du pipeline…
      </Panel>
    );
  }

  if (error) {
    return (
      <Panel className="p-8 text-center text-sm text-destructive">
        {error}
      </Panel>
    );
  }

  if (!stages.length) {
    return (
      <Panel className="p-8 text-center text-sm text-muted-foreground">
        Aucun pipeline CRM. Appliquez les migrations Supabase (011).
      </Panel>
    );
  }

  return (
    <DndContext sensors={sensors} onDragEnd={onDragEnd}>
      <div className="flex gap-3 overflow-x-auto pb-4">
        {stages.map((stage) => (
          <StageColumn
            key={stage.id}
            stage={stage}
            deals={deals.filter((d) => d.stage_id === stage.id)}
          />
        ))}
      </div>
    </DndContext>
  );
}
