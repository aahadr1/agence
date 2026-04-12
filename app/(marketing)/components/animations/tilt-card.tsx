"use client";

import { useRef, useState, useEffect, ReactNode } from "react";

interface TiltCardProps {
  children: ReactNode;
  className?: string;
  tiltAmount?: number;
  glareOpacity?: number;
  scale?: number;
  perspective?: number;
  transitionDuration?: number;
}

export function TiltCard({
  children,
  className = "",
  tiltAmount = 15,
  glareOpacity = 0.15,
  scale = 1.02,
  perspective = 1000,
  transitionDuration = 400,
}: TiltCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [transform, setTransform] = useState({
    rotateX: 0,
    rotateY: 0,
    scale: 1,
  });
  const [glarePosition, setGlarePosition] = useState({ x: 50, y: 50 });
  const [isHovered, setIsHovered] = useState(false);

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!cardRef.current) return;

    const rect = cardRef.current.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const mouseX = e.clientX - centerX;
    const mouseY = e.clientY - centerY;

    const rotateX = (mouseY / (rect.height / 2)) * -tiltAmount;
    const rotateY = (mouseX / (rect.width / 2)) * tiltAmount;

    setTransform({
      rotateX,
      rotateY,
      scale,
    });

    const glareX = ((e.clientX - rect.left) / rect.width) * 100;
    const glareY = ((e.clientY - rect.top) / rect.height) * 100;
    setGlarePosition({ x: glareX, y: glareY });
  };

  const handleMouseEnter = () => {
    setIsHovered(true);
  };

  const handleMouseLeave = () => {
    setIsHovered(false);
    setTransform({
      rotateX: 0,
      rotateY: 0,
      scale: 1,
    });
  };

  return (
    <div
      ref={cardRef}
      className={`relative ${className}`}
      onMouseMove={handleMouseMove}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      style={{
        perspective: `${perspective}px`,
        transformStyle: "preserve-3d",
      }}
    >
      <div
        className="w-full h-full"
        style={{
          transform: `rotateX(${transform.rotateX}deg) rotateY(${transform.rotateY}deg) scale(${transform.scale})`,
          transition: isHovered
            ? "transform 0.1s ease-out"
            : `transform ${transitionDuration}ms cubic-bezier(0.16, 1, 0.3, 1)`,
          transformStyle: "preserve-3d",
        }}
      >
        {children}
        
        {/* Glare effect */}
        <div
          className="absolute inset-0 pointer-events-none rounded-inherit"
          style={{
            background: `radial-gradient(circle at ${glarePosition.x}% ${glarePosition.y}%, rgba(255,255,255,${isHovered ? glareOpacity : 0}) 0%, transparent 60%)`,
            transition: isHovered ? "none" : `opacity ${transitionDuration}ms ease-out`,
            borderRadius: "inherit",
          }}
        />
      </div>
    </div>
  );
}

interface FloatingElementProps {
  children: ReactNode;
  className?: string;
  duration?: number;
  delay?: number;
  distance?: number;
}

export function FloatingElement({
  children,
  className = "",
  duration = 6,
  delay = 0,
  distance = 20,
}: FloatingElementProps) {
  return (
    <div
      className={className}
      style={{
        animation: `floatElement ${duration}s ease-in-out infinite`,
        animationDelay: `${delay}s`,
        ["--float-distance" as string]: `${distance}px`,
      }}
    >
      <style jsx>{`
        @keyframes floatElement {
          0%, 100% {
            transform: translateY(0) rotate(0deg);
          }
          25% {
            transform: translateY(calc(var(--float-distance) * -1)) rotate(2deg);
          }
          50% {
            transform: translateY(calc(var(--float-distance) * -0.5)) rotate(-1deg);
          }
          75% {
            transform: translateY(calc(var(--float-distance) * -1.2)) rotate(1deg);
          }
        }
      `}</style>
      {children}
    </div>
  );
}
