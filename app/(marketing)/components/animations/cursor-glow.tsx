"use client";

import { useEffect, useRef, useState, useCallback } from "react";

export function CursorGlow() {
  const [reducedMotion, setReducedMotion] = useState(false);
  const mainRef = useRef<HTMLDivElement>(null);
  const trailRef = useRef<HTMLDivElement>(null);
  const dotRef = useRef<HTMLDivElement>(null);
  const pos = useRef({ x: 0, y: 0 });
  const hoverRef = useRef(false);
  const visibleRef = useRef(false);
  const rafRef = useRef(0);

  const paint = useCallback(() => {
    rafRef.current = 0;
    const { x, y } = pos.current;
    const t = `translate3d(${x}px, ${y}px, 0)`;
    if (mainRef.current) mainRef.current.style.transform = t;
    if (trailRef.current) trailRef.current.style.transform = t;
  }, []);

  const schedule = useCallback(() => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(paint);
  }, [paint]);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const applyMotion = () => setReducedMotion(mq.matches);
    applyMotion();
    mq.addEventListener("change", applyMotion);
    return () => mq.removeEventListener("change", applyMotion);
  }, []);

  useEffect(() => {
    if (reducedMotion) return;

    const onMove = (e: MouseEvent) => {
      pos.current = { x: e.clientX, y: e.clientY };
      if (!visibleRef.current) {
        visibleRef.current = true;
        if (mainRef.current) mainRef.current.style.opacity = "1";
        if (trailRef.current) trailRef.current.style.opacity = "0.12";
      }

      const el = document.elementFromPoint(e.clientX, e.clientY);
      const nextHover = !!el?.closest(
        "a,button,[role='button'],.magnetic,.interactive"
      );
      if (nextHover !== hoverRef.current) {
        hoverRef.current = nextHover;
        const size = nextHover ? 56 : 20;
        if (dotRef.current) {
          dotRef.current.style.width = `${size}px`;
          dotRef.current.style.height = `${size}px`;
        }
      }
      schedule();
    };

    const onLeave = () => {
      visibleRef.current = false;
      hoverRef.current = false;
      if (mainRef.current) mainRef.current.style.opacity = "0";
      if (trailRef.current) trailRef.current.style.opacity = "0";
      if (dotRef.current) {
        dotRef.current.style.width = "20px";
        dotRef.current.style.height = "20px";
      }
    };

    window.addEventListener("mousemove", onMove, { passive: true });
    window.addEventListener("mouseleave", onLeave);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseleave", onLeave);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [reducedMotion, schedule]);

  if (typeof window === "undefined" || reducedMotion) return null;

  return (
    <>
      <div
        ref={mainRef}
        className="pointer-events-none fixed left-0 top-0 z-[9998] hidden mix-blend-difference lg:block"
        style={{ opacity: 0, willChange: "transform, opacity" }}
      >
        <div className="-translate-x-1/2 -translate-y-1/2">
          <div
            ref={dotRef}
            className="rounded-full bg-cream"
            style={{
              width: 20,
              height: 20,
              transition:
                "width 0.22s cubic-bezier(0.16, 1, 0.3, 1), height 0.22s cubic-bezier(0.16, 1, 0.3, 1)",
            }}
          />
        </div>
      </div>

      <div
        ref={trailRef}
        className="pointer-events-none fixed left-0 top-0 z-[9997] hidden lg:block"
        style={{ opacity: 0, willChange: "transform, opacity" }}
      >
        <div
          className="-translate-x-1/2 -translate-y-1/2 rounded-full"
          style={{
            width: 240,
            height: 240,
            background:
              "radial-gradient(circle, var(--accent-warm) 0%, transparent 68%)",
            filter: "blur(28px)",
          }}
        />
      </div>
    </>
  );
}
