"use client";

import { useEffect, useRef, useState } from "react";

interface LiquidShapeProps {
  className?: string;
  color?: string;
  size?: number;
  speed?: number;
  blur?: number;
}

export function LiquidShape({
  className = "",
  color = "var(--accent-warm)",
  size = 400,
  speed = 20,
  blur = 60,
}: LiquidShapeProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null;

  return (
    <div
      className={`absolute pointer-events-none ${className}`}
      style={{
        width: size,
        height: size,
        background: color,
        filter: `blur(${blur}px)`,
        opacity: 0.4,
        animation: `liquidMorph ${speed}s ease-in-out infinite`,
      }}
    />
  );
}

interface GradientOrbProps {
  className?: string;
  colors?: string[];
  size?: number;
  blur?: number;
  speed?: number;
}

export function GradientOrb({
  className = "",
  colors = ["var(--accent-warm)", "var(--accent)"],
  size = 500,
  blur = 80,
  speed = 15,
}: GradientOrbProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null;

  return (
    <div
      className={`absolute pointer-events-none ${className}`}
      style={{
        width: size,
        height: size,
        background: `radial-gradient(circle, ${colors[0]} 0%, ${colors[1]} 50%, transparent 70%)`,
        filter: `blur(${blur}px)`,
        opacity: 0.3,
        animation: `floatOrb ${speed}s ease-in-out infinite`,
      }}
    >
      <style jsx>{`
        @keyframes floatOrb {
          0%, 100% {
            transform: translate(0, 0) scale(1);
          }
          25% {
            transform: translate(30px, -40px) scale(1.05);
          }
          50% {
            transform: translate(-20px, -20px) scale(0.95);
          }
          75% {
            transform: translate(40px, 20px) scale(1.02);
          }
        }
      `}</style>
    </div>
  );
}

interface AnimatedBlobProps {
  className?: string;
  color?: string;
}

export function AnimatedBlob({ className = "", color = "var(--accent-warm)" }: AnimatedBlobProps) {
  return (
    <svg
      viewBox="0 0 200 200"
      className={`absolute pointer-events-none ${className}`}
      style={{ opacity: 0.15 }}
    >
      <defs>
        <filter id="goo">
          <feGaussianBlur in="SourceGraphic" stdDeviation="10" result="blur" />
          <feColorMatrix
            in="blur"
            mode="matrix"
            values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 18 -8"
            result="goo"
          />
        </filter>
      </defs>
      <g filter="url(#goo)">
        <circle cx="100" cy="100" r="50" fill={color}>
          <animate
            attributeName="cx"
            values="100;80;120;100"
            dur="8s"
            repeatCount="indefinite"
          />
          <animate
            attributeName="cy"
            values="100;120;80;100"
            dur="8s"
            repeatCount="indefinite"
          />
        </circle>
        <circle cx="140" cy="100" r="35" fill={color}>
          <animate
            attributeName="cx"
            values="140;160;120;140"
            dur="6s"
            repeatCount="indefinite"
          />
          <animate
            attributeName="cy"
            values="100;80;120;100"
            dur="6s"
            repeatCount="indefinite"
          />
        </circle>
        <circle cx="60" cy="100" r="30" fill={color}>
          <animate
            attributeName="cx"
            values="60;80;40;60"
            dur="7s"
            repeatCount="indefinite"
          />
          <animate
            attributeName="cy"
            values="100;60;130;100"
            dur="7s"
            repeatCount="indefinite"
          />
        </circle>
      </g>
    </svg>
  );
}

interface FlowingLinesProps {
  className?: string;
  color?: string;
}

export function FlowingLines({ className = "", color = "var(--accent-warm)" }: FlowingLinesProps) {
  return (
    <svg
      viewBox="0 0 1000 200"
      className={`absolute pointer-events-none ${className}`}
      preserveAspectRatio="none"
    >
      <path
        d="M0,100 Q250,50 500,100 T1000,100"
        fill="none"
        stroke={color}
        strokeWidth="1"
        opacity="0.3"
      >
        <animate
          attributeName="d"
          values="
            M0,100 Q250,50 500,100 T1000,100;
            M0,100 Q250,150 500,100 T1000,100;
            M0,100 Q250,50 500,100 T1000,100
          "
          dur="10s"
          repeatCount="indefinite"
        />
      </path>
      <path
        d="M0,120 Q250,70 500,120 T1000,120"
        fill="none"
        stroke={color}
        strokeWidth="0.5"
        opacity="0.2"
      >
        <animate
          attributeName="d"
          values="
            M0,120 Q250,70 500,120 T1000,120;
            M0,120 Q250,170 500,120 T1000,120;
            M0,120 Q250,70 500,120 T1000,120
          "
          dur="12s"
          repeatCount="indefinite"
        />
      </path>
      <path
        d="M0,80 Q250,30 500,80 T1000,80"
        fill="none"
        stroke={color}
        strokeWidth="0.5"
        opacity="0.2"
      >
        <animate
          attributeName="d"
          values="
            M0,80 Q250,30 500,80 T1000,80;
            M0,80 Q250,130 500,80 T1000,80;
            M0,80 Q250,30 500,80 T1000,80
          "
          dur="8s"
          repeatCount="indefinite"
        />
      </path>
    </svg>
  );
}
