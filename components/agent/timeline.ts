import type {
  Message,
  Reflection,
  TimelineEvent,
} from "./types";

/**
 * Merge raw `agent_messages` + `agent_reflections` rows into a single,
 * chronologically-sorted stream of rendered events.
 *
 * Key rules:
 * - `system` rows with `metadata.nudge = true` become visible "course-correction" events.
 * - Other `system` rows carry tool traces → rendered as compact `tool` chips,
 *   but only if they carry a useful tag in metadata (no tag → skipped).
 * - `assistant` rows with `metadata.kind = 'ask_user'` are tagged so the
 *   renderer can surface suggested options.
 * - `thinking` rows render as collapsible inline blocks.
 */
export function buildTimeline(
  messages: Message[],
  reflections: Reflection[],
  options?: { includeReflections?: boolean },
): TimelineEvent[] {
  const includeReflections = options?.includeReflections === true;
  const events: TimelineEvent[] = [];

  for (const m of messages) {
    switch (m.role) {
      case "user":
        events.push({
          kind: "user",
          id: m.id,
          content: m.content,
          at: m.created_at,
        });
        break;

      case "assistant":
      case "plan":
        events.push({
          kind: m.role === "plan" ? "plan" : "assistant",
          id: m.id,
          content: m.content,
          at: m.created_at,
          metadata: m.metadata ?? undefined,
        });
        break;

      case "error":
        events.push({
          kind: "error",
          id: m.id,
          content: m.content,
          at: m.created_at,
        });
        break;

      case "approval_request": {
        const meta = (m.metadata || {}) as Record<string, unknown>;
        const approval_id = (meta.approval_id as string | undefined) || "";
        if (!approval_id) break;
        events.push({
          kind: "approval_request",
          id: m.id,
          content: m.content,
          at: m.created_at,
          approval_id,
          details: meta.details as string | undefined,
          risk: meta.risk as "low" | "medium" | "high" | undefined,
        });
        break;
      }

      case "approval_response":
        events.push({
          kind: "approval_response",
          id: m.id,
          content: m.content,
          at: m.created_at,
        });
        break;

      case "thinking":
        if (m.content?.trim()) {
          events.push({
            kind: "thinking",
            id: m.id,
            content: m.content,
            at: m.created_at,
          });
        }
        break;

      case "system": {
        const meta = (m.metadata || {}) as Record<string, unknown>;
        if (meta.nudge) {
          events.push({
            kind: "nudge",
            id: m.id,
            content: m.content,
            at: m.created_at,
            reason: (meta.reason as string) || "course_correction",
          });
          break;
        }
        // Tool traces: only show the result rows (with `duration_ms` or
        // `error` in metadata). Skip the noisy "→ toolname" call rows.
        const hasResult =
          typeof meta.duration_ms !== "undefined" ||
          typeof meta.error !== "undefined";
        if ((meta.tool || meta.kind === "tool") && hasResult) {
          const status = meta.error ? "error" : "ok";
          events.push({
            kind: "tool",
            id: m.id,
            content: m.content,
            at: m.created_at,
            tool: meta.tool as string | undefined,
            status,
          });
        }
        // otherwise skip — silent/internal trace
        break;
      }
    }
  }

  if (includeReflections) {
    for (const r of reflections) {
      events.push({
        kind: "reflection",
        id: r.id,
        iteration: r.iteration,
        observation: r.observation,
        conclusion: r.conclusion,
        next_action: r.next_action,
        at: r.created_at,
      });
    }
  }

  events.sort((a, b) => a.at.localeCompare(b.at));
  return events;
}

/** Group consecutive events of the same kind+author (unused today but handy). */
export function formatRelativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diff = Date.now() - then;
  const s = Math.max(1, Math.floor(diff / 1000));
  if (s < 60) return `il y a ${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `il y a ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `il y a ${h} h`;
  const d = Math.floor(h / 24);
  return `il y a ${d} j`;
}
