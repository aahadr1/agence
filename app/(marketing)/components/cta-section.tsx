"use client";

import Link from "next/link";
import { useRef, useState, useEffect, useCallback } from "react";
import { LahautSplitWatermark } from "./inner/lahaut-watermark";

export function CtaSection() {
  const sectionRef = useRef<HTMLElement>(null);
  const gradRef = useRef<HTMLDivElement>(null);
  const ptrRef = useRef({ x: 0.5, y: 0.5 });
  const gradRaf = useRef(0);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
        }
      },
      { threshold: 0.2 }
    );

    if (sectionRef.current) {
      observer.observe(sectionRef.current);
    }

    return () => observer.disconnect();
  }, []);

  const paintGradient = useCallback(() => {
    gradRaf.current = 0;
    const g = gradRef.current;
    if (!g) return;
    const { x, y } = ptrRef.current;
    const ix = 1 - x;
    const iy = 1 - y;
    g.style.background = `
      radial-gradient(ellipse at ${x * 100}% ${y * 100}%, rgba(201, 169, 110, 0.14) 0%, transparent 46%),
      radial-gradient(ellipse at ${ix * 100}% ${iy * 100}%, rgba(107, 123, 110, 0.09) 0%, transparent 50%)
    `;
  }, []);

  const handleMouseMove = (e: React.MouseEvent<HTMLElement>) => {
    const rect = sectionRef.current?.getBoundingClientRect();
    if (!rect) return;
    ptrRef.current = {
      x: (e.clientX - rect.left) / rect.width,
      y: (e.clientY - rect.top) / rect.height,
    };
    if (gradRaf.current) return;
    gradRaf.current = requestAnimationFrame(paintGradient);
  };

  useEffect(
    () => () => {
      if (gradRaf.current) cancelAnimationFrame(gradRaf.current);
    },
    []
  );

  return (
    <section 
      ref={sectionRef}
      onMouseMove={handleMouseMove}
      className="relative flex flex-col overflow-x-hidden overflow-y-visible bg-ink pt-36 lg:pt-48 pb-0"
    >
      {/* Animated gradient — DOM updates in rAF only (no transition on background) */}
      <div
        ref={gradRef}
        className="pointer-events-none absolute inset-0 opacity-50"
        style={{
          background: `
            radial-gradient(ellipse at 50% 50%, rgba(201, 169, 110, 0.14) 0%, transparent 46%),
            radial-gradient(ellipse at 50% 50%, rgba(107, 123, 110, 0.09) 0%, transparent 50%)
          `,
        }}
      />

      {/* Decorative lines */}
      <div className="absolute top-0 left-0 w-full h-px bg-gradient-to-r from-transparent via-cream/10 to-transparent" />
      <div className="absolute top-0 bottom-0 left-1/4 w-px bg-gradient-to-b from-transparent via-cream/5 to-transparent hidden lg:block" />
      <div className="absolute top-0 bottom-0 right-1/4 w-px bg-gradient-to-b from-transparent via-cream/5 to-transparent hidden lg:block" />

      <div
        className="marketing-living-drift relative z-10 mx-auto max-w-5xl px-6 text-center lg:px-8"
        style={{
          paddingBottom: "clamp(11rem, 32vw, 18rem)",
          animationDelay: "-5s",
        }}
      >
        {/* Eyebrow */}
        <div 
          className="flex items-center justify-center gap-4 mb-10"
          style={{
            opacity: isVisible ? 1 : 0,
            transform: isVisible ? "translateY(0)" : "translateY(30px)",
            transition: "all 1s cubic-bezier(0.16, 1, 0.3, 1)",
          }}
        >
          <span className="h-px w-8" style={{ background: "var(--accent-warm)" }} />
          <span 
            className="text-xs font-medium tracking-[0.3em] uppercase"
            style={{ color: "var(--accent-warm)" }}
          >
            Passons à l&apos;action
          </span>
          <span className="h-px w-8" style={{ background: "var(--accent-warm)" }} />
        </div>

        {/* Main headline */}
        <h2 
          className="font-display text-4xl sm:text-5xl lg:text-6xl text-cream mb-6 leading-[1.15]"
          style={{
            opacity: isVisible ? 1 : 0,
            transform: isVisible ? "translateY(0)" : "translateY(40px)",
            transition: "all 1s cubic-bezier(0.16, 1, 0.3, 1)",
            transitionDelay: "0.1s"
          }}
        >
          Prêt à transformer
          <br />
          votre <span style={{ color: "var(--accent-warm)" }}>vision</span> ?
        </h2>

        {/* Subtitle */}
        <p 
          className="text-lg lg:text-xl text-sand/50 mb-12 max-w-xl mx-auto leading-relaxed"
          style={{
            opacity: isVisible ? 1 : 0,
            transform: isVisible ? "translateY(0)" : "translateY(30px)",
            transition: "all 1s cubic-bezier(0.16, 1, 0.3, 1)",
            transitionDelay: "0.2s"
          }}
        >
          Discutons de votre projet et créons ensemble quelque chose d&apos;exceptionnel.
        </p>

        {/* CTA Button */}
        <div
          style={{
            opacity: isVisible ? 1 : 0,
            transform: isVisible ? "translateY(0)" : "translateY(30px)",
            transition: "all 1s cubic-bezier(0.16, 1, 0.3, 1)",
            transitionDelay: "0.3s"
          }}
        >
          <Link
            href="/contact"
            className="group relative inline-flex items-center gap-4"
          >
            <span 
              className="relative z-10 px-8 py-4 bg-cream text-ink font-medium transition-all duration-500 group-hover:bg-accent-warm"
            >
              Démarrer un projet
            </span>
            <span 
              className="relative z-10 w-12 h-12 border border-cream flex items-center justify-center transition-all duration-500 group-hover:border-accent-warm group-hover:bg-accent-warm"
            >
              <svg 
                width="18" 
                height="18" 
                viewBox="0 0 18 18" 
                fill="none"
                className="text-cream transition-all duration-500 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-ink"
              >
                <path 
                  d="M5 13L13 5M13 5H7M13 5V11" 
                  stroke="currentColor" 
                  strokeWidth="1.5" 
                  strokeLinecap="round" 
                  strokeLinejoin="round"
                />
              </svg>
            </span>
          </Link>
        </div>

        {/* Trust indicators */}
        <div 
          className="flex flex-wrap items-center justify-center gap-8 mt-16 text-sand/30 text-sm"
          style={{
            opacity: isVisible ? 1 : 0,
            transition: "opacity 1s ease",
            transitionDelay: "0.5s"
          }}
        >
          <span className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: "var(--accent-warm)", opacity: 0.6 }} />
            Devis gratuit
          </span>
          <span className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: "var(--accent-warm)", opacity: 0.6 }} />
            Réponse sous 24h
          </span>
          <span className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: "var(--accent-warm)", opacity: 0.6 }} />
            Made in France
          </span>
        </div>
      </div>

      <div className="pointer-events-none absolute bottom-0 left-0 right-0 z-0">
        <LahautSplitWatermark visible={isVisible} transitionDelay="0.5s" />
      </div>
    </section>
  );
}
