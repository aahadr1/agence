"use client";

import {
  Menu,
  Bot,
  Coins,
  Circle,
  Pause,
  Play,
  CheckCircle2,
  AlertCircle,
  ShieldQuestion,
  Clock,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { Session } from "./types";

interface Props {
  session: Session | null;
  onToggleRail: () => void;
}

const STATUS_META: Record<
  string,
  { label: string; icon: typeof Circle; className: string }
> = {
  running: {
    label: "En cours",
    icon: Play,
    className: "text-emerald-600 bg-emerald-500/10 border-emerald-500/30",
  },
  pending: {
    label: "En attente",
    icon: Clock,
    className: "text-amber-600 bg-amber-500/10 border-amber-500/30",
  },
  awaiting_approval: {
    label: "Validation requise",
    icon: ShieldQuestion,
    className: "text-amber-600 bg-amber-500/10 border-amber-500/30",
  },
  paused: {
    label: "En pause",
    icon: Pause,
    className: "text-[var(--muted-foreground)] bg-[var(--muted)] border-[var(--border)]",
  },
  completed: {
    label: "Terminé",
    icon: CheckCircle2,
    className: "text-emerald-600 bg-emerald-500/10 border-emerald-500/30",
  },
  failed: {
    label: "Échec",
    icon: AlertCircle,
    className: "text-red-600 bg-red-500/10 border-red-500/30",
  },
};

export function AgentHeader({ session, onToggleRail }: Props) {
  const meta = session ? STATUS_META[session.status] : null;
  const Icon = meta?.icon;

  return (
    <header
      className={cn(
        "flex items-center gap-3 border-b border-[var(--border)] bg-[var(--background)]/90",
        "backdrop-blur-md px-3 py-2.5 lg:px-5",
      )}
    >
      <button
        onClick={onToggleRail}
        className="inline-flex h-8 w-8 items-center justify-center rounded-md text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)] lg:hidden"
      >
        <Menu className="h-4 w-4" />
      </button>

      <div className="min-w-0 flex-1">
        {session ? (
          <>
            <p className="line-clamp-1 text-[13px] font-medium">
              {session.title || "Sans titre"}
            </p>
            <p className="mt-0.5 flex items-center gap-2 text-[11px] text-[var(--muted-foreground)]">
              <Bot className="h-3 w-3" strokeWidth={1.75} />
              <span className="font-mono">{session.model}</span>
              {session.capability_packs?.length > 0 && (
                <>
                  <span>·</span>
                  <span>{session.capability_packs.join(", ")}</span>
                </>
              )}
            </p>
          </>
        ) : (
          <>
            <p className="text-[13px] font-medium">Nouvelle session</p>
            <p className="text-[11px] text-[var(--muted-foreground)]">
              Décrivez votre objectif
            </p>
          </>
        )}
      </div>

      {session && (
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--card)] px-2 py-0.5 text-[11px] text-[var(--muted-foreground)]">
            <Coins className="h-3 w-3" />
            <span className="font-mono">
              {((session.cost_cents || 0) / 100).toFixed(2)} €
            </span>
          </span>
          {meta && Icon && (
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium",
                meta.className,
              )}
            >
              <Icon
                className={cn(
                  "h-3 w-3",
                  session.status === "running" && "animate-pulse",
                )}
              />
              {meta.label}
            </span>
          )}
        </div>
      )}
    </header>
  );
}
