"use client";

import { useId } from "react";

/**
 * « LÀHAUT » en SVG + linearGradient sur le fill — grand format, pleine largeur.
 */
export function LahautSplitWatermark({
  visible,
  transitionDelay = "0s",
  className = "",
}: {
  visible: boolean;
  transitionDelay?: string;
  className?: string;
}) {
  const reactId = useId();
  const gradId = `lahaut-grad-${reactId.replace(/[^a-zA-Z0-9_-]/g, "_")}`;

  return (
    <div
      className={`flex w-full justify-center overflow-hidden leading-none ${className}`}
      style={{
        opacity: visible ? 1 : 0,
        transition: "opacity 1.5s ease",
        transitionDelay,
      }}
      aria-hidden
    >
      <svg
        className="w-full min-w-full h-auto block"
        viewBox="0 0 1200 340"
        preserveAspectRatio="xMidYMax meet"
        role="presentation"
      >
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1" gradientUnits="objectBoundingBox">
            <stop offset="0%" stopColor="rgba(240, 235, 226, 0.14)" />
            <stop offset="50%" stopColor="rgba(240, 235, 226, 0.14)" />
            <stop offset="50%" stopColor="rgba(198, 195, 188, 0.52)" />
            <stop offset="100%" stopColor="rgba(198, 195, 188, 0.52)" />
          </linearGradient>
        </defs>
        <text
          x="600"
          y="308"
          textAnchor="middle"
          dominantBaseline="alphabetic"
          fill={`url(#${gradId})`}
          style={{
            fontFamily: "var(--font-fraunces), Georgia, 'Times New Roman', serif",
            fontSize: "248px",
            fontWeight: 400,
            letterSpacing: "-0.035em",
          }}
        >
          LÀHAUT
        </text>
      </svg>
    </div>
  );
}
