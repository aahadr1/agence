"use client";

import Link from "next/link";
import { useState, useRef, useEffect } from "react";

const projects = [
  {
    id: 1,
    title: "E-commerce Mode",
    category: "E-commerce",
    year: "2024",
    description: "Boutique en ligne complète avec gestion des stocks et paiement sécurisé.",
    result: "+150% conversion",
  },
  {
    id: 2,
    title: "CRM Immobilier",
    category: "Application",
    year: "2024",
    description: "Solution de gestion client sur-mesure pour agence immobilière.",
    result: "3x plus de leads",
  },
  {
    id: 3,
    title: "Plateforme SaaS RH",
    category: "SaaS",
    year: "2023",
    description: "Outil de gestion des ressources humaines et recrutement.",
    result: "10k+ utilisateurs",
  },
  {
    id: 4,
    title: "Site Vitrine Cabinet",
    category: "Site Vitrine",
    year: "2023",
    description: "Site professionnel avec prise de rendez-vous intégrée.",
    result: "Top 3 Google",
  },
];

function ProjectRow({ project, index }: { project: typeof projects[0]; index: number }) {
  const [isHovered, setIsHovered] = useState(false);
  const rowRef = useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setTimeout(() => setIsVisible(true), index * 120);
        }
      },
      { threshold: 0.1 }
    );

    if (rowRef.current) {
      observer.observe(rowRef.current);
    }

    return () => observer.disconnect();
  }, [index]);

  return (
    <Link href={`/realisations#project-${project.id}`}>
      <div
        ref={rowRef}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        className="group relative cursor-pointer"
        style={{
          opacity: isVisible ? 1 : 0,
          transform: isVisible ? "translateX(0)" : "translateX(-30px)",
          transition: "all 0.8s cubic-bezier(0.16, 1, 0.3, 1)",
        }}
      >
        <div 
          className="relative py-8 lg:py-10"
          style={{ borderBottom: "1px solid var(--border-light)" }}
        >
          {/* Hover background */}
          <div 
            className="absolute inset-0 pointer-events-none"
            style={{
              background: "var(--accent-subtle)",
              opacity: isHovered ? 1 : 0,
              transform: isHovered ? "scaleY(1)" : "scaleY(0)",
              transformOrigin: "bottom",
              transition: "all 0.5s cubic-bezier(0.16, 1, 0.3, 1)",
            }}
          />
          
          {/* Content */}
          <div className="relative flex flex-col lg:flex-row lg:items-center justify-between gap-4 lg:gap-8">
            {/* Left - Number and Title */}
            <div className="flex items-start lg:items-center gap-6 lg:gap-12 flex-1">
              <span 
                className="text-sm font-medium min-w-[2rem] transition-all duration-500"
                style={{
                  color: isHovered ? "var(--accent-warm)" : "var(--accent)",
                  transform: isHovered ? "translateX(8px)" : "translateX(0)",
                }}
              >
                {String(index + 1).padStart(2, "0")}
              </span>
              
              <h3 
                className="font-display text-2xl lg:text-4xl transition-all duration-500"
                style={{
                  color: "var(--text-primary)",
                  transform: isHovered ? "translateX(15px)" : "translateX(0)",
                }}
              >
                {project.title}
              </h3>
            </div>
            
            {/* Middle - Result badge */}
            <div 
              className="ml-12 lg:ml-0 flex items-center gap-2 transition-all duration-500"
              style={{
                opacity: isHovered ? 1 : 0.6,
                transform: isHovered ? "translateX(-5px)" : "translateX(0)",
              }}
            >
              <span 
                className="w-1.5 h-1.5 rounded-full"
                style={{ background: "var(--accent-warm)" }}
              />
              <span className="text-sm" style={{ color: "var(--text-secondary)" }}>
                {project.result}
              </span>
            </div>
            
            {/* Right - Category, Year, Arrow */}
            <div className="flex items-center gap-6 lg:gap-10 ml-12 lg:ml-0">
              <span 
                className="text-sm transition-all duration-500 hidden sm:block"
                style={{
                  color: "var(--text-muted)",
                  opacity: isHovered ? 0 : 1,
                  transform: isHovered ? "translateY(-8px)" : "translateY(0)",
                }}
              >
                {project.category}
              </span>
              <span className="text-sm" style={{ color: "var(--text-subtle)" }}>
                {project.year}
              </span>
              
              {/* Arrow */}
              <div 
                className="w-10 h-10 rounded-full flex items-center justify-center transition-all duration-500"
                style={{
                  backgroundColor: isHovered ? "var(--accent-warm)" : "transparent",
                  border: `1px solid ${isHovered ? "var(--accent-warm)" : "var(--border-medium)"}`,
                  transform: isHovered ? "rotate(-45deg) scale(1.1)" : "rotate(0) scale(1)",
                }}
              >
                <svg 
                  width="16" 
                  height="16" 
                  viewBox="0 0 16 16" 
                  fill="none"
                  className="transition-colors duration-500"
                  style={{
                    color: isHovered ? "var(--ink)" : "var(--text-muted)",
                  }}
                >
                  <path 
                    d="M4 8H12M12 8L8 4M12 8L8 12" 
                    stroke="currentColor" 
                    strokeWidth="1.5" 
                    strokeLinecap="round" 
                    strokeLinejoin="round"
                  />
                </svg>
              </div>
            </div>
          </div>
          
          {/* Animated underline */}
          <div 
            className="absolute bottom-0 left-0 h-px"
            style={{
              background: "var(--accent-warm)",
              width: isHovered ? "100%" : "0%",
              transition: "width 0.8s cubic-bezier(0.16, 1, 0.3, 1)",
            }}
          />
        </div>
      </div>
    </Link>
  );
}

export function RealisationsSection() {
  const [sectionVisible, setSectionVisible] = useState(false);
  const sectionRef = useRef<HTMLElement>(null);

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
      className="py-32 lg:py-40 relative overflow-hidden" 
      id="realisations"
      style={{ background: "var(--bg-primary)" }}
    >
      {/* Background decoration */}
      <div 
        className="absolute top-1/2 right-0 -translate-y-1/2 pointer-events-none hidden xl:block"
        style={{
          opacity: sectionVisible ? 0.02 : 0,
          transition: "opacity 2s ease",
        }}
      >
        <span 
          className="font-display text-[20rem] leading-none text-ink dark:text-cream"
          style={{ writingMode: "vertical-rl" }}
        >
          Work
        </span>
      </div>

      <div className="max-w-7xl mx-auto px-6 lg:px-8 relative">
        {/* Section Header */}
        <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-8 mb-16 lg:mb-20">
          <div className="max-w-xl">
            <div 
              className="flex items-center gap-4 mb-6"
              style={{
                opacity: sectionVisible ? 1 : 0,
                transform: sectionVisible ? "translateY(0)" : "translateY(30px)",
                transition: "all 1s cubic-bezier(0.16, 1, 0.3, 1)",
              }}
            >
              <span className="marketing-eyebrow" style={{ color: "var(--accent)" }}>Portfolio</span>
              <span 
                className="h-px"
                style={{
                  background: "var(--accent)",
                  width: sectionVisible ? "50px" : "0px",
                  transition: "width 1.2s cubic-bezier(0.16, 1, 0.3, 1)",
                  transitionDelay: "0.3s"
                }}
              />
            </div>
            
            <h2 
              className="font-display text-4xl lg:text-6xl leading-[1.1]"
              style={{
                color: "var(--text-primary)",
                opacity: sectionVisible ? 1 : 0,
                transform: sectionVisible ? "translateY(0)" : "translateY(40px)",
                transition: "all 1s cubic-bezier(0.16, 1, 0.3, 1)",
                transitionDelay: "0.1s"
              }}
            >
              Projets
              <br />
              <span style={{ color: "var(--accent-warm)" }}>sélectionnés</span>
            </h2>
          </div>
          
          <div
            style={{
              opacity: sectionVisible ? 1 : 0,
              transform: sectionVisible ? "translateY(0)" : "translateY(20px)",
              transition: "all 1s cubic-bezier(0.16, 1, 0.3, 1)",
              transitionDelay: "0.2s"
            }}
          >
            <Link
              href="/realisations"
              className="group inline-flex items-center gap-3 font-medium"
              style={{ color: "var(--text-primary)" }}
            >
              <span>Voir tout</span>
              <span 
                className="w-8 h-px transition-all duration-500 group-hover:w-14"
                style={{ background: "var(--accent)" }}
              />
            </Link>
          </div>
        </div>

        {/* Projects List */}
        <div style={{ borderTop: "1px solid var(--border-light)" }}>
          {projects.map((project, index) => (
            <ProjectRow key={project.id} project={project} index={index} />
          ))}
        </div>
      </div>
    </section>
  );
}
