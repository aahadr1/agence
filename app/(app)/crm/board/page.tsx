"use client";

import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { BoardCard, type BoardCardData } from "../components/board-card";
import { BoardColumn, type BoardStage } from "../components/board-column";
import type { ProspectTemperature } from "@/lib/crm/types";
import { Table2 } from "lucide-react";
import Link from "next/link";

function computeTemperature(
  lastActivityAt: string | null,
  overdueTaskCount: number,
  probability: number
): ProspectTemperature {
  const days = lastActivityAt
    ? (Date.now() - new Date(lastActivityAt).getTime()) / 86_400_000
    : Infinity;
  if (days < 3 && overdueTaskCount === 0) return "hot";
  if (days < 14 || probability >= 70) return "warm";
  return "cold";
}

export default function BoardPage() {
  const router = useRouter();
  const [stages, setStages] = useState<BoardStage[]>([]);
  const [cards, setCards] = useState<BoardCardData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  const loadBoard = useCallback(async () => {
    try {
      const [boardRes, prospectsRes] = await Promise.all([
        fetch("/api/crm/v2/board"),
        fetch("/api/crm/v2/prospects?per_page=100"),
      ]);
      const board = await boardRes.json();
      const prospectsData = await prospectsRes.json();

      if (!boardRes.ok) throw new Error(board.error || "Failed to load board");

      setStages(board.stages || []);

      const enrichedCards: BoardCardData[] = (board.opportunities || []).map(
        (opp: Record<string, unknown>) => {
          const prospect = (prospectsData.prospects || []).find(
            (p: { id: string }) => p.id === opp.id
          );
          return {
            id: opp.id as string,
            stage_id: opp.stage_id as string,
            title: opp.title as string,
            account_name: prospect?.account_name || null,
            amount_cents: (opp.amount_cents as number) || 0,
            source: (opp.source as string) || "manual",
            open_task_count: (opp.openTaskCount as number) || 0,
            overdue_task_count: (opp.overdueTaskCount as number) || 0,
            last_activity_at: prospect?.last_activity_at || null,
            temperature: prospect?.temperature || computeTemperature(null, 0, (opp.probability as number) || 0),
          };
        }
      );

      setCards(enrichedCards);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load board");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadBoard();
  }, [loadBoard]);

  const onDragEnd = async (event: DragEndEvent) => {
    if (!event.over) return;
    const cardId = String(event.active.id);
    const stageId = String(event.over.id);
    const original = cards;

    setCards((prev) =>
      prev.map((c) => (c.id === cardId ? { ...c, stage_id: stageId } : c))
    );

    const res = await fetch(`/api/crm/v2/opportunities/${cardId}/move`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stage_id: stageId }),
    });

    if (!res.ok) {
      setCards(original);
      const data = await res.json();
      setError(data.error || "Failed to move card");
    }
  };

  if (loading) {
    return (
      <div className="animate-fade-in flex items-center justify-center py-20">
        <p className="text-sm text-muted-foreground">Loading board...</p>
      </div>
    );
  }

  return (
    <div className="animate-fade-in">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="label-eyebrow">CRM</p>
          <h1 className="mt-1 text-xl font-semibold text-foreground sm:text-2xl">Pipeline Board</h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Drag and drop prospects between stages.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/crm"
            className="flex items-center gap-1.5 rounded-[var(--radius)] border border-border px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:border-foreground/20 hover:text-foreground"
          >
            <Table2 className="h-3.5 w-3.5" />
            Table view
          </Link>
        </div>
      </div>

      {error && (
        <div className="mt-4 rounded-[var(--radius)] border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="mt-6">
        <DndContext sensors={sensors} onDragEnd={onDragEnd}>
          <div className="flex gap-3 overflow-x-auto pb-4">
            {stages.map((stage) => {
              const stageCards = cards.filter((c) => c.stage_id === stage.id);
              const totalCents = stageCards.reduce((sum, c) => sum + c.amount_cents, 0);
              return (
                <BoardColumn
                  key={stage.id}
                  stage={stage}
                  count={stageCards.length}
                  totalCents={totalCents}
                >
                  {stageCards.map((card) => (
                    <BoardCard
                      key={card.id}
                      item={card}
                      onClick={() => router.push(`/crm/${card.id}`)}
                    />
                  ))}
                </BoardColumn>
              );
            })}
          </div>
        </DndContext>
      </div>
    </div>
  );
}
