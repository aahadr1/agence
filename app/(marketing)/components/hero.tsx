"use client";

import Link from "next/link";
import { useEffect, useState, useRef, useCallback } from "react";

const typingWords = [
  "votre site web",
  "votre application", 
  "votre CRM",
  "vos leads",
  "votre marque",
];

export function HeroSection() {
  const [currentWordIndex, setCurrentWordIndex] = useState(0);
  const [displayText, setDisplayText] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);
  const [heroLoaded, setHeroLoaded] = useState(false);
  const heroRef = useRef<HTMLElement>(null);
  const heroPtr = useRef({ x: 0.5, y: 0.5 });
  const heroRaf = useRef(0);

  useEffect(() => {
    const timer = setTimeout(() => setHeroLoaded(true), 200);
    return () => clearTimeout(timer);
  }, []);

  useEffect(
    () => () => {
      if (heroRaf.current) cancelAnimationFrame(heroRaf.current);
    },
    []
  );

  useEffect(() => {
    const currentWord = typingWords[currentWordIndex];
    const timeout = setTimeout(
      () => {
        if (!isDeleting) {
          if (displayText.length < currentWord.length) {
            setDisplayText(currentWord.slice(0, displayText.length + 1));
          } else {
            setTimeout(() => setIsDeleting(true), 2500);
          }
        } else {
          if (displayText.length > 0) {
            setDisplayText(displayText.slice(0, -1));
          } else {
            setIsDeleting(false);
            setCurrentWordIndex((prev) => (prev + 1) % typingWords.length);
          }
        }
      },
      isDeleting ? 40 : 80
    );

    return () => clearTimeout(timeout);
  }, [displayText, isDeleting, currentWordIndex]);

  const applyHeroParallax = useCallback(() => {
    heroRaf.current = 0;
    const el = heroRef.current;
    if (!el) return;
    const { x, y } = heroPtr.current;
    const nx = x - 0.5;
    const ny = y - 0.5;
    el.style.setProperty("--hero-o1x", `${nx * -60}px`);
    el.style.setProperty("--hero-o1y", `${ny * -80}px`);
    el.style.setProperty("--hero-o2x", `${nx * 50}px`);
    el.style.setProperty("--hero-o2y", `${ny * -60}px`);
    el.style.setProperty("--hero-o3x", `${nx * 30}px`);
    el.style.setProperty("--hero-o3y", `${ny * -40}px`);
  }, []);

  const handleMouseMove = (e: React.MouseEvent<HTMLElement>) => {
    const rect = heroRef.current?.getBoundingClientRect();
    if (!rect) return;
    heroPtr.current = {
      x: (e.clientX - rect.left) / rect.width,
      y: (e.clientY - rect.top) / rect.height,
    };
    if (heroRaf.current) return;
    heroRaf.current = requestAnimationFrame(applyHeroParallax);
  };

  return (
    <section 
      ref={heroRef}
      onMouseMove={handleMouseMove}
      className="relative min-h-screen flex items-center overflow-hidden"
      style={{ background: "var(--bg-primary)" }}
    >
      {/* Layered background for depth */}
      <div 
        className="absolute inset-0"
        style={{
          background: `
            radial-gradient(ellipse at 70% 20%, var(--accent-warm-glow) 0%, transparent 50%),
            radial-gradient(ellipse at 20% 80%, var(--accent-glow) 0%, transparent 40%)
          `,
        }}
      />
      
      {/* Subtle grid background */}
      <div 
        className="absolute inset-0"
        style={{
          backgroundImage: `
            linear-gradient(to right, var(--border-light) 1px, transparent 1px),
            linear-gradient(to bottom, var(--border-light) 1px, transparent 1px)
          `,
          backgroundSize: "60px 60px",
        }}
      />
      
      {/* Noise texture overlay for light theme richness */}
      <div 
        className="absolute inset-0 opacity-[0.015] dark:opacity-[0.03] pointer-events-none mix-blend-multiply dark:mix-blend-soft-light"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E")`,
        }}
      />

      {/* Organic gradient orbs — motion via CSS vars + translate3d (no layout thrash) */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div
          className="absolute w-[700px] h-[700px] rounded-full will-change-transform"
          style={{
            background:
              "radial-gradient(circle, rgba(201, 169, 110, 0.12) 0%, rgba(201, 169, 110, 0.04) 40%, transparent 65%)",
            top: "-5%",
            right: "-10%",
            filter: "blur(52px)",
            transform:
              "translate3d(var(--hero-o1x, 0px), var(--hero-o1y, 0px), 0)",
          }}
        />

        <div
          className="absolute h-[500px] w-[500px] rounded-full"
          style={{
            background:
              "radial-gradient(circle, rgba(107, 123, 110, 0.1) 0%, rgba(107, 123, 110, 0.03) 45%, transparent 65%)",
            bottom: "5%",
            left: "5%",
            filter: "blur(44px)",
            transform:
              "translate3d(var(--hero-o2x, 0px), var(--hero-o2y, 0px), 0)",
          }}
        />

        <div
          className="absolute h-[400px] w-[400px] rounded-full"
          style={{
            background:
              "radial-gradient(circle, rgba(201, 169, 110, 0.06) 0%, transparent 60%)",
            top: "45%",
            left: "30%",
            filter: "blur(58px)",
            transform:
              "translate3d(var(--hero-o3x, 0px), var(--hero-o3y, 0px), 0)",
          }}
        />
      </div>

      {/* Floating organic shapes */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {[...Array(4)].map((_, i) => (
          <div
            key={i}
            className="marketing-ambient-dot absolute rounded-full"
            style={{
              width: `${6 + i * 2}px`,
              height: `${6 + i * 2}px`,
              left: `${15 + i * 20}%`,
              top: `${25 + (i % 3) * 20}%`,
              background: i % 2 === 0 
                ? "rgba(201, 169, 110, 0.3)" 
                : "rgba(107, 123, 110, 0.25)",
              animation: `floatDot ${14 + i * 3}s ease-in-out infinite`,
              animationDelay: `${i * -3}s`,
            }}
          />
        ))}
      </div>

      {/* Decorative side line */}
      <div
        className="absolute left-8 lg:left-16 top-1/4 bottom-1/4 w-px hidden lg:block"
        style={{
          background: "linear-gradient(to bottom, transparent, var(--accent-warm), transparent)",
          opacity: heroLoaded ? 0.3 : 0,
          transition: "opacity 1.5s ease",
          transitionDelay: "1s",
        }}
      />

      {/* Main content */}
      <div className="max-w-7xl mx-auto px-6 lg:px-8 py-32 lg:py-40 relative z-10">
        <div className="max-w-4xl">
          {/* Eyebrow */}
          <div 
            className="flex items-center gap-4 mb-8"
            style={{
              opacity: heroLoaded ? 1 : 0,
              transform: heroLoaded ? "translateY(0)" : "translateY(20px)",
              transition: "all 0.8s cubic-bezier(0.16, 1, 0.3, 1)",
              transitionDelay: "0.1s"
            }}
          >
            <span 
              className="h-px"
              style={{
                width: heroLoaded ? "32px" : "0px",
                background: "var(--accent-warm)",
                transition: "width 0.8s cubic-bezier(0.16, 1, 0.3, 1)",
                transitionDelay: "0.3s"
              }}
            />
            <span 
              className="text-xs font-medium tracking-[0.2em] uppercase"
              style={{ color: "var(--accent-warm-dark)" }}
            >
              Agence Digitale
            </span>
          </div>

          {/* Main Headline */}
          <h1 className="mb-6">
            <span 
              className="block"
              style={{
                opacity: heroLoaded ? 1 : 0,
                transform: heroLoaded ? "translateY(0)" : "translateY(40px)",
                transition: "all 1s cubic-bezier(0.16, 1, 0.3, 1)",
                transitionDelay: "0.15s"
              }}
            >
              <span className="font-display text-[clamp(2.75rem,7vw,5.5rem)] leading-[1.05] tracking-[-0.02em] text-ink dark:text-cream">
                Nous créons
              </span>
            </span>
            
            <span 
              className="block mt-1"
              style={{
                opacity: heroLoaded ? 1 : 0,
                transform: heroLoaded ? "translateY(0)" : "translateY(40px)",
                transition: "all 1s cubic-bezier(0.16, 1, 0.3, 1)",
                transitionDelay: "0.25s"
              }}
            >
              <span className="font-display text-[clamp(2.75rem,7vw,5.5rem)] leading-[1.05] tracking-[-0.02em]">
                <span
                  className="marketing-fraunces-breath inline-block"
                  style={{ color: "var(--accent-warm)" }}
                >
                  {displayText}
                </span>
                <span 
                  className="inline-block w-[3px] h-[0.8em] ml-1 align-middle"
                  style={{ 
                    background: "var(--accent-warm)",
                    animation: "blink 1s step-end infinite" 
                  }}
                />
              </span>
            </span>
          </h1>

          {/* Subtitle */}
          <p 
            className="text-lg lg:text-xl leading-relaxed max-w-xl mb-10"
            style={{
              color: "var(--text-secondary)",
              opacity: heroLoaded ? 1 : 0,
              transform: heroLoaded ? "translateY(0)" : "translateY(30px)",
              transition: "all 1s cubic-bezier(0.16, 1, 0.3, 1)",
              transitionDelay: "0.4s"
            }}
          >
            De la conception au déploiement, nous transformons vos idées en 
            solutions digitales performantes qui génèrent des résultats.
          </p>

          {/* CTA buttons */}
          <div
            className="flex flex-col sm:flex-row gap-4"
            style={{
              opacity: heroLoaded ? 1 : 0,
              transform: heroLoaded ? "translateY(0)" : "translateY(30px)",
              transition: "all 1s cubic-bezier(0.16, 1, 0.3, 1)",
              transitionDelay: "0.55s"
            }}
          >
            <Link
              href="/contact"
              className="group inline-flex items-center gap-3 px-7 py-4 bg-ink dark:bg-cream text-cream dark:text-ink font-medium transition-all duration-500 hover:bg-accent-warm dark:hover:bg-accent-warm hover:text-ink"
              style={{ transitionTimingFunction: "cubic-bezier(0.16, 1, 0.3, 1)" }}
            >
              <span>Discutons de votre projet</span>
              <svg 
                width="18" 
                height="18" 
                viewBox="0 0 18 18" 
                fill="none"
                className="transition-transform duration-300 group-hover:translate-x-1"
              >
                <path d="M4 9H14M14 9L9.5 4.5M14 9L9.5 13.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </Link>
            
            <Link
              href="/realisations"
              className="group inline-flex items-center gap-3 px-7 py-4 text-ink dark:text-cream font-medium border border-sand dark:border-charcoal transition-all duration-300 hover:border-accent hover:text-accent"
            >
              <span>Nos réalisations</span>
              <span className="w-5 h-px bg-current transition-all duration-300 group-hover:w-8" />
            </Link>
          </div>

          {/* Trust stats */}
          <div 
            className="flex flex-wrap gap-10 mt-16 pt-10"
            style={{
              borderTop: "1px solid var(--border-medium)",
              opacity: heroLoaded ? 1 : 0,
              transition: "opacity 1s ease",
              transitionDelay: "0.9s"
            }}
          >
            {[
              { number: "150+", label: "projets livrés" },
              { number: "98%", label: "clients satisfaits" },
              { number: "8 ans", label: "d'expertise" },
            ].map((stat, i) => (
              <div key={stat.label} className="flex items-baseline gap-2">
                <span 
                  className="font-display text-3xl"
                  style={{ color: i === 0 ? "var(--accent-warm)" : "var(--text-primary)" }}
                >
                  {stat.number}
                </span>
                <span style={{ color: "var(--text-muted)", fontSize: "0.875rem" }}>{stat.label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Scroll indicator */}
      <div 
        className="absolute bottom-10 left-1/2 -translate-x-1/2"
        style={{
          opacity: heroLoaded ? 1 : 0,
          transition: "opacity 1s ease",
          transitionDelay: "1.2s"
        }}
      >
        <div className="w-px h-16 bg-sand/40 dark:bg-charcoal/40 relative overflow-hidden">
          <div 
            className="absolute top-0 left-0 w-full"
            style={{
              height: "40%",
              background: "var(--accent-warm)",
              animation: "scrollLine 2.5s ease-in-out infinite",
            }}
          />
        </div>
      </div>

      <style jsx>{`
        @keyframes blink {
          0%, 50% { opacity: 1; }
          51%, 100% { opacity: 0; }
        }
        
        @keyframes floatDot {
          0%, 100% { transform: translate(0, 0); }
          33% { transform: translate(12px, -20px); }
          66% { transform: translate(-8px, -10px); }
        }
        
        @keyframes scrollLine {
          0% { top: -40%; }
          100% { top: 100%; }
        }
      `}</style>
    </section>
  );
}
