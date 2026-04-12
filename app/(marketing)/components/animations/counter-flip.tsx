"use client";

import { useEffect, useRef, useState } from "react";

interface CounterFlipProps {
  value: number;
  duration?: number;
  delay?: number;
  suffix?: string;
  prefix?: string;
  className?: string;
}

export function CounterFlip({
  value,
  duration = 2000,
  delay = 0,
  suffix = "",
  prefix = "",
  className = "",
}: CounterFlipProps) {
  const [displayValue, setDisplayValue] = useState(0);
  const [isAnimating, setIsAnimating] = useState(false);
  const [hasStarted, setHasStarted] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !hasStarted) {
          setTimeout(() => {
            setHasStarted(true);
            setIsAnimating(true);
          }, delay);
        }
      },
      { threshold: 0.3 }
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, [delay, hasStarted]);

  useEffect(() => {
    if (!isAnimating) return;

    const startTime = performance.now();
    const startValue = 0;
    const endValue = value;

    const animate = (currentTime: number) => {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);
      
      const easeOutExpo = progress === 1 ? 1 : 1 - Math.pow(2, -10 * progress);
      const currentValue = Math.round(startValue + (endValue - startValue) * easeOutExpo);
      
      setDisplayValue(currentValue);

      if (progress < 1) {
        requestAnimationFrame(animate);
      } else {
        setIsAnimating(false);
      }
    };

    requestAnimationFrame(animate);
  }, [isAnimating, value, duration]);

  const digits = displayValue.toString().split("");

  return (
    <div ref={containerRef} className={`inline-flex items-baseline ${className}`}>
      {prefix && <span className="mr-1">{prefix}</span>}
      <div className="flex">
        {digits.map((digit, index) => (
          <FlipDigit key={`${index}-${digit}`} digit={digit} />
        ))}
      </div>
      {suffix && <span className="ml-1">{suffix}</span>}
    </div>
  );
}

function FlipDigit({ digit }: { digit: string }) {
  const [currentDigit, setCurrentDigit] = useState(digit);
  const [isFlipping, setIsFlipping] = useState(false);

  useEffect(() => {
    if (digit !== currentDigit) {
      setIsFlipping(true);
      const timer = setTimeout(() => {
        setCurrentDigit(digit);
        setIsFlipping(false);
      }, 150);
      return () => clearTimeout(timer);
    }
  }, [digit, currentDigit]);

  return (
    <span
      className="inline-block relative"
      style={{
        perspective: "500px",
        transformStyle: "preserve-3d",
      }}
    >
      <span
        className="inline-block"
        style={{
          transform: isFlipping ? "rotateX(-90deg)" : "rotateX(0deg)",
          transition: "transform 0.15s cubic-bezier(0.25, 1, 0.5, 1)",
          transformOrigin: "bottom",
          backfaceVisibility: "hidden",
        }}
      >
        {currentDigit}
      </span>
    </span>
  );
}

interface AnimatedCounterProps {
  value: number;
  duration?: number;
  delay?: number;
  suffix?: string;
  prefix?: string;
  className?: string;
  decimals?: number;
}

export function AnimatedCounter({
  value,
  duration = 2500,
  delay = 0,
  suffix = "",
  prefix = "",
  className = "",
  decimals = 0,
}: AnimatedCounterProps) {
  const [displayValue, setDisplayValue] = useState(0);
  const [hasStarted, setHasStarted] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !hasStarted) {
          setHasStarted(true);
        }
      },
      { threshold: 0.2 }
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, [hasStarted]);

  useEffect(() => {
    if (!hasStarted) return;

    const timeout = setTimeout(() => {
      const startTime = performance.now();

      const animate = (currentTime: number) => {
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / duration, 1);
        
        const easeOutExpo = progress === 1 ? 1 : 1 - Math.pow(2, -10 * progress);
        const currentValue = easeOutExpo * value;
        
        setDisplayValue(currentValue);

        if (progress < 1) {
          requestAnimationFrame(animate);
        }
      };

      requestAnimationFrame(animate);
    }, delay);

    return () => clearTimeout(timeout);
  }, [hasStarted, value, duration, delay]);

  const formattedValue = decimals > 0 
    ? displayValue.toFixed(decimals) 
    : Math.round(displayValue).toString();

  return (
    <div ref={containerRef} className={className}>
      {prefix}{formattedValue}{suffix}
    </div>
  );
}
