"use client";

import { ShieldAlert, Check, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Approval } from "../types";

interface Props {
  content: string;
  approvalId: string;
  details?: string;
  risk?: "low" | "medium" | "high";
  approvals: Approval[];
  onRespond: (id: string, decision: "approve" | "reject") => void;
}

const RISK_STYLES: Record<string, string> = {
  high: "bg-red-500/10 text-red-600 border-red-500/30",
  medium: "bg-amber-500/10 text-amber-600 border-amber-500/30",
  low: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30",
};

export function ApprovalEvent({
  content,
  approvalId,
  details,
  risk,
  approvals,
  onRespond,
}: Props) {
  const match = approvals.find((a) => a.id === approvalId);
  const status = match?.status || "awaiting";
  const done = status !== "awaiting";

  return (
    <div className="ml-10 animate-fade-in">
      <div
        className={cn(
          "rounded-xl border shadow-sm",
          done
            ? status === "approved"
              ? "border-emerald-500/30 bg-emerald-500/5"
              : "border-[var(--border)] bg-[var(--card)] opacity-70"
            : "border-amber-500/40 bg-amber-500/[0.04]",
        )}
      >
        <div className="flex items-center gap-2 border-b border-[var(--border)] px-3.5 py-2">
          <ShieldAlert
            className={cn(
              "h-4 w-4",
              done ? "text-[var(--muted-foreground)]" : "text-amber-500",
            )}
            strokeWidth={1.75}
          />
          <span className="text-[12px] font-semibold">
            {done ? "Décision" : "Action à valider"}
          </span>
          {risk && (
            <span
              className={cn(
                "rounded border px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-wider",
                RISK_STYLES[risk] || "bg-[var(--muted)] text-[var(--muted-foreground)]",
              )}
            >
              {risk}
            </span>
          )}
          {done && (
            <span className="ml-auto rounded bg-[var(--muted)] px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-[var(--muted-foreground)]">
              {status}
            </span>
          )}
        </div>

        <div className="space-y-2 px-3.5 py-2.5 text-[13px]">
          <p className="font-medium text-[var(--foreground)]">{content}</p>
          {details && (
            <pre className="whitespace-pre-wrap rounded-md border border-[var(--border)] bg-[var(--muted)]/50 px-2.5 py-1.5 font-mono text-[11px] leading-relaxed">
              {details}
            </pre>
          )}
          {!done && (
            <div className="flex gap-2 pt-1">
              <button
                onClick={() => onRespond(approvalId, "approve")}
                className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-md bg-emerald-500 px-3 py-1.5 text-[12px] font-semibold text-white transition-colors hover:bg-emerald-600"
              >
                <Check className="h-3.5 w-3.5" strokeWidth={2.5} />
                Approuver
              </button>
              <button
                onClick={() => onRespond(approvalId, "reject")}
                className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-md border border-[var(--border)] bg-transparent px-3 py-1.5 text-[12px] font-semibold text-[var(--foreground)] transition-colors hover:bg-[var(--muted)]"
              >
                <X className="h-3.5 w-3.5" strokeWidth={2.5} />
                Rejeter
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
