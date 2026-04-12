"use client";

import { useRef, useEffect, useCallback } from "react";

interface MagneticOptions {
  strength?: number;
  ease?: number;
  maxDistance?: number;
}

export function useMagnetic<T extends HTMLElement>(options: MagneticOptions = {}) {
  const { strength = 0.3, ease = 0.15, maxDistance = 100 } = options;
  const ref = useRef<T>(null);
  const position = useRef({ x: 0, y: 0 });
  const target = useRef({ x: 0, y: 0 });
  const animationFrame = useRef<number | undefined>(undefined);

  const lerp = (start: number, end: number, factor: number) => {
    return start + (end - start) * factor;
  };

  const animate = useCallback(() => {
    if (!ref.current) return;

    position.current.x = lerp(position.current.x, target.current.x, ease);
    position.current.y = lerp(position.current.y, target.current.y, ease);

    ref.current.style.transform = `translate3d(${position.current.x}px, ${position.current.y}px, 0)`;

    if (
      Math.abs(position.current.x - target.current.x) > 0.1 ||
      Math.abs(position.current.y - target.current.y) > 0.1
    ) {
      animationFrame.current = requestAnimationFrame(animate);
    }
  }, [ease]);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const handleMouseMove = (e: MouseEvent) => {
      const rect = element.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;

      const distanceX = e.clientX - centerX;
      const distanceY = e.clientY - centerY;
      const distance = Math.sqrt(distanceX * distanceX + distanceY * distanceY);

      if (distance < maxDistance) {
        const factor = 1 - distance / maxDistance;
        target.current.x = distanceX * strength * factor;
        target.current.y = distanceY * strength * factor;
      } else {
        target.current.x = 0;
        target.current.y = 0;
      }

      if (animationFrame.current) {
        cancelAnimationFrame(animationFrame.current);
      }
      animationFrame.current = requestAnimationFrame(animate);
    };

    const handleMouseLeave = () => {
      target.current.x = 0;
      target.current.y = 0;
      if (animationFrame.current) {
        cancelAnimationFrame(animationFrame.current);
      }
      animationFrame.current = requestAnimationFrame(animate);
    };

    element.addEventListener("mousemove", handleMouseMove);
    element.addEventListener("mouseleave", handleMouseLeave);

    return () => {
      element.removeEventListener("mousemove", handleMouseMove);
      element.removeEventListener("mouseleave", handleMouseLeave);
      if (animationFrame.current) {
        cancelAnimationFrame(animationFrame.current);
      }
    };
  }, [strength, maxDistance, animate]);

  return ref;
}
