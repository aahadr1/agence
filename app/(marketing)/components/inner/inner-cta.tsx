"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { LahautSplitWatermark } from "./lahaut-watermark";

type InnerMarketingCtaProps = {
  eyebrow?: string;
  title: ReactNode;
  subtitle?: string;
  href: string;
  ctaLabel: string;
  secondaryHref?: string;
  secondaryLabel?: string;
};

export function InnerMarketingCta({
  eyebrow = "Suite",
  title,
  subtitle,
  href,
  ctaLabel,
  secondaryHref,
  secondaryLabel,
}: InnerMarketingCtaProps) {
  const ref = useRef<HTMLElement>(null);
  const [mouse, setMouse] = useState({ x: 0.5, y: 0.5 });
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const obs = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) setVisible(true);
      },
      { threshold: 0.2 }
    );
    if (ref.current) obs.observe(ref.current);
    return () => obs.disconnect();
  }, []);

  const onMove = (e: React.MouseEvent<HTMLElement>) => {
    if (!ref.current) return;
    const r = ref.current.getBoundingClientRect();
    setMouse({ x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height });
  };

  return (
    <section
      ref={ref}
      onMouseMove={onMove}
      className="relative flex flex-col overflow-x-hidden overflow-y-visible pt-28 lg:pt-36 pb-0"
      style={{ background: "var(--ink)" }}
    >
      <div
        className="absolute inset-0 opacity-55 pointer-events-none"
        style={{
          background: `
            radial-gradient(ellipse at ${mouse.x * 100}% ${mouse.y * 100}%, rgba(201, 169, 110, 0.18) 0%, transparent 42%),
            radial-gradient(ellipse at ${100 - mouse.x * 100}% ${100 - mouse.y * 100}%, rgba(107, 123, 110, 0.12) 0%, transparent 48%)
          `,
          transition: "background 0.5s ease-out",
        }}
      />
      <div className="absolute top-0 left-0 w-full h-px bg-gradient-to-r from-transparent via-cream/12 to-transparent" />
      <div className="absolute top-0 bottom-0 left-1/4 w-px bg-gradient-to-b from-transparent via-cream/6 to-transparent hidden lg:block" />
      <div className="absolute top-0 bottom-0 right-1/4 w-px bg-gradient-to-b from-transparent via-cream/6 to-transparent hidden lg:block" />

      <div
        className="relative z-10 max-w-5xl mx-auto px-6 lg:px-8 text-center"
        style={{ paddingBottom: "clamp(10.5rem, 30vw, 17rem)" }}
      >
        <div
          className="flex items-center justify-center gap-4 mb-8"
          style={{
            opacity: visible ? 1 : 0,
            transform: visible ? "translateY(0)" : "translateY(24px)",
            transition: "all 0.9s cubic-bezier(0.16, 1, 0.3, 1)",
          }}
        >
          <span className="h-px w-8" style={{ background: "var(--accent-warm)" }} />
          <span
            className="text-xs font-medium tracking-[0.28em] uppercase"
            style={{ color: "var(--accent-warm)" }}
          >
            {eyebrow}
          </span>
          <span className="h-px w-8" style={{ background: "var(--accent-warm)" }} />
        </div>

        <div
          className="font-display text-3xl sm:text-4xl lg:text-5xl mb-5 leading-[1.15]"
          style={{
            color: "var(--cream)",
            opacity: visible ? 1 : 0,
            transform: visible ? "translateY(0)" : "translateY(32px)",
            transition: "all 0.95s cubic-bezier(0.16, 1, 0.3, 1)",
            transitionDelay: "0.06s",
          }}
        >
          {title}
        </div>

        {subtitle && (
          <p
            className="text-lg max-w-xl mx-auto mb-10 leading-relaxed"
            style={{
              color: "rgba(240, 235, 226, 0.55)",
              opacity: visible ? 1 : 0,
              transform: visible ? "translateY(0)" : "translateY(24px)",
              transition: "all 0.95s cubic-bezier(0.16, 1, 0.3, 1)",
              transitionDelay: "0.12s",
            }}
          >
            {subtitle}
          </p>
        )}

        <div
          className="flex flex-col sm:flex-row items-center justify-center gap-4"
          style={{
            opacity: visible ? 1 : 0,
            transform: visible ? "translateY(0)" : "translateY(24px)",
            transition: "all 0.95s cubic-bezier(0.16, 1, 0.3, 1)",
            transitionDelay: "0.2s",
          }}
        >
          <Link
            href={href}
            className="group inline-flex items-center gap-3 px-8 py-4 font-medium transition-all duration-500"
            style={{
              background: "var(--cream)",
              color: "var(--ink)",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "var(--accent-warm)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "var(--cream)";
            }}
          >
            {ctaLabel}
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" className="transition-transform group-hover:translate-x-1">
              <path d="M4 9H14M14 9L9.5 4.5M14 9L9.5 13.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </Link>
          {secondaryHref && secondaryLabel && (
            <Link
              href={secondaryHref}
              className="inline-flex items-center gap-2 px-6 py-3 font-medium border transition-all duration-300"
              style={{
                borderColor: "rgba(240, 235, 226, 0.2)",
                color: "var(--cream)",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = "var(--accent-warm)";
                e.currentTarget.style.background = "rgba(201, 169, 110, 0.12)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = "rgba(240, 235, 226, 0.2)";
                e.currentTarget.style.background = "transparent";
              }}
            >
              {secondaryLabel}
            </Link>
          )}
        </div>
      </div>

      <div className="pointer-events-none absolute bottom-0 left-0 right-0 z-0">
        <LahautSplitWatermark visible={visible} transitionDelay="0.2s" />
      </div>
    </section>
  );
}
