import { Bot } from "lucide-react";
import { cn } from "@/lib/utils";

const LABELS: Record<string, string> = {
  running: "L'agent réfléchit",
  pending: "Mise en route",
  awaiting_approval: "En attente de votre validation",
};

export function StatusIndicator({ status }: { status: string }) {
  const label = LABELS[status];
  if (!label) return null;
  return (
    <div className="flex items-center gap-3 pl-0 animate-fade-in">
      <div
        className={cn(
          "flex h-7 w-7 shrink-0 items-center justify-center rounded-full",
          "bg-[var(--muted)] text-[var(--foreground)]",
        )}
      >
        <Bot className="h-3.5 w-3.5" strokeWidth={1.75} />
      </div>
      <div className="flex items-center gap-2 text-[12.5px]">
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
