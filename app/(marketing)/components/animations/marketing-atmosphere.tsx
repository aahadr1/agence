"use client";

import { useMarketingMotion } from "./marketing-motion-provider";

/**
 * Full-viewport subtle field. No CSS transitions on pointer-driven layers (they fight rAF/CSS vars and cause jank).
 */
export function MarketingAtmosphere() {
  const { reducedMotion } = useMarketingMotion();

  if (reducedMotion) return null;

  return (
    <div
      className="marketing-atmosphere pointer-events-none fixed inset-0 z-[1] overflow-hidden"
      style={{
        contain: "strict",
        isolation: "isolate",
      }}
      aria-hidden
    >
      <div
        className="absolute inset-[-8%] opacity-[0.04] dark:opacity-[0.055]"
        style={{
          backgroundImage: `
            linear-gradient(to right, var(--border-medium) 1px, transparent 1px),
            linear-gradient(to bottom, var(--border-medium) 1px, transparent 1px)
          `,
          backgroundSize: "80px 80px",
          transform:
            "translate3d(calc((var(--marketing-ptr-x, 0.5) - 0.5) * 12px), calc((var(--marketing-ptr-y, 0.5) - 0.5) * 12px), 0) rotate(calc((var(--marketing-atmo-t, 0) - 0.25) * 1deg))",
        }}
      />
      <div
        className="absolute inset-0 opacity-[0.28] dark:opacity-[0.16]"
        style={{
          background: `
            radial-gradient(ellipse 85% 65% at calc(var(--marketing-ptr-x, 0.5) * 100%) calc(var(--marketing-ptr-y, 0.5) * 100%),
              var(--accent-glow) 0%,
              transparent 55%),
            radial-gradient(ellipse 70% 50% at calc((1 - var(--marketing-ptr-x, 0.5)) * 100%) calc((1 - var(--marketing-ptr-y, 0.5)) * 100%),
              var(--accent-warm-glow) 0%,
              transparent 50%)
          `,
          mixBlendMode: "soft-light",
        }}
      />
    </div>
  );
}
