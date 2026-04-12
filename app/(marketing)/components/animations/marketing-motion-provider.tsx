"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

type MarketingMotionContextValue = {
  reducedMotion: boolean;
};

const defaultValue: MarketingMotionContextValue = {
  reducedMotion: false,
};

const MarketingMotionContext =
  createContext<MarketingMotionContextValue>(defaultValue);

export function useMarketingMotion() {
  return useContext(MarketingMotionContext);
}

/**
 * Single pointer + rAF time source for marketing ambience and proximity.
 */
export function MarketingMotionProvider({ children }: { children: ReactNode }) {
  const [reducedMotion, setReducedMotion] = useState(false);
  const atmoRafRef = useRef<number>(0);
  const startRef = useRef<number | null>(null);
  const ptrRafRef = useRef<number>(0);
  const ptrRef = useRef({ nx: 0.5, ny: 0.5 });
  const ptrFlushPending = useRef(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setReducedMotion(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  const flushPointer = useCallback(() => {
    ptrFlushPending.current = false;
    ptrRafRef.current = 0;
    if (reducedMotion) return;
    const { nx, ny } = ptrRef.current;
    const root = document.documentElement;
    root.style.setProperty("--marketing-ptr-x", nx.toFixed(4));
    root.style.setProperty("--marketing-ptr-y", ny.toFixed(4));
  }, [reducedMotion]);

  const onPointerMove = useCallback(
    (e: PointerEvent) => {
      if (reducedMotion) return;
      ptrRef.current = {
        nx: e.clientX / Math.max(window.innerWidth, 1),
        ny: e.clientY / Math.max(window.innerHeight, 1),
      };
      if (ptrFlushPending.current) return;
      ptrFlushPending.current = true;
      ptrRafRef.current = requestAnimationFrame(flushPointer);
    },
    [reducedMotion, flushPointer]
  );

  useEffect(() => {
    if (reducedMotion) {
      document.documentElement.style.removeProperty("--marketing-ptr-x");
      document.documentElement.style.removeProperty("--marketing-ptr-y");
      document.documentElement.style.removeProperty("--marketing-atmo-t");
      if (atmoRafRef.current) cancelAnimationFrame(atmoRafRef.current);
      if (ptrRafRef.current) cancelAnimationFrame(ptrRafRef.current);
      ptrFlushPending.current = false;
      return;
    }

    const tick = (t: number) => {
      if (startRef.current === null) startRef.current = t;
      const elapsed = (t - startRef.current) / 1000;
      const phase = (Math.sin(elapsed * 0.35) + 1) * 0.5;
      document.documentElement.style.setProperty(
        "--marketing-atmo-t",
        phase.toFixed(4)
      );
      atmoRafRef.current = requestAnimationFrame(tick);
    };
    atmoRafRef.current = requestAnimationFrame(tick);
    return () => {
      if (atmoRafRef.current) cancelAnimationFrame(atmoRafRef.current);
      if (ptrRafRef.current) cancelAnimationFrame(ptrRafRef.current);
      ptrFlushPending.current = false;
      document.documentElement.style.removeProperty("--marketing-atmo-t");
      startRef.current = null;
    };
  }, [reducedMotion]);

  useEffect(() => {
    if (reducedMotion) return;
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    return () => window.removeEventListener("pointermove", onPointerMove);
  }, [onPointerMove, reducedMotion]);

  const value = useMemo(() => ({ reducedMotion }), [reducedMotion]);

  return (
    <MarketingMotionContext.Provider value={value}>
      {children}
    </MarketingMotionContext.Provider>
  );
}
