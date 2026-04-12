"use client";

import { useRef, useState, useEffect } from "react";

const reasons = [
  {
    number: "01",
    title: "Expertise Technique",
    description: "Une équipe de développeurs seniors maîtrisant les dernières technologies.",
    highlight: "Senior",
  },
  {
    number: "02",
    title: "Accompagnement Dédié",
    description: "Un interlocuteur unique et un suivi personnalisé tout au long du projet.",
    highlight: "Dédié",
  },
  {
    number: "03",
    title: "Résultats Mesurables",
    description: "Des KPIs clairs et un reporting régulier pour suivre la performance.",
    highlight: "KPIs",
  },
  {
    number: "04",
    title: "Support Réactif",
    description: "Une assistance technique disponible pour répondre à vos besoins.",
    highlight: "24/7",
  },
];

function ReasonCard({ reason, index }: { reason: typeof reasons[0]; index: number }) {
  const [isHovered, setIsHovered] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setTimeout(() => setIsVisible(true), index * 120);
        }
      },
      { threshold: 0.2 }
    );

    if (cardRef.current) {
      observer.observe(cardRef.current);
    }

    return () => observer.disconnect();
  }, [index]);

  return (
    <div
      ref={cardRef}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className="group relative py-8 lg:py-10 cursor-default"
      style={{
        borderBottom: "1px solid var(--border-light)",
        opacity: isVisible ? 1 : 0,
        transform: isVisible ? "translateX(0)" : "translateX(-25px)",
        transition: "all 0.8s cubic-bezier(0.16, 1, 0.3, 1)",
      }}
    >
      {/* Hover background */}
      <div 
        className="absolute inset-0 pointer-events-none"
        style={{
          background: "var(--accent-subtle)",
          opacity: isHovered ? 1 : 0,
          transform: isHovered ? "scaleX(1)" : "scaleX(0)",
          transformOrigin: "left",
          transition: "all 0.6s cubic-bezier(0.16, 1, 0.3, 1)",
        }}
      />

      <div className="relative flex gap-6 lg:gap-12 items-start">
        {/* Number */}
        <span 
          className="text-sm font-medium min-w-[2rem] transition-all duration-500"
          style={{
            color: isHovered ? "var(--accent-warm)" : "var(--accent)",
            transform: isHovered ? "translateX(8px)" : "translateX(0)",
          }}
        >
          {reason.number}
        </span>
        
        {/* Content */}
        <div className="flex-1 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
          <h3 
            className="font-display text-xl lg:text-2xl transition-all duration-500"
            style={{
              color: "var(--text-primary)",
              transform: isHovered ? "translateX(8px)" : "translateX(0)",
            }}
          >
            {reason.title}
          </h3>
          
          <p 
            className="max-w-sm leading-relaxed transition-all duration-500 lg:text-right text-sm"
            style={{
              color: "var(--text-muted)",
              opacity: isHovered ? 1 : 0.7,
              transform: isHovered ? "translateX(-8px)" : "translateX(0)",
            }}
          >
            {reason.description}
          </p>
        </div>
        
        {/* Highlight badge */}
        <div 
          className="hidden lg:flex items-center justify-center min-w-[70px] h-7 transition-all duration-500"
          style={{
            border: `1px solid ${isHovered ? "var(--accent-warm)" : "var(--border-medium)"}`,
            backgroundColor: isHovered ? "var(--accent-warm)" : "transparent",
          }}
        >
          <span 
            className="text-xs font-medium tracking-wider uppercase transition-colors duration-500"
            style={{
              color: isHovered ? "var(--ink)" : "var(--text-secondary)",
            }}
          >
            {reason.highlight}
          </span>
        </div>
      </div>

      {/* Animated underline */}
      <div 
        className="absolute bottom-0 left-0 h-px"
        style={{
          background: "var(--accent-warm)",
          width: isHovered ? "100%" : "0%",
          transition: "width 0.7s cubic-bezier(0.16, 1, 0.3, 1)",
        }}
      />
    </div>
  );
}

export function WhyUsSection() {
  const sectionRef = useRef<HTMLElement>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [mousePos, setMousePos] = useState({ x: 0.5, y: 0.5 });

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
        }
      },
      { threshold: 0.1 }
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
      className="py-32 lg:py-44 relative overflow-hidden"
      style={{ background: "var(--bg-secondary)" }}
    >
      {/* Layered background gradient */}
      <div 
        className="absolute inset-0 pointer-events-none"
        style={{
          background: `
            radial-gradient(ellipse at ${mousePos.x * 100}% ${mousePos.y * 100}%, var(--accent-glow) 0%, transparent 40%),
            radial-gradient(ellipse at 20% 80%, var(--accent-warm-glow) 0%, transparent 50%)
          `,
          transition: "background 0.5s ease-out",
        }}
      />

      {/* Large decorative number */}
      <div 
        className="absolute top-1/2 -right-16 -translate-y-1/2 pointer-events-none hidden xl:block"
        style={{
          opacity: isVisible ? 0.015 : 0,
          transition: "opacity 2s ease",
        }}
      >
        <span className="font-display text-[25rem] leading-none text-ink dark:text-cream">
          4
        </span>
      </div>

      <div className="max-w-7xl mx-auto px-6 lg:px-8 relative">
        <div className="grid lg:grid-cols-12 gap-16 lg:gap-20">
          {/* Left - Header (sticky) */}
          <div className="lg:col-span-4 lg:sticky lg:top-32 lg:self-start">
            <div 
              className="flex items-center gap-4 mb-6"
              style={{
                opacity: isVisible ? 1 : 0,
                transform: isVisible ? "translateY(0)" : "translateY(30px)",
                transition: "all 1s cubic-bezier(0.16, 1, 0.3, 1)",
              }}
            >
              <span className="marketing-eyebrow" style={{ color: "var(--accent)" }}>Pourquoi Nous</span>
              <span 
                className="h-px"
                style={{
                  background: "var(--accent)",
                  width: isVisible ? "50px" : "0px",
                  transition: "width 1.2s cubic-bezier(0.16, 1, 0.3, 1)",
                  transitionDelay: "0.3s"
                }}
              />
            </div>
            
            <h2 
              className="font-display text-4xl lg:text-5xl leading-[1.1] mb-6"
              style={{
                color: "var(--text-primary)",
                opacity: isVisible ? 1 : 0,
                transform: isVisible ? "translateY(0)" : "translateY(40px)",
                transition: "all 1s cubic-bezier(0.16, 1, 0.3, 1)",
                transitionDelay: "0.1s"
              }}
            >
              Une agence
              <br />
              <span style={{ color: "var(--accent-warm)" }}>engagée</span>
            </h2>
            
            <p 
              className="leading-relaxed mb-10"
              style={{
                color: "var(--text-muted)",
                opacity: isVisible ? 1 : 0,
                transform: isVisible ? "translateY(0)" : "translateY(30px)",
                transition: "all 1s cubic-bezier(0.16, 1, 0.3, 1)",
                transitionDelay: "0.2s"
              }}
            >
              Votre partenaire pour construire une présence digitale
              qui génère des résultats concrets.
            </p>

            {/* Key stats */}
            <div 
              className="flex gap-10"
              style={{
                opacity: isVisible ? 1 : 0,
                transform: isVisible ? "translateY(0)" : "translateY(30px)",
                transition: "all 1s cubic-bezier(0.16, 1, 0.3, 1)",
                transitionDelay: "0.3s"
              }}
            >
              <div>
                <div className="font-display text-3xl mb-1" style={{ color: "var(--text-primary)" }}>
                  24<span style={{ color: "var(--accent-warm)" }}>h</span>
                </div>
                <p className="text-xs uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
                  Réponse
                </p>
              </div>
              <div>
                <div className="font-display text-3xl mb-1" style={{ color: "var(--text-primary)" }}>
                  100<span style={{ color: "var(--accent-warm)" }}>%</span>
                </div>
                <p className="text-xs uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
                  France
                </p>
              </div>
            </div>
          </div>

          {/* Right - Reasons list */}
          <div className="lg:col-span-8" style={{ borderTop: "1px solid var(--border-light)" }}>
            {reasons.map((reason, index) => (
              <ReasonCard key={reason.number} reason={reason} index={index} />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
