"use client";

import { Inbox, Search, ListTodo, MessageSquare } from "lucide-react";
import type { ReactNode } from "react";

type EmptyVariant = "no-prospects" | "no-results" | "no-activities" | "no-tasks";

const variants: Record<EmptyVariant, { icon: ReactNode; title: string; description: string }> = {
  "no-prospects": {
    icon: <Inbox className="h-10 w-10" strokeWidth={1} />,
    title: "No prospects yet",
    description: "Create your first prospect to start tracking your pipeline.",
  },
  "no-results": {
    icon: <Search className="h-10 w-10" strokeWidth={1} />,
    title: "No results found",
    description: "Try adjusting your filters or search query.",
  },
  "no-activities": {
    icon: <MessageSquare className="h-10 w-10" strokeWidth={1} />,
    title: "No activity yet",
    description: "Add a note, log a call, or schedule a meeting to get started.",
  },
  "no-tasks": {
    icon: <ListTodo className="h-10 w-10" strokeWidth={1} />,
    title: "No tasks yet",
    description: "Create a follow-up task to stay on top of this prospect.",
  },
};

export function EmptyState({
  variant,
  action,
}: {
  variant: EmptyVariant;
  action?: ReactNode;
}) {
  const config = variants[variant];
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="text-muted-foreground/40">{config.icon}</div>
      <h3 className="mt-4 text-sm font-semibold text-foreground">{config.title}</h3>
      <p className="mt-1 max-w-xs text-xs text-muted-foreground">{config.description}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
