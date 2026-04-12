/** Pastel palette aligned with app `--blue` accent; distinct per event type. */

const TYPE_COLORS: Record<string, { bg: string; border: string }> = {
  prospect_call: { bg: "#dbeafe", border: "#60a5fa" },
  demo: { bg: "#ede9fe", border: "#a78bfa" },
  internal: { bg: "rgba(168, 207, 224, 0.35)", border: "#7eb8cf" },
  deadline: { bg: "#fee2e2", border: "#f87171" },
  focus_block: { bg: "#ecfccb", border: "#a3e635" },
  callback: { bg: "#fef3c7", border: "#fbbf24" },
  other: { bg: "#f1f5f9", border: "#94a3b8" },
};

export function eventTypeColors(eventType: string) {
  return TYPE_COLORS[eventType] ?? TYPE_COLORS.other;
}
