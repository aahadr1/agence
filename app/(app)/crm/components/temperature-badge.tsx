"use client";

import type { ProspectTemperature } from "@/lib/crm/types";

const TEMP_CONFIG: Record<ProspectTemperature, { label: string; color: string; bgClass: string }> = {
  hot: { label: "Hot", color: "#ef4444", bgClass: "bg-red-500/10" },
  warm: { label: "Warm", color: "#f59e0b", bgClass: "bg-amber-500/10" },
  cold: { label: "Cold", color: "#3b82f6", bgClass: "bg-blue-500/10" },
};

export function TemperatureBadge({ temperature }: { temperature: ProspectTemperature }) {
  const config = TEMP_CONFIG[temperature];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${config.bgClass}`}
      style={{ color: config.color }}
    >
      <span
        className="h-1.5 w-1.5 rounded-full"
        style={{ backgroundColor: config.color }}
      />
      {config.label}
    </span>
  );
}

export function TemperatureDot({ temperature }: { temperature: ProspectTemperature }) {
  const config = TEMP_CONFIG[temperature];
  return (
    <span
      className="inline-block h-2 w-2 rounded-full"
      style={{ backgroundColor: config.color }}
      title={config.label}
    />
  );
}
