"use client";

import Link from "next/link";
import { useRef, useState, useEffect, useCallback } from "react";
import { useMarketingMotion } from "./animations/marketing-motion-provider";

const services = [
  {
    id: "web",
    number: "01",
    title: "Développement Web",
    description: "Sites vitrines, e-commerce et plateformes sur-mesure. Des solutions qui convertissent.",
    keywords: ["Next.js", "React", "Tailwind"],
  },
  {
    id: "apps",
    number: "02",
    title: "Applications Web",
    description: "Web apps et solutions SaaS. Des outils puissants pour digitaliser vos processus.",
    keywords: ["SaaS", "Dashboard", "API"],
  },
  {
    id: "crm",
    number: "03",
    title: "CRM & ERP",
    description: "Solutions de gestion personnalisées. Centralisez vos données et optimisez votre croissance.",
    keywords: ["Automation", "Pipeline", "Analytics"],
  },
  {
    id: "leads",
    number: "04",
    title: "Lead Generation",
    description: "Prospection automatisée et enrichissement de données. Des leads qualifiés à l'infini.",
    keywords: ["B2B", "Scraping", "Enrichment"],
  },
  {
    id: "seo",
    number: "05",
    title: "Référencement",
    description: "SEO, Google Ads et Meta Ads. Boostez votre visibilité et attirez des clients.",
    keywords: ["SEO", "Ads", "GMB"],
  },
  {
    id: "digital",
    number: "06",
    title: "Stratégie Digitale",
    description: "Branding et réseaux sociaux. Une présence digitale cohérente et impactante.",
    keywords: ["Branding", "Social", "Content"],
  },
];

function ServiceCard({
  service,
  index,
  registerCardRoot,
}: {
  service: (typeof services)[0];
  index: number;
  registerCardRoot: (i: number, el: HTMLDivElement | null) => void;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const tiltRef = useRef<HTMLDivElement>(null);
  const glareRef = useRef<HTMLDivElement>(null);
  const numberRef = useRef<HTMLSpanElement>(null);
  const [isHovered, setIsHovered] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const hoverRef = useRef(false);
  const tiltRaf = useRef(0);
  const latest = useRef({ x: 0.5, y: 0.5 });

  const flushTilt = useCallback(() => {
    tiltRaf.current = 0;
    const tilt = tiltRef.current;
    const glare = glareRef.current;
    const num = numberRef.current;
    if (!tilt) return;
    const { x, y } = latest.current;
    const rx = (y - 0.5) * -20;
    const ry = (x - 0.5) * 20;
    const z = hoverRef.current ? 20 : 0;
    tilt.style.transform = `translate3d(var(--card-pull-x, 0px), var(--card-pull-y, 0px), 0) rotateX(${rx}deg) rotateY(${ry}deg) translateZ(${z}px)`;
    if (glare) {
      glare.style.background = `radial-gradient(circle at ${x * 100}% ${y * 100}%, rgba(255,255,255,0.1) 0%, transparent 50%)`;
    }
    if (num && hoverRef.current) {
      num.style.transform = `translateZ(15px) translate(${(x - 0.5) * 8}px, ${(y - 0.5) * 8}px)`;
    } else if (num) {
      num.style.transform = "translateZ(15px) translate(0px, 0px)";
    }
  }, []);

  const scheduleTilt = useCallback(() => {
    if (tiltRaf.current) return;
    tiltRaf.current = requestAnimationFrame(flushTilt);
  }, [flushTilt]);

  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setTimeout(() => setIsVisible(true), index * 80);
        }
      },
      { threshold: 0.1 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [index]);

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!cardRef.current) return;
    const rect = cardRef.current.getBoundingClientRect();
    latest.current = {
      x: (e.clientX - rect.left) / rect.width,
      y: (e.clientY - rect.top) / rect.height,
    };
    scheduleTilt();
  };

  const handleMouseLeave = () => {
    hoverRef.current = false;
    setIsHovered(false);
    latest.current = { x: 0.5, y: 0.5 };
    if (tiltRaf.current) cancelAnimationFrame(tiltRaf.current);
    tiltRaf.current = 0;
    const tilt = tiltRef.current;
    if (tilt) {
      tilt.style.transform =
        "translate3d(var(--card-pull-x, 0px), var(--card-pull-y, 0px), 0) rotateX(0deg) rotateY(0deg) translateZ(0px)";
    }
    if (numberRef.current) {
      numberRef.current.style.transform = "translateZ(15px) translate(0px, 0px)";
    }
  };

  return (
    <Link href={`/services#${service.id}`}>
      <div
        ref={(el) => {
          cardRef.current = el;
          registerCardRoot(index, el);
        }}
        onMouseMove={handleMouseMove}
        onMouseEnter={() => {
          hoverRef.current = true;
          setIsHovered(true);
          scheduleTilt();
        }}
        onMouseLeave={handleMouseLeave}
        className="group relative h-full cursor-pointer"
        style={{
          perspective: "1200px",
          opacity: isVisible ? 1 : 0,
          transform: isVisible ? "translateY(0)" : "translateY(60px)",
          transition: "opacity 0.8s cubic-bezier(0.16, 1, 0.3, 1), transform 0.8s cubic-bezier(0.16, 1, 0.3, 1)",
        }}
      >
        <div
          className="marketing-living-drift h-full"
          style={{ animationDelay: `${index * -2.4}s` }}
        >
        <div
          ref={tiltRef}
          className="relative h-full overflow-hidden p-8 lg:p-10"
          style={{
            background: "var(--bg-card)",
            border: "1px solid var(--border-light)",
            transform:
              "translate3d(var(--card-pull-x, 0px), var(--card-pull-y, 0px), 0) rotateX(0deg) rotateY(0deg) translateZ(0px)",
            transition:
              "box-shadow 0.35s cubic-bezier(0.16, 1, 0.3, 1), border-color 0.35s cubic-bezier(0.16, 1, 0.3, 1)",
            transformStyle: "preserve-3d",
            boxShadow: isHovered
              ? "0 18px 40px -14px rgba(26, 24, 22, 0.1), 0 6px 16px -8px rgba(26, 24, 22, 0.06)"
              : "0 2px 14px -4px rgba(26, 24, 22, 0.05)",
            borderColor: isHovered ? "var(--accent)" : "",
          }}
        >
          {/* Glare effect — position updated in rAF */}
          <div
            ref={glareRef}
            className="pointer-events-none absolute inset-0 transition-opacity duration-200"
            style={{
              background:
                "radial-gradient(circle at 50% 50%, rgba(255,255,255,0.1) 0%, transparent 50%)",
              opacity: isHovered ? 1 : 0,
            }}
          />

          {/* Large number background */}
          <span
            ref={numberRef}
            className="absolute right-4 top-4 font-display text-7xl lg:text-8xl transition-colors duration-300"
            style={{
              color: isHovered ? "var(--accent-warm-glow)" : "var(--border-medium)",
              transform: "translateZ(15px)",
              transformStyle: "preserve-3d",
            }}
          >
            {service.number}
          </span>

          {/* Content */}
          <div style={{ transform: "translateZ(30px)", transformStyle: "preserve-3d" }}>
            <h3 
              className="font-display text-2xl lg:text-3xl mb-4 transition-colors duration-300"
              style={{ color: isHovered ? "var(--accent-warm)" : "var(--text-primary)" }}
            >
              {service.title}
            </h3>
            
            <p className="mb-6 leading-relaxed" style={{ color: "var(--text-muted)" }}>
              {service.description}
            </p>
            
            {/* Keywords */}
            <div className="flex flex-wrap gap-2 mb-6">
              {service.keywords.map((keyword, i) => (
                <span
                  key={keyword}
                  className="px-3 py-1 text-xs tracking-wider uppercase transition-all duration-300"
                  style={{
                    border: `1px solid ${isHovered ? "var(--accent)" : "var(--border-medium)"}`,
                    color: isHovered ? "var(--accent)" : "var(--text-muted)",
                    transitionDelay: `${i * 50}ms`,
                  }}
                >
                  {keyword}
                </span>
              ))}
            </div>
            
            {/* CTA arrow */}
            <div className="flex items-center">
              <span 
                className="h-px transition-all duration-500"
                style={{ 
                  width: isHovered ? "50px" : "25px",
                  backgroundColor: isHovered ? "var(--accent-warm)" : "var(--border-strong)"
                }}
              />
              <svg 
                width="16" 
                height="16" 
                viewBox="0 0 16 16" 
                fill="none"
                className="ml-2 transition-all duration-300"
                style={{
                  transform: isHovered ? "translateX(4px)" : "translateX(0)",
                  color: isHovered ? "var(--accent-warm)" : "var(--text-subtle)",
                }}
              >
                <path d="M3 8H13M13 8L9 4M13 8L9 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
          </div>

          {/* Corner accent on hover */}
          <div 
            className="absolute bottom-0 right-0 w-16 h-16 transition-opacity duration-500"
            style={{
              background: "linear-gradient(135deg, transparent 50%, var(--accent-warm) 50%)",
              opacity: isHovered ? 0.15 : 0,
            }}
          />
        </div>
        </div>
      </div>
    </Link>
  );
}

export function ServicesGrid() {
  const [sectionVisible, setSectionVisible] = useState(false);
  const sectionRef = useRef<HTMLElement>(null);
  const cardRootsRef = useRef<(HTMLDivElement | null)[]>([]);
  const pullRaf = useRef(0);
  const pullPtr = useRef({ x: 0, y: 0 });
  const { reducedMotion } = useMarketingMotion();

  const registerCardRoot = useCallback((i: number, el: HTMLDivElement | null) => {
    cardRootsRef.current[i] = el;
  }, []);

  const clearCardPulls = useCallback(() => {
    if (pullRaf.current) cancelAnimationFrame(pullRaf.current);
    pullRaf.current = 0;
    cardRootsRef.current.forEach((el) => {
      el?.style.setProperty("--card-pull-x", "0px");
      el?.style.setProperty("--card-pull-y", "0px");
    });
  }, []);

  const flushCardPulls = useCallback(() => {
    pullRaf.current = 0;
    const { x: cx, y: cy } = pullPtr.current;
    cardRootsRef.current.forEach((el) => {
      if (!el) return;
      const r = el.getBoundingClientRect();
      const mx = (cx - (r.left + r.width / 2)) / (Math.max(r.width, 1) * 0.72);
      const my = (cy - (r.top + r.height / 2)) / (Math.max(r.height, 1) * 0.72);
      const d = Math.hypot(mx, my);
      const p = d < 1.35 ? Math.max(0, 1 - d / 1.35) : 0;
      const pullX = Math.max(-1, Math.min(1, mx)) * p * 6;
      const pullY = Math.max(-1, Math.min(1, my)) * p * 6;
      el.style.setProperty("--card-pull-x", `${pullX}px`);
      el.style.setProperty("--card-pull-y", `${pullY}px`);
    });
  }, []);

  const handleSectionPointerMove = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      if (reducedMotion) return;
      pullPtr.current = { x: e.clientX, y: e.clientY };
      if (pullRaf.current) return;
      pullRaf.current = requestAnimationFrame(flushCardPulls);
    },
    [reducedMotion, flushCardPulls]
  );

  useEffect(
    () => () => {
      if (pullRaf.current) cancelAnimationFrame(pullRaf.current);
    },
    []
  );

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setSectionVisible(true);
        }
      },
      { threshold: 0.1 }
    );

    if (sectionRef.current) {
      observer.observe(sectionRef.current);
    }

    return () => observer.disconnect();
  }, []);

  return (
    <section 
      ref={sectionRef}
      onPointerMove={handleSectionPointerMove}
      onPointerLeave={clearCardPulls}
      className="py-28 lg:py-36 relative overflow-hidden" 
      id="services"
      style={{ background: "var(--bg-secondary)" }}
    >
      {/* Layered background */}
      <div 
        className="absolute inset-0 pointer-events-none"
        style={{
          background: `
            radial-gradient(ellipse at 30% 0%, var(--accent-glow) 0%, transparent 50%),
            radial-gradient(ellipse at 80% 100%, var(--accent-warm-glow) 0%, transparent 40%)
          `,
        }}
      />
      
      {/* Decorative borders */}
      <div className="absolute top-0 left-0 right-0 h-px" style={{ background: "linear-gradient(to right, transparent, var(--border-medium), transparent)" }} />
      <div className="absolute bottom-0 left-0 right-0 h-px" style={{ background: "linear-gradient(to right, transparent, var(--border-medium), transparent)" }} />
      
      {/* Large background text */}
      <div 
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none"
        style={{
          opacity: sectionVisible ? 0.015 : 0,
          transition: "opacity 2s ease",
        }}
      >
        <span className="font-display text-[20vw] leading-none text-ink dark:text-cream whitespace-nowrap">
          Services
        </span>
      </div>

      <div className="max-w-7xl mx-auto px-6 lg:px-8 relative">
        {/* Section Header */}
        <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-8 mb-16 lg:mb-24">
          <div className="max-w-xl">
            <div 
              className="flex items-center gap-4 mb-6"
              style={{
                opacity: sectionVisible ? 1 : 0,
                transform: sectionVisible ? "translateY(0)" : "translateY(30px)",
                transition: "all 1s cubic-bezier(0.16, 1, 0.3, 1)",
              }}
            >
              <span className="marketing-eyebrow" style={{ color: "var(--accent)" }}>Nos Expertises</span>
              <span 
                className="h-px"
                style={{
                  background: "var(--accent)",
                  width: sectionVisible ? "40px" : "0px",
                  transition: "width 1s cubic-bezier(0.16, 1, 0.3, 1)",
                  transitionDelay: "0.3s"
                }}
              />
            </div>
            
            <h2 
              className="font-display text-4xl lg:text-6xl text-ink dark:text-cream leading-[1.1]"
              style={{
                opacity: sectionVisible ? 1 : 0,
                transform: sectionVisible ? "translateY(0)" : "translateY(40px)",
                transition: "all 1s cubic-bezier(0.16, 1, 0.3, 1)",
                transitionDelay: "0.1s"
              }}
            >
              Des solutions
              <br />
              <span style={{ color: "var(--accent-warm)" }}>sur mesure</span>
            </h2>
          </div>
          
          <p 
            className="text-lg text-charcoal/60 dark:text-sand/60 max-w-md leading-relaxed"
            style={{
              opacity: sectionVisible ? 1 : 0,
              transform: sectionVisible ? "translateY(0)" : "translateY(30px)",
              transition: "all 1s cubic-bezier(0.16, 1, 0.3, 1)",
              transitionDelay: "0.2s"
            }}
          >
            De la création web à la génération de leads, nous vous accompagnons 
            dans votre transformation digitale avec passion.
          </p>
        </div>

        {/* Services Grid */}
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6 lg:gap-8">
          {services.map((service, index) => (
            <ServiceCard
              key={service.id}
              service={service}
              index={index}
              registerCardRoot={registerCardRoot}
            />
          ))}
        </div>

        {/* Bottom CTA */}
        <div 
          className="mt-16 text-center"
          style={{
            opacity: sectionVisible ? 1 : 0,
            transform: sectionVisible ? "translateY(0)" : "translateY(30px)",
            transition: "all 1s cubic-bezier(0.16, 1, 0.3, 1)",
            transitionDelay: "0.5s"
          }}
        >
          <Link
            href="/services"
            className="group inline-flex items-center gap-3 text-ink dark:text-cream font-medium"
          >
            <span>Découvrir tous nos services</span>
            <span 
              className="w-8 h-px bg-ink dark:bg-cream transition-all duration-500 group-hover:w-14"
              style={{ "--hover-color": "var(--accent-warm)" } as React.CSSProperties}
            />
          </Link>
        </div>
      </div>
    </section>
  );
}
