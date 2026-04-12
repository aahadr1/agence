"use client";

import { useState, useEffect, useCallback, useRef } from "react";

const testimonials = [
  {
    id: 1,
    quote: "LàHaut a transformé notre présence en ligne. Notre nouveau site génère 3x plus de leads qu'avant.",
    author: "Marie Dupont",
    role: "Directrice Commerciale",
    company: "Immobilier Plus",
  },
  {
    id: 2,
    quote: "Professionnalisme et réactivité. L'équipe a su comprendre nos besoins et livrer une solution exceptionnelle.",
    author: "Thomas Martin",
    role: "CEO",
    company: "TechStart",
  },
  {
    id: 3,
    quote: "Grâce à leur expertise, nous avons multiplié par 5 notre base de prospects qualifiés en 3 mois.",
    author: "Sophie Bernard",
    role: "Responsable Marketing",
    company: "B2B Solutions",
  },
  {
    id: 4,
    quote: "Notre e-commerce a vu ses ventes augmenter de 150%. L'UX pensée par LàHaut a fait la différence.",
    author: "Pierre Leroy",
    role: "Fondateur",
    company: "ModeFrance",
  },
];

export function TestimonialsSection() {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isAnimating, setIsAnimating] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const [progress, setProgress] = useState(0);
  const sectionRef = useRef<HTMLElement>(null);
  const animationRef = useRef<number | undefined>(undefined);

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

  const goToNext = useCallback(() => {
    if (isAnimating) return;
    setIsAnimating(true);
    setProgress(0);
    setTimeout(() => {
      setCurrentIndex((prev) => (prev + 1) % testimonials.length);
      setIsAnimating(false);
    }, 400);
  }, [isAnimating]);

  const goToPrev = useCallback(() => {
    if (isAnimating) return;
    setIsAnimating(true);
    setProgress(0);
    setTimeout(() => {
      setCurrentIndex((prev) => (prev - 1 + testimonials.length) % testimonials.length);
      setIsAnimating(false);
    }, 400);
  }, [isAnimating]);

  useEffect(() => {
    if (!isVisible) return;

    const duration = 6000;
    let startTime: number;

    const animate = (timestamp: number) => {
      if (!startTime) startTime = timestamp;
      const elapsed = timestamp - startTime;
      const newProgress = Math.min((elapsed / duration) * 100, 100);
      
      setProgress(newProgress);

      if (newProgress < 100) {
        animationRef.current = requestAnimationFrame(animate);
      } else {
        goToNext();
      }
    };

    animationRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [currentIndex, isVisible, goToNext]);

  return (
    <section 
      ref={sectionRef}
      className="py-32 lg:py-44 relative overflow-hidden"
      style={{ background: "var(--bg-primary)" }}
    >
      {/* Decorative quote mark */}
      <div 
        className="absolute top-16 left-8 lg:left-16 pointer-events-none"
        style={{
          opacity: isVisible ? 0.04 : 0,
          transition: "opacity 1.5s ease",
          color: "var(--accent-warm)",
        }}
      >
        <span className="font-display text-[20rem] leading-none">"</span>
      </div>

      <div className="max-w-5xl mx-auto px-6 lg:px-8 relative">
        {/* Header */}
        <div 
          className="flex items-center gap-4 mb-16 lg:mb-20"
          style={{
            opacity: isVisible ? 1 : 0,
            transform: isVisible ? "translateY(0)" : "translateY(30px)",
            transition: "all 1s cubic-bezier(0.16, 1, 0.3, 1)",
          }}
        >
          <span className="marketing-eyebrow" style={{ color: "var(--accent)" }}>Témoignages</span>
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

        {/* Testimonial content */}
        <div className="relative">
          {/* Quote */}
          <blockquote 
            className="font-display text-3xl sm:text-4xl lg:text-5xl leading-[1.25] mb-12 max-w-4xl"
            style={{
              color: "var(--text-primary)",
              opacity: isAnimating ? 0 : 1,
              transform: isAnimating ? "translateY(20px)" : "translateY(0)",
              transition: "all 0.4s cubic-bezier(0.16, 1, 0.3, 1)",
            }}
          >
            {testimonials[currentIndex].quote}
          </blockquote>

          {/* Author info */}
          <div 
            className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-8"
            style={{
              opacity: isAnimating ? 0 : 1,
              transform: isAnimating ? "translateY(15px)" : "translateY(0)",
              transition: "all 0.4s cubic-bezier(0.16, 1, 0.3, 1)",
              transitionDelay: "0.05s",
            }}
          >
            {/* Author */}
            <div className="flex items-center gap-5">
              {/* Initials */}
              <div 
                className="w-14 h-14 flex items-center justify-center"
                style={{ background: "var(--accent-subtle)" }}
              >
                <span 
                  className="font-display text-lg"
                  style={{ color: "var(--accent)" }}
                >
                  {testimonials[currentIndex].author.split(" ").map(n => n[0]).join("")}
                </span>
              </div>
              
              <div>
                <div className="font-medium mb-0.5" style={{ color: "var(--text-primary)" }}>
                  {testimonials[currentIndex].author}
                </div>
                <div className="text-sm" style={{ color: "var(--text-muted)" }}>
                  {testimonials[currentIndex].role}, {testimonials[currentIndex].company}
                </div>
              </div>
            </div>

            {/* Navigation */}
            <div className="flex items-center gap-5">
              <button
                onClick={goToPrev}
                className="w-11 h-11 flex items-center justify-center transition-all duration-300"
                style={{ 
                  border: "1px solid var(--border-medium)",
                  color: "var(--text-secondary)",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = "var(--accent-warm)";
                  e.currentTarget.style.background = "var(--accent-warm)";
                  e.currentTarget.style.color = "var(--ink)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = "var(--border-medium)";
                  e.currentTarget.style.background = "transparent";
                  e.currentTarget.style.color = "var(--text-secondary)";
                }}
                aria-label="Précédent"
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M10 4L6 8L10 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
              
              <div className="flex items-center gap-3">
                <span className="text-sm tabular-nums" style={{ color: "var(--text-subtle)" }}>
                  {String(currentIndex + 1).padStart(2, "0")}
                </span>
                <div className="w-20 h-px relative overflow-hidden" style={{ background: "var(--border-medium)" }}>
                  <div 
                    className="absolute top-0 left-0 h-full"
                    style={{ 
                      width: `${progress}%`,
                      background: "var(--accent-warm)",
                    }}
                  />
                </div>
                <span className="text-sm tabular-nums" style={{ color: "var(--text-subtle)" }}>
                  {String(testimonials.length).padStart(2, "0")}
                </span>
              </div>
              
              <button
                onClick={goToNext}
                className="w-11 h-11 flex items-center justify-center transition-all duration-300"
                style={{ 
                  border: "1px solid var(--border-medium)",
                  color: "var(--text-secondary)",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = "var(--accent-warm)";
                  e.currentTarget.style.background = "var(--accent-warm)";
                  e.currentTarget.style.color = "var(--ink)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = "var(--border-medium)";
                  e.currentTarget.style.background = "transparent";
                  e.currentTarget.style.color = "var(--text-secondary)";
                }}
                aria-label="Suivant"
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M6 4L10 8L6 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
