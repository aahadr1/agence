"use client";

import {
  MoreHorizontal,
  Eye,
  MessageSquarePlus,
  ListPlus,
  CalendarPlus,
  Archive,
  Trash2,
  Trophy,
  XCircle,
} from "lucide-react";
import { useState, useRef, useEffect } from "react";

export type RowAction =
  | "view"
  | "edit"
  | "add-note"
  | "add-task"
  | "schedule-meeting"
  | "mark-won"
  | "mark-lost"
  | "archive"
  | "delete";

const ACTIONS: { id: RowAction; label: string; icon: React.ReactNode; destructive?: boolean }[] = [
  { id: "view", label: "View details", icon: <Eye className="h-3.5 w-3.5" /> },
  { id: "add-note", label: "Add note", icon: <MessageSquarePlus className="h-3.5 w-3.5" /> },
  { id: "add-task", label: "Add task", icon: <ListPlus className="h-3.5 w-3.5" /> },
  { id: "schedule-meeting", label: "Schedule meeting", icon: <CalendarPlus className="h-3.5 w-3.5" /> },
  { id: "mark-won", label: "Mark as won", icon: <Trophy className="h-3.5 w-3.5" /> },
  { id: "mark-lost", label: "Mark as lost", icon: <XCircle className="h-3.5 w-3.5" /> },
  { id: "archive", label: "Archive", icon: <Archive className="h-3.5 w-3.5" /> },
  { id: "delete", label: "Delete", icon: <Trash2 className="h-3.5 w-3.5" />, destructive: true },
];

export function ProspectRowActions({
  onAction,
}: {
  onAction: (action: RowAction) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(!open);
        }}
        className="flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-secondary hover:text-foreground"
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 min-w-[180px] rounded-[var(--radius)] border border-border bg-card p-1 shadow-lg">
          {ACTIONS.map((action) => (
            <button
              key={action.id}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setOpen(false);
                onAction(action.id);
              }}
              className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs transition-colors ${
                action.destructive
                  ? "text-destructive hover:bg-destructive/10"
                  : "text-foreground hover:bg-secondary/50"
              }`}
            >
              {action.icon}
              {action.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
