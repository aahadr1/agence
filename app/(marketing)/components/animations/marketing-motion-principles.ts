/**
 * Marketing motion contract — "réactif & rare"
 *
 * - Prefer continuous, pointer-driven or time-based ambience over scroll-as-progress UI
 *   (no decorative scroll bars, generic multi-layer parallax, or repeated viewport reveals as the hero effect).
 * - Keep amplitudes low; one atmosphere layer + targeted living surfaces beats many small animations.
 * - Always respect `prefers-reduced-motion` (see globals.css and MarketingMotionProvider).
 *
 * Provider sets CSS vars on documentElement: --marketing-ptr-x, --marketing-ptr-y, --marketing-atmo-t (no pointer in React state, for perf).
 */

export const MARKETING_MOTION_PRINCIPLES = [
  "Reactive during exploration (pointer + slow time), not scroll-percent dashboards.",
  "Signature effects in few places; the rest stays calm.",
  "Honor prefers-reduced-motion: pause atmosphere, drift, and variable-font motion.",
] as const;

export function usePrefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
