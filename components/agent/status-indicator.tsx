import { cn } from "@/lib/utils";

const LABELS: Record<string, string> = {
  running: "Réflexion en cours",
  pending: "Mise en route",
  awaiting_approval: "En attente de votre validation",
};

export function StatusIndicator({ status }: { status: string }) {
  const label = LABELS[status];
  if (!label) return null;
  return (
    <div
      className={cn(
        "animate-fade-in border-l border-[var(--border)] pl-4",
        "text-[12.5px] text-[var(--muted-foreground)]",
      )}
    >
      <div className="flex items-center gap-2">
        <span className="agent-shimmer-text font-medium">{label}</span>
        <span className="flex items-center gap-0.5 text-[var(--muted-foreground)]">
          <span className="agent-dot" />
          <span className="agent-dot" />
          <span className="agent-dot" />
        </span>
      </div>
    </div>
  );
}
