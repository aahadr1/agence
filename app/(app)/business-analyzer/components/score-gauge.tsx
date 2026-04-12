"use client";

interface ScoreGaugeProps {
  score: number;
  label?: string;
  size?: "sm" | "md" | "lg";
}

export function ScoreGauge({ score, label = "Potential", size = "lg" }: ScoreGaugeProps) {
  const sizeConfig = {
    sm: { dim: 80, stroke: 6, fontSize: "text-lg", labelSize: "text-[9px]" },
    md: { dim: 120, stroke: 8, fontSize: "text-2xl", labelSize: "text-[10px]" },
    lg: { dim: 160, stroke: 10, fontSize: "text-4xl", labelSize: "text-[11px]" },
  };

  const { dim, stroke, fontSize, labelSize } = sizeConfig[size];
  const radius = (dim - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = Math.max(0, Math.min(100, score)) / 100;
  const dashOffset = circumference * (1 - progress);

  const getColor = (s: number) => {
    if (s >= 70) return { main: "#22c55e", bg: "rgba(34,197,94,0.12)" };
    if (s >= 40) return { main: "#f59e0b", bg: "rgba(245,158,11,0.12)" };
    return { main: "#ef4444", bg: "rgba(239,68,68,0.12)" };
  };

  const getLabel = (s: number) => {
    if (s >= 80) return "Excellent prospect";
    if (s >= 60) return "Strong potential";
    if (s >= 40) return "Moderate";
    if (s >= 20) return "Low potential";
    return "Minimal";
  };

  const colors = getColor(score);

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative" style={{ width: dim, height: dim }}>
        <svg
          width={dim}
          height={dim}
          className="-rotate-90"
          viewBox={`0 0 ${dim} ${dim}`}
        >
          <circle
            cx={dim / 2}
            cy={dim / 2}
            r={radius}
            fill="none"
            stroke="var(--border)"
            strokeWidth={stroke}
          />
          <circle
            cx={dim / 2}
            cy={dim / 2}
            r={radius}
            fill="none"
            stroke={colors.main}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
            className="transition-all duration-1000 ease-out"
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className={`${fontSize} font-display font-semibold tabular-nums`} style={{ color: colors.main }}>
            {score}
          </span>
          <span className={`${labelSize} font-medium uppercase tracking-[0.1em] text-muted-foreground`}>
            /100
          </span>
        </div>
      </div>
      <div className="text-center">
        <p className={`${labelSize} font-medium uppercase tracking-[0.15em] text-muted-foreground`}>
          {label}
        </p>
        <p className="mt-0.5 text-xs text-foreground">{getLabel(score)}</p>
      </div>
    </div>
  );
}
