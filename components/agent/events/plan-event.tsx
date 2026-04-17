import { Route } from "lucide-react";
import { Markdown } from "../markdown";

export function PlanEvent({ content }: { content: string }) {
  return (
    <div className="ml-10 animate-fade-in">
      <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] px-3.5 py-2.5">
        <div className="mb-1.5 flex items-center gap-2">
          <Route className="h-3.5 w-3.5 text-[var(--blue)]" strokeWidth={1.75} />
          <span className="text-[11.5px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
            Plan
          </span>
        </div>
        <Markdown content={content} compact />
      </div>
    </div>
  );
}
