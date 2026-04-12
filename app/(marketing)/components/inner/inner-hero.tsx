"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

type InnerHeroProps = {
  eyebrow: string;
  title: string;
  titleAccent?: string;
  /** If true, accent is on second line only */
  accentSecondLine?: boolean;
  description?: string;
  align?: "center" | "left";
  children?: ReactNode;
  className?: string;
};

export function InnerMarketingHero({
  eyebrow,
  title,
  titleAccent,
  accentSecondLine = false,
  description,
  align = "center",
  children,
  className = "",
}: InnerHeroProps) {
  const [loaded, setLoaded] = useState(false);
  const [mouse, setMouse] = useState({ x: 0.5, y: 0.5 });
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const t = setTimeout(() => setLoaded(true), 80);
    return () => clearTimeout(t);
  }, []);

  const onMove = (e: React.MouseEvent<HTMLElement>) => {
    if (!ref.current) return;
    const r = ref.current.getBoundingClientRect();
    setMouse({ x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height });
  };

  const textAlign = align === "center" ? "text-center" : "text-left";
  const flexEyebrow = align === "center" ? "justify-center" : "justify-start";

  return (
    <section
      ref={ref}
      onMouseMove={onMove}
      className={`relative overflow-hidden pt-24 pb-20 lg:pt-32 lg:pb-28 ${className}`}
      style={{ background: "var(--bg-primary)" }}
    >
      <div
        className="absolute inset-0"
        style={{
          background: `
            radial-gradient(ellipse at ${70 + (mouse.x - 0.5) * 20}% ${15 + (mouse.y - 0.5) * 15}%, var(--accent-warm-glow) 0%, transparent 55%),
            radial-gradient(ellipse at ${20 + (mouse.x - 0.5) * -15}% ${75 + (mouse.y - 0.5) * 10}%, var(--accent-glow) 0%, transparent 45%)
          `,
          transition: "background 0.6s ease-out",
        }}
      />
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: `
            linear-gradient(to right, var(--border-light) 1px, transparent 1px),
            linear-gradient(to bottom, var(--border-light) 1px, transparent 1px)
          `,
          backgroundSize: "56px 56px",
        }}
      />
      <div
        className="absolute inset-0 opacity-[0.018] dark:opacity-[0.035] pointer-events-none mix-blend-multiply dark:mix-blend-soft-light"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`,
        }}
      />
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="absolute rounded-full"
            style={{
              width: `${5 + i}px`,
              height: `${5 + i}px`,
              left: `${12 + i * 22}%`,
              top: `${28 + (i % 2) * 35}%`,
              background: i % 2 === 0 ? "rgba(184, 148, 77, 0.35)" : "rgba(90, 107, 93, 0.3)",
              animation: `innerFloat ${12 + i * 2}s ease-in-out infinite`,
              animationDelay: `${-i * 2.2}s`,
            }}
          />
        ))}
      </div>
      {align === "left" && (
        <div
          className="absolute left-6 lg:left-10 top-1/4 bottom-1/4 w-px hidden lg:block opacity-40"
          style={{
            background: "linear-gradient(to bottom, transparent, var(--accent-warm), transparent)",
            opacity: loaded ? 0.35 : 0,
            transition: "opacity 1.2s ease",
            transitionDelay: "0.4s",
          }}
        />
      )}

      <div className={`max-w-7xl mx-auto px-6 lg:px-8 relative z-10 ${textAlign}`}>
        <div
          className={`flex items-center gap-4 mb-8 ${flexEyebrow} max-w-4xl ${align === "center" ? "mx-auto" : ""}`}
          style={{
            opacity: loaded ? 1 : 0,
            transform: loaded ? "translateY(0)" : "translateY(24px)",
            transition: "all 0.9s cubic-bezier(0.16, 1, 0.3, 1)",
          }}
        >
          <span
            className="h-px"
            style={{
              width: loaded ? "32px" : "0px",
              background: "var(--accent-warm)",
              transition: "width 0.9s cubic-bezier(0.16, 1, 0.3, 1)",
              transitionDelay: "0.15s",
            }}
          />
          <span
            className="text-xs font-medium tracking-[0.22em] uppercase"
            style={{ color: "var(--accent-warm-dark)" }}
          >
            {eyebrow}
          </span>
        </div>

        <h1
          className={`font-display text-[clamp(2.25rem,6vw,4.25rem)] leading-[1.08] tracking-[-0.02em] max-w-4xl ${
            align === "center" ? "mx-auto" : ""
          }`}
          style={{
            color: "var(--text-primary)",
            opacity: loaded ? 1 : 0,
            transform: loaded ? "translateY(0)" : "translateY(36px)",
            transition: "all 1s cubic-bezier(0.16, 1, 0.3, 1)",
            transitionDelay: "0.08s",
          }}
        >
          {!accentSecondLine && titleAccent ? (
            <>
              {title}{" "}
              <span style={{ color: "var(--accent-warm)" }}>{titleAccent}</span>
            </>
          ) : accentSecondLine && titleAccent ? (
            <>
              {title}
              <br />
              <span style={{ color: "var(--accent-warm)" }}>{titleAccent}</span>
            </>
          ) : (
            title
          )}
        </h1>

        {description && (
          <p
            className={`mt-6 text-lg lg:text-xl leading-relaxed max-w-2xl ${
              align === "center" ? "mx-auto" : ""
            }`}
            style={{
              color: "var(--text-secondary)",
              opacity: loaded ? 1 : 0,
              transform: loaded ? "translateY(0)" : "translateY(28px)",
              transition: "all 1s cubic-bezier(0.16, 1, 0.3, 1)",
              transitionDelay: "0.18s",
            }}
          >
            {description}
          </p>
        )}

        {children && (
          <div
            className={`mt-10 ${align === "center" ? "flex justify-center" : ""}`}
            style={{
              opacity: loaded ? 1 : 0,
              transform: loaded ? "translateY(0)" : "translateY(20px)",
              transition: "all 1s cubic-bezier(0.16, 1, 0.3, 1)",
              transitionDelay: "0.28s",
            }}
          >
            {children}
          </div>
        )}
      </div>

      <style jsx>{`
        @keyframes innerFloat {
          0%,
          100% {
            transform: translate(0, 0);
          }
          33% {
            transform: translate(10px, -16px);
          }
          66% {
            transform: translate(-6px, -8px);
          }
        }
      `}</style>
    </section>
  );
}
