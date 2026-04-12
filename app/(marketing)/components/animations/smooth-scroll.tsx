"use client";

import { useEffect, useRef, ReactNode } from "react";

interface SmoothScrollProviderProps {
  children: ReactNode;
}

export function SmoothScrollProvider({ children }: SmoothScrollProviderProps) {
  return <>{children}</>;
}

export function useScrollVelocity() {
  const velocity = useRef(0);
  const lastScrollY = useRef(0);
  const lastTime = useRef(Date.now());

  useEffect(() => {
    const handleScroll = () => {
      const now = Date.now();
      const deltaTime = now - lastTime.current;
      const deltaY = window.scrollY - lastScrollY.current;
      
      if (deltaTime > 0) {
        velocity.current = deltaY / deltaTime;
      }
      
      lastScrollY.current = window.scrollY;
      lastTime.current = now;
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  return velocity;
}

interface SectionTransitionProps {
  children: ReactNode;
  className?: string;
}

export function SectionTransition({ children, className = "" }: SectionTransitionProps) {
  const sectionRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const section = sectionRef.current;
    if (!section) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            section.style.opacity = "1";
            section.style.transform = "translateY(0)";
          }
        });
      },
      { threshold: 0.1 }
    );

    observer.observe(section);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={sectionRef}
      className={className}
      style={{
        opacity: 0,
        transform: "translateY(40px)",
        transition: "opacity 1.2s cubic-bezier(0.16, 1, 0.3, 1), transform 1.2s cubic-bezier(0.16, 1, 0.3, 1)",
      }}
    >
      {children}
    </div>
  );
}
