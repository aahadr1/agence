"use client";

import { useEffect, useState } from "react";

export function PageLoader() {
  const [isLoading, setIsLoading] = useState(true);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 100) {
          clearInterval(interval);
          setTimeout(() => setIsLoading(false), 500);
          return 100;
        }
        return prev + Math.random() * 15;
      });
    }, 100);

    return () => clearInterval(interval);
  }, []);

  if (!isLoading) return null;

  return (
    <div
      className="fixed inset-0 z-[9999] bg-ink flex items-center justify-center"
      style={{
        opacity: progress >= 100 ? 0 : 1,
        pointerEvents: progress >= 100 ? "none" : "auto",
        transition: "opacity 0.8s cubic-bezier(0.16, 1, 0.3, 1)",
      }}
    >
      <div className="text-center">
        {/* Logo animation */}
        <div className="relative mb-8">
          <span 
            className="font-display text-6xl text-cream"
            style={{
              opacity: progress > 20 ? 1 : 0,
              transform: progress > 20 ? "translateY(0)" : "translateY(20px)",
              transition: "all 0.8s cubic-bezier(0.16, 1, 0.3, 1)",
            }}
          >
            L
          </span>
          <span 
            className="font-display text-6xl text-terracotta"
            style={{
              opacity: progress > 40 ? 1 : 0,
              transform: progress > 40 ? "translateY(0)" : "translateY(20px)",
              transition: "all 0.8s cubic-bezier(0.16, 1, 0.3, 1)",
            }}
          >
            H
          </span>
        </div>
        
        {/* Progress bar */}
        <div className="w-48 h-px bg-cream/10 mx-auto overflow-hidden">
          <div
            className="h-full bg-terracotta"
            style={{
              width: `${Math.min(progress, 100)}%`,
              transition: "width 0.1s ease-out",
            }}
          />
        </div>
      </div>
    </div>
  );
}
