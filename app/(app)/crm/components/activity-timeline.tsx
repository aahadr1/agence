"use client";

import type { CrmActivity, CrmActivityType } from "@/lib/crm/types";
import { EmptyState } from "./empty-state";
import {
  MessageSquare,
  Phone,
  Calendar,
  Mail,
  Cog,
  ArrowRight,
  Send,
} from "lucide-react";
import { useState } from "react";

const ACTIVITY_ICONS: Record<CrmActivityType, React.ReactNode> = {
  note: <MessageSquare className="h-3.5 w-3.5" />,
  call: <Phone className="h-3.5 w-3.5" />,
  meeting: <Calendar className="h-3.5 w-3.5" />,
  email: <Mail className="h-3.5 w-3.5" />,
  system: <Cog className="h-3.5 w-3.5" />,
  stage_change: <ArrowRight className="h-3.5 w-3.5" />,
};

const ACTIVITY_COLORS: Record<CrmActivityType, string> = {
  note: "#57534e",
  call: "#22c55e",
  meeting: "#a78bfa",
  email: "#f59e0b",
  system: "#64748b",
  stage_change: "#f97316",
};

const ACTIVITY_TYPE_OPTIONS: { value: CrmActivityType; label: string }[] = [
  { value: "note", label: "Note" },
  { value: "call", label: "Call" },
  { value: "meeting", label: "Meeting" },
  { value: "email", label: "Email" },
];

function formatTimestamp(date: string) {
  const d = new Date(date);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const days = Math.floor(diff / 86_400_000);

  if (days === 0) {
    return `Today at ${d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`;
  }
  if (days === 1) {
    return `Yesterday at ${d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`;
  }
  return d.toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "short",
    year: days > 365 ? "numeric" : undefined,
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function ActivityTimeline({
  activities,
  opportunityId,
  onActivityAdded,
}: {
  activities: CrmActivity[];
  opportunityId: string;
  onActivityAdded: () => void;
}) {
  const [body, setBody] = useState("");
  const [type, setType] = useState<CrmActivityType>("note");
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!body.trim()) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/crm/v2/opportunities/${opportunityId}/activities`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, body: body.trim() }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to add activity");
      }
      setBody("");
      onActivityAdded();
    } catch {
      // silently fail, user sees the note didn't appear
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      {/* Composer */}
      <form onSubmit={handleSubmit} className="mb-5">
        <div className="rounded-[var(--radius)] border border-border bg-card">
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Add a note, log a call, or record an interaction..."
            className="w-full resize-none border-none bg-transparent px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
            rows={3}
          />
          <div className="flex items-center justify-between border-t border-border px-3 py-2">
            <div className="flex gap-1">
              {ACTIVITY_TYPE_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setType(opt.value)}
                  className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors ${
                    type === opt.value
                      ? "bg-foreground text-primary-foreground"
                      : "text-muted-foreground hover:bg-secondary"
                  }`}
                >
                  {ACTIVITY_ICONS[opt.value]}
                  {opt.label}
                </button>
              ))}
            </div>
            <button
              type="submit"
              disabled={saving || !body.trim()}
              className="flex items-center gap-1 rounded-[var(--radius)] bg-foreground px-2.5 py-1 text-xs font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              <Send className="h-3 w-3" />
              {saving ? "Saving..." : "Save"}
            </button>
          </div>
        </div>
      </form>

      {/* Timeline */}
      {activities.length === 0 ? (
        <EmptyState variant="no-activities" />
      ) : (
        <div className="relative">
          <div className="absolute left-[15px] top-0 bottom-0 w-px bg-border" />
          <div className="space-y-4">
            {activities.map((activity) => (
              <div key={activity.id} className="relative flex gap-3 pl-0">
                <div
                  className="relative z-10 flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full border border-border bg-card"
                  style={{ color: ACTIVITY_COLORS[activity.type] }}
                >
                  {ACTIVITY_ICONS[activity.type]}
                </div>
                <div className="flex-1 pt-0.5">
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-semibold capitalize text-foreground">
                      {activity.type.replace("_", " ")}
                    </span>
                    <span className="text-[10px] text-muted-foreground">
                      {formatTimestamp(activity.happened_at)}
                    </span>
                  </div>
                  {activity.body && (
                    <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed text-foreground/80">
                      {activity.body}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
