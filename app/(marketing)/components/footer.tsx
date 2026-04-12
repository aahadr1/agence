"use client";

import Link from "next/link";
import { useState, useRef, useEffect } from "react";

const footerLinks = {
  services: [
    { label: "Développement Web", href: "/services#web" },
    { label: "Applications", href: "/services#apps" },
    { label: "CRM & ERP", href: "/services#crm" },
    { label: "Lead Generation", href: "/services#leads" },
    { label: "Référencement", href: "/services#seo" },
  ],
  company: [
    { label: "À propos", href: "/about" },
    { label: "Réalisations", href: "/realisations" },
    { label: "Blog", href: "/blog" },
    { label: "Contact", href: "/contact" },
  ],
  legal: [
    { label: "Mentions légales", href: "/mentions-legales" },
    { label: "Politique de confidentialité", href: "/confidentialite" },
    { label: "CGV", href: "/cgv" },
  ],
};

const socials = [
  { name: "LinkedIn", href: "https://linkedin.com/company/lahaut", icon: "in" },
  { name: "Twitter", href: "https://twitter.com/lahaut", icon: "X" },
  { name: "GitHub", href: "https://github.com/lahaut", icon: "gh" },
];

export function MarketingFooter() {
  const footerRef = useRef<HTMLElement>(null);
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

    if (footerRef.current) {
      observer.observe(footerRef.current);
    }

    return () => observer.disconnect();
  }, []);

  const handleMouseMove = (e: React.MouseEvent<HTMLElement>) => {
    if (!footerRef.current) return;
    const rect = footerRef.current.getBoundingClientRect();
    setMousePos({
      x: (e.clientX - rect.left) / rect.width,
      y: (e.clientY - rect.top) / rect.height,
    });
  };

  return (
    <footer 
      ref={footerRef}
      onMouseMove={handleMouseMove}
      className="bg-ink pt-24 pb-8 relative overflow-hidden"
    >
      {/* Subtle gradient */}
      <div 
        className="absolute inset-0 opacity-30 pointer-events-none"
        style={{
          background: `radial-gradient(ellipse at ${mousePos.x * 100}% ${mousePos.y * 100}%, var(--accent-warm-glow) 0%, transparent 50%)`,
          transition: "background 0.5s ease-out",
        }}
      />

      {/* Top border */}
      <div className="absolute top-0 left-0 w-full h-px bg-gradient-to-r from-transparent via-cream/10 to-transparent" />

      <div className="max-w-7xl mx-auto px-6 lg:px-8 relative">
        {/* Main footer content */}
        <div className="grid lg:grid-cols-12 gap-16 pb-16 border-b border-cream/10">
          {/* Brand column */}
          <div 
            className="lg:col-span-4"
            style={{
              opacity: isVisible ? 1 : 0,
              transform: isVisible ? "translateY(0)" : "translateY(30px)",
              transition: "all 1s cubic-bezier(0.16, 1, 0.3, 1)",
            }}
          >
            <Link href="/" className="inline-block mb-8 group">
              <span className="font-display text-3xl text-cream transition-colors duration-500">
                Là<span className="relative">H<span 
                  className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full transition-transform duration-300 group-hover:scale-125"
                  style={{ background: "var(--accent-warm)" }}
                /></span>aut
              </span>
            </Link>
            
            <p className="text-sand/40 leading-relaxed mb-8 max-w-xs">
              Votre partenaire digital pour créer des solutions web performantes 
              qui transforment votre business.
            </p>
            
            {/* Contact info */}
            <div className="space-y-3">
              <a 
                href="mailto:contact@lahaut.agency" 
                className="block text-sand/50 text-sm transition-colors duration-300"
                onMouseEnter={(e) => e.currentTarget.style.color = "var(--accent-warm)"}
                onMouseLeave={(e) => e.currentTarget.style.color = ""}
              >
                contact@lahaut.agency
              </a>
              <a 
                href="tel:+33123456789" 
                className="block text-sand/50 text-sm transition-colors duration-300"
                onMouseEnter={(e) => e.currentTarget.style.color = "var(--accent-warm)"}
                onMouseLeave={(e) => e.currentTarget.style.color = ""}
              >
                +33 1 23 45 67 89
              </a>
            </div>
          </div>

          {/* Links columns */}
          <div className="lg:col-span-8 grid sm:grid-cols-3 gap-12">
            {/* Services */}
            <div
              style={{
                opacity: isVisible ? 1 : 0,
                transform: isVisible ? "translateY(0)" : "translateY(30px)",
                transition: "all 1s cubic-bezier(0.16, 1, 0.3, 1)",
                transitionDelay: "0.1s"
              }}
            >
              <h4 className="text-cream text-sm font-medium mb-6 tracking-wide">Services</h4>
              <ul className="space-y-3">
                {footerLinks.services.map((link) => (
                  <li key={link.href}>
                    <Link 
                      href={link.href}
                      className="text-sand/40 text-sm transition-colors duration-300"
                      onMouseEnter={(e) => e.currentTarget.style.color = "var(--accent-warm)"}
                      onMouseLeave={(e) => e.currentTarget.style.color = ""}
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>

            {/* Company */}
            <div
              style={{
                opacity: isVisible ? 1 : 0,
                transform: isVisible ? "translateY(0)" : "translateY(30px)",
                transition: "all 1s cubic-bezier(0.16, 1, 0.3, 1)",
                transitionDelay: "0.15s"
              }}
            >
              <h4 className="text-cream text-sm font-medium mb-6 tracking-wide">Agence</h4>
              <ul className="space-y-3">
                {footerLinks.company.map((link) => (
                  <li key={link.href}>
                    <Link 
                      href={link.href}
                      className="text-sand/40 text-sm transition-colors duration-300"
                      onMouseEnter={(e) => e.currentTarget.style.color = "var(--accent-warm)"}
                      onMouseLeave={(e) => e.currentTarget.style.color = ""}
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>

            {/* Legal */}
            <div
              style={{
                opacity: isVisible ? 1 : 0,
                transform: isVisible ? "translateY(0)" : "translateY(30px)",
                transition: "all 1s cubic-bezier(0.16, 1, 0.3, 1)",
                transitionDelay: "0.2s"
              }}
            >
              <h4 className="text-cream text-sm font-medium mb-6 tracking-wide">Légal</h4>
              <ul className="space-y-3">
                {footerLinks.legal.map((link) => (
                  <li key={link.href}>
                    <Link 
                      href={link.href}
                      className="text-sand/40 text-sm transition-colors duration-300"
                      onMouseEnter={(e) => e.currentTarget.style.color = "var(--accent)"}
                      onMouseLeave={(e) => e.currentTarget.style.color = ""}
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>

        {/* Bottom bar */}
        <div 
          className="pt-8 flex flex-col sm:flex-row items-center justify-between gap-6"
          style={{
            opacity: isVisible ? 1 : 0,
            transition: "opacity 1s ease",
            transitionDelay: "0.3s"
          }}
        >
          <p className="text-sand/30 text-sm">
            {new Date().getFullYear()} LàHaut Agency. Tous droits réservés.
          </p>
          
          {/* Socials */}
          <div className="flex items-center gap-4">
            {socials.map((social) => (
              <a
                key={social.name}
                href={social.href}
                target="_blank"
                rel="noopener noreferrer"
                className="w-9 h-9 border border-cream/10 flex items-center justify-center text-sand/40 text-xs font-medium transition-all duration-300"
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = "var(--accent-warm)";
                  e.currentTarget.style.background = "var(--accent-warm)";
                  e.currentTarget.style.color = "var(--ink)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = "";
                  e.currentTarget.style.background = "";
                  e.currentTarget.style.color = "";
                }}
                aria-label={social.name}
              >
                {social.icon}
              </a>
            ))}
          </div>
          
          {/* Back to login */}
          <Link
            href="/login"
            className="text-sand/30 text-sm transition-colors duration-300"
            onMouseEnter={(e) => e.currentTarget.style.color = "var(--accent-warm)"}
            onMouseLeave={(e) => e.currentTarget.style.color = ""}
          >
            Espace Client
          </Link>
        </div>
      </div>
    </footer>
  );
}
