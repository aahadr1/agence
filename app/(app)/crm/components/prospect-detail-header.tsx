"use client";

import type { CrmOpportunity, CrmStage } from "@/lib/crm/types";
import { StageBadge, StatusBadge } from "./status-badge";
import {
  ArrowLeft,
  Trophy,
  XCircle,
  Pencil,
  Save,
  X,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";

function formatCurrency(cents: number, currency: string) {
  return (cents / 100).toLocaleString("fr-FR", { style: "currency", currency });
}

export function ProspectDetailHeader({
  opportunity,
  stages,
  onUpdate,
}: {
  opportunity: CrmOpportunity;
  stages: CrmStage[];
  onUpdate: (patch: Record<string, unknown>) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(opportunity.title);
  const [stageId, setStageId] = useState(opportunity.stage_id);
  const [amountEur, setAmountEur] = useState(String(opportunity.amount_cents / 100));
  const [probability, setProbability] = useState(String(opportunity.probability));
  const [closeDate, setCloseDate] = useState(opportunity.expected_close_date || "");

  const currentStage = stages.find((s) => s.id === opportunity.stage_id);

  const handleSave = () => {
    const patch: Record<string, unknown> = {};
    if (title !== opportunity.title) patch.title = title;
    const cents = Math.round(parseFloat(amountEur || "0") * 100);
    if (cents !== opportunity.amount_cents) patch.amount_cents = cents;
    const prob = Math.max(0, Math.min(100, parseInt(probability || "0")));
    if (prob !== opportunity.probability) patch.probability = prob;
    if (closeDate !== (opportunity.expected_close_date || "")) {
      patch.expected_close_date = closeDate || null;
    }
    if (stageId !== opportunity.stage_id) {
      fetch(`/api/crm/v2/opportunities/${opportunity.id}/move`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stage_id: stageId }),
      });
    }
    if (Object.keys(patch).length > 0) onUpdate(patch);
    setEditing(false);
  };

  const handleMarkWon = () => onUpdate({ status: "won" });
  const handleMarkLost = () => onUpdate({ status: "lost" });

  return (
    <div className="rounded-[var(--radius)] border border-border bg-card">
      <div className="flex items-center gap-3 border-b border-border px-5 py-3">
        <Link
          href="/crm"
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back
        </Link>
      </div>
      <div className="px-5 py-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            {editing ? (
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="input-minimal py-1 text-lg font-semibold"
              />
            ) : (
              <h1 className="font-display text-xl font-medium tracking-tight text-display-title sm:text-2xl">
                {opportunity.title}
              </h1>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {editing ? (
                <select
                  value={stageId}
                  onChange={(e) => setStageId(e.target.value)}
                  className="input-minimal py-0.5 text-xs"
                >
                  {stages.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              ) : (
                currentStage && <StageBadge name={currentStage.name} color={currentStage.color} />
              )}
              <StatusBadge status={opportunity.status} />
              {opportunity.tags.map((tag) => (
                <span key={tag} className="rounded-full bg-secondary px-2 py-0.5 text-[10px] text-foreground">
                  {tag}
                </span>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-1">
            {editing ? (
              <>
                <button type="button" onClick={handleSave} className="btn-solid flex items-center gap-1 py-1 text-xs">
                  <Save className="h-3 w-3" /> Save
                </button>
                <button type="button" onClick={() => setEditing(false)} className="btn-outline py-1 text-xs">
                  <X className="h-3 w-3" />
                </button>
              </>
            ) : (
              <>
                <button type="button" onClick={() => setEditing(true)} className="btn-outline flex items-center gap-1 py-1 text-xs">
                  <Pencil className="h-3 w-3" /> Edit
                </button>
                {opportunity.status === "open" && (
                  <>
                    <button type="button" onClick={handleMarkWon} className="flex items-center gap-1 rounded-[var(--radius)] border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-500/20 dark:text-emerald-300">
                      <Trophy className="h-3 w-3" /> Won
                    </button>
                    <button type="button" onClick={handleMarkLost} className="flex items-center gap-1 rounded-[var(--radius)] border border-red-500/30 bg-red-500/10 px-2.5 py-1 text-xs font-medium text-red-700 hover:bg-red-500/20 dark:text-red-300">
                      <XCircle className="h-3 w-3" /> Lost
                    </button>
                  </>
                )}
              </>
            )}
          </div>
        </div>

        {/* Key metrics */}
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div>
            <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Amount</p>
            {editing ? (
              <input
                type="number"
                step="0.01"
                value={amountEur}
                onChange={(e) => setAmountEur(e.target.value)}
                className="input-minimal mt-0.5 py-0.5 text-sm font-semibold"
              />
            ) : (
              <p className="mt-0.5 text-sm font-semibold tabular-nums text-foreground">
                {formatCurrency(opportunity.amount_cents, opportunity.currency)}
              </p>
            )}
          </div>
          <div>
            <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Probability</p>
            {editing ? (
              <input
                type="number"
                min="0"
                max="100"
                value={probability}
                onChange={(e) => setProbability(e.target.value)}
                className="input-minimal mt-0.5 py-0.5 text-sm font-semibold"
              />
            ) : (
              <div className="mt-0.5 flex items-center gap-2">
                <div className="h-1.5 w-16 overflow-hidden rounded-full bg-secondary">
                  <div className="h-full rounded-full bg-foreground/40" style={{ width: `${opportunity.probability}%` }} />
                </div>
                <span className="text-sm font-semibold tabular-nums text-foreground">{opportunity.probability}%</span>
              </div>
            )}
          </div>
          <div>
            <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Weighted</p>
            <p className="mt-0.5 text-sm font-semibold tabular-nums text-foreground">
              {formatCurrency(Math.round(opportunity.amount_cents * opportunity.probability / 100), opportunity.currency)}
            </p>
          </div>
          <div>
            <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Close date</p>
            {editing ? (
              <input
                type="date"
                value={closeDate}
                onChange={(e) => setCloseDate(e.target.value)}
                className="input-minimal mt-0.5 py-0.5 text-sm"
              />
            ) : (
              <p className="mt-0.5 text-sm text-foreground">
                {opportunity.expected_close_date
                  ? new Date(opportunity.expected_close_date).toLocaleDateString("fr-FR")
                  : "Not set"}
              </p>
            )}
          </div>
        </div>

        {opportunity.description && (
          <p className="mt-3 text-xs text-muted-foreground">{opportunity.description}</p>
        )}
      </div>
    </div>
  );
}
