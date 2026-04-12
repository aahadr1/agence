"use client";

import { useEffect, useRef, useState } from "react";

const stats = [
  { value: 150, suffix: "+", label: "Projets", sublabel: "livrés avec succès" },
  { value: 98, suffix: "%", label: "Satisfaction", sublabel: "clients ravis" },
  { value: 8, suffix: "", label: "Années", sublabel: "d'expertise" },
  { value: 50, suffix: "+", label: "Partenaires", sublabel: "de confiance" },
];

function AnimatedNumber({ 
  value, 
  suffix, 
  isVisible, 
  delay 
}: { 
  value: number; 
  suffix: string; 
  isVisible: boolean;
  delay: number;
}) {
  const [displayValue, setDisplayValue] = useState(0);
  const [hasStarted, setHasStarted] = useState(false);

  useEffect(() => {
    if (!isVisible || hasStarted) return;
    
    const timeout = setTimeout(() => {
      setHasStarted(true);
      const duration = 2500;
      const startTime = performance.now();

      const animate = (currentTime: number) => {
        const elapsed = currentTime - startTime;
        const progress = Math.min(elapsed / duration, 1);
        
        const easeOutExpo = progress === 1 ? 1 : 1 - Math.pow(2, -10 * progress);
        setDisplayValue(Math.round(easeOutExpo * value));

        if (progress < 1) {
          requestAnimationFrame(animate);
        }
      };

      requestAnimationFrame(animate);
    }, delay);

    return () => clearTimeout(timeout);
  }, [isVisible, value, delay, hasStarted]);

  return (
    <span className="tabular-nums">
      {displayValue}
      <span style={{ color: "var(--accent-warm)" }}>{suffix}</span>
    </span>
  );
}

export function StatsSection() {
  const sectionRef = useRef<HTMLElement>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [mousePos, setMousePos] = useState({ x: 0.5, y: 0.5 });

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.3 }
    );

    if (sectionRef.current) {
      observer.observe(sectionRef.current);
    }

    return () => observer.disconnect();
  }, []);

  const handleMouseMove = (e: React.MouseEvent<HTMLElement>) => {
    if (!sectionRef.current) return;
    const rect = sectionRef.current.getBoundingClientRect();
    setMousePos({
      x: (e.clientX - rect.left) / rect.width,
      y: (e.clientY - rect.top) / rect.height,
    });
  };

  return (
    <section
      ref={sectionRef}
      onMouseMove={handleMouseMove}
      className="py-24 lg:py-32 relative overflow-hidden"
      style={{ background: "var(--bg-primary)" }}
    >
      {/* Layered background for richness */}
      <div 
        className="absolute inset-0 pointer-events-none"
        style={{
          background: `
            radial-gradient(ellipse at ${mousePos.x * 100}% ${mousePos.y * 100}%, var(--accent-warm-glow) 0%, transparent 40%),
            radial-gradient(ellipse at 80% 20%, var(--accent-glow) 0%, transparent 50%)
          `,
          transition: "background 0.5s ease-out",
        }}
      />

      {/* Decorative borders */}
      <div className="absolute top-0 left-0 w-full h-px" style={{ background: "linear-gradient(to right, transparent, var(--border-medium), transparent)" }} />
      <div className="absolute bottom-0 left-0 w-full h-px" style={{ background: "linear-gradient(to right, transparent, var(--border-medium), transparent)" }} />

      <div className="max-w-7xl mx-auto px-6 lg:px-8 relative">
        {/* Header */}
        <div 
          className="text-center mb-16"
          style={{
            opacity: isVisible ? 1 : 0,
            transform: isVisible ? "translateY(0)" : "translateY(30px)",
            transition: "all 1s cubic-bezier(0.16, 1, 0.3, 1)",
          }}
        >
          <span 
            className="text-xs font-medium tracking-[0.3em] uppercase"
            style={{ color: "var(--accent)" }}
          >
            En Chiffres
          </span>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-8 lg:gap-4">
          {stats.map((stat, index) => (
            <div
              key={stat.label}
              className="text-center relative group"
              style={{
                opacity: isVisible ? 1 : 0,
                transform: isVisible ? "translateY(0)" : "translateY(40px)",
                transition: "all 1s cubic-bezier(0.16, 1, 0.3, 1)",
                transitionDelay: `${index * 150}ms`,
              }}
            >
              {/* Vertical divider */}
              {index > 0 && (
                <div 
                  className="absolute left-0 top-1/2 -translate-y-1/2 w-px h-16 hidden lg:block"
                  style={{
                    background: "linear-gradient(to bottom, transparent, var(--border-strong), transparent)",
                    opacity: isVisible ? 1 : 0,
                    transform: isVisible ? "scaleY(1)" : "scaleY(0)",
                    transition: "all 1s cubic-bezier(0.16, 1, 0.3, 1)",
                    transitionDelay: `${300 + index * 100}ms`,
                  }}
                />
              )}

              {/* Number */}
              <div 
                className="font-display text-5xl sm:text-6xl lg:text-7xl mb-3 tracking-tight"
                style={{ color: "var(--text-primary)" }}
              >
                <AnimatedNumber
                  value={stat.value}
                  suffix={stat.suffix}
                  isVisible={isVisible}
                  delay={index * 200}
                />
              </div>

              {/* Label */}
              <p 
                className="font-medium text-sm mb-1 uppercase tracking-wider"
                style={{ color: "var(--text-primary)" }}
              >
                {stat.label}
              </p>
              
              {/* Sublabel */}
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                {stat.sublabel}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
