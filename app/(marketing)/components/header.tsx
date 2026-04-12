"use client";

import Link from "next/link";
import { useState, useEffect, useCallback } from "react";
import { useMagnetic } from "./animations/use-magnetic";

const navItems = [
  { label: "Accueil", href: "/" },
  { label: "Services", href: "/services" },
  { label: "Réalisations", href: "/realisations" },
  { label: "L'Agence", href: "/agence" },
  { label: "Contact", href: "/contact" },
];

function MagneticNavItem({ label, href }: { label: string; href: string }) {
  const magneticRef = useMagnetic<HTMLAnchorElement>({ strength: 0.4, maxDistance: 80 });

  return (
    <Link
      ref={magneticRef}
      href={href}
      className="relative px-4 py-2 text-sm font-medium tracking-wide transition-colors duration-300 group"
      style={{ color: "var(--text-secondary)" }}
    >
      <span className="relative z-10">{label}</span>
      <span 
        className="absolute bottom-1 left-4 right-4 h-px origin-left scale-x-0 group-hover:scale-x-100 transition-transform duration-500"
        style={{ background: "var(--accent-warm)", transitionTimingFunction: "cubic-bezier(0.16, 1, 0.3, 1)" }}
      />
    </Link>
  );
}

export function MarketingHeader() {
  const [isScrolled, setIsScrolled] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [scrollProgress, setScrollProgress] = useState(0);
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    const isDarkMode = document.documentElement.classList.contains('dark');
    setIsDark(isDarkMode);
  }, []);

  const toggleDarkMode = useCallback(() => {
    document.documentElement.classList.toggle('dark');
    setIsDark(!isDark);
  }, [isDark]);

  useEffect(() => {
    const handleScroll = () => {
      const scrollY = window.scrollY;
      setIsScrolled(scrollY > 50);
      
      const docHeight = document.documentElement.scrollHeight - window.innerHeight;
      const progress = docHeight > 0 ? Math.min(scrollY / docHeight, 1) : 0;
      setScrollProgress(progress);
    };
    
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  useEffect(() => {
    if (isMobileMenuOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isMobileMenuOpen]);

  return (
    <>
      <header
        className="fixed top-0 left-0 right-0 z-50 transition-all duration-700"
        style={{ 
          transitionTimingFunction: "cubic-bezier(0.16, 1, 0.3, 1)",
          background: isScrolled ? "rgba(235, 230, 220, 0.9)" : "transparent",
        }}
      >
        {/* Dark mode background */}
        <div 
          className="absolute inset-0 transition-opacity duration-700 dark:opacity-100 opacity-0"
          style={{ 
            background: isScrolled ? "rgba(13, 13, 13, 0.9)" : "transparent",
            backdropFilter: isScrolled ? "blur(12px)" : "none",
          }}
        />
        {/* Progress line */}
        <div 
          className="absolute bottom-0 left-0 h-px"
          style={{ 
            width: `${scrollProgress * 100}%`,
            background: "var(--accent-warm)",
            transition: "width 0.1s linear"
          }}
        />
        
        <div className="max-w-7xl mx-auto px-6 lg:px-8">
          <div className="flex items-center justify-between h-20 lg:h-24">
            {/* Logo */}
            <Link 
              href="/" 
              className="relative group flex items-center gap-2 z-10"
            >
              {/* Logo text style matching the brand */}
              <span className="font-display text-2xl font-medium tracking-tight" style={{ color: "var(--text-primary)" }}>
                Là<span className="relative">H<span className="absolute -top-1 -right-0.5 w-1.5 h-1.5 rounded-full" style={{ background: "var(--accent-warm)" }} /></span>aut
              </span>
              <span className="hidden sm:block h-5 w-px mx-1" style={{ background: "var(--border-medium)" }} />
              <span className="hidden sm:block text-sm tracking-wide" style={{ color: "var(--text-muted)" }}>Agency</span>
            </Link>

            {/* Desktop Navigation */}
            <nav className="hidden lg:flex items-center gap-1 z-10">
              {navItems.map((item) => (
                <MagneticNavItem 
                  key={item.href} 
                  label={item.label} 
                  href={item.href} 
                />
              ))}
            </nav>

            {/* Dark Mode Toggle + Connexion Link */}
            <div className="hidden lg:flex items-center gap-3 z-10">
              {/* Dark Mode Toggle */}
              <button
                onClick={toggleDarkMode}
                className="relative w-10 h-10 flex items-center justify-center rounded-lg transition-all duration-300 hover:bg-accent-warm/10 group"
                style={{ border: "1px solid var(--border-medium)" }}
                aria-label="Toggle dark mode"
              >
                {/* Sun icon */}
                <svg 
                  width="18" 
                  height="18" 
                  viewBox="0 0 24 24" 
                  fill="none"
                  className={`absolute transition-all duration-300 ${isDark ? 'opacity-0 rotate-90 scale-0' : 'opacity-100 rotate-0 scale-100'}`}
                >
                  <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1.5"/>
                  <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
                {/* Moon icon */}
                <svg 
                  width="18" 
                  height="18" 
                  viewBox="0 0 24 24" 
                  fill="none"
                  className={`absolute transition-all duration-300 ${isDark ? 'opacity-100 rotate-0 scale-100' : 'opacity-0 -rotate-90 scale-0'}`}
                >
                  <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>

              <Link
                href="/login"
                className="relative inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium rounded-lg transition-all duration-300 hover:shadow-lg hover:scale-[1.02] group overflow-hidden"
                style={{ 
                  background: "var(--text-primary)",
                  color: "var(--bg-primary)",
                }}
              >
                <span className="relative z-10">Espace Client</span>
                <svg 
                  width="16" 
                  height="16" 
                  viewBox="0 0 16 16" 
                  fill="none"
                  className="relative z-10 transition-transform duration-300 group-hover:translate-x-0.5"
                >
                  <path 
                    d="M3 8H13M13 8L9 4M13 8L9 12" 
                    stroke="currentColor" 
                    strokeWidth="1.5" 
                    strokeLinecap="round" 
                    strokeLinejoin="round"
                  />
                </svg>
                <div className="absolute inset-0 transform origin-left scale-x-0 group-hover:scale-x-100 transition-transform duration-500" style={{ background: "var(--accent-warm)", transitionTimingFunction: "cubic-bezier(0.16, 1, 0.3, 1)" }} />
              </Link>
            </div>

            {/* Mobile: Dark Mode + Menu Button */}
            <div className="flex lg:hidden items-center gap-2 z-10">
              {/* Mobile Dark Mode Toggle */}
              <button
                onClick={toggleDarkMode}
                className="relative w-10 h-10 flex items-center justify-center rounded-lg transition-all duration-300"
                style={{ border: "1px solid var(--border-medium)" }}
                aria-label="Toggle dark mode"
              >
                <svg 
                  width="18" 
                  height="18" 
                  viewBox="0 0 24 24" 
                  fill="none"
                  className={`absolute transition-all duration-300 ${isDark ? 'opacity-0 rotate-90 scale-0' : 'opacity-100 rotate-0 scale-100'}`}
                >
                  <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1.5"/>
                  <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                </svg>
                <svg 
                  width="18" 
                  height="18" 
                  viewBox="0 0 24 24" 
                  fill="none"
                  className={`absolute transition-all duration-300 ${isDark ? 'opacity-100 rotate-0 scale-100' : 'opacity-0 -rotate-90 scale-0'}`}
                >
                  <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>

              {/* Mobile Menu Button */}
              <button
                onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
                className="relative w-10 h-10 flex items-center justify-center"
                aria-label="Toggle menu"
              >
                <div className="relative w-6 h-5 flex flex-col justify-between">
                  <span 
                    className={`block w-full h-px transition-all duration-500 origin-center ${
                      isMobileMenuOpen ? "rotate-45 translate-y-2" : ""
                    }`}
                    style={{ background: "var(--text-primary)", transitionTimingFunction: "cubic-bezier(0.16, 1, 0.3, 1)" }}
                  />
                  <span 
                    className={`block w-full h-px transition-all duration-300 ${
                      isMobileMenuOpen ? "opacity-0 scale-x-0" : ""
                    }`}
                    style={{ background: "var(--text-primary)" }}
                  />
                  <span 
                    className={`block w-full h-px transition-all duration-500 origin-center ${
                      isMobileMenuOpen ? "-rotate-45 -translate-y-2" : ""
                    }`}
                    style={{ background: "var(--text-primary)", transitionTimingFunction: "cubic-bezier(0.16, 1, 0.3, 1)" }}
                  />
                </div>
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Mobile Menu Overlay */}
      <div
        className={`fixed inset-0 z-40 lg:hidden transition-all duration-700 ${
          isMobileMenuOpen 
            ? "opacity-100 pointer-events-auto" 
            : "opacity-0 pointer-events-none"
        }`}
        style={{ transitionTimingFunction: "cubic-bezier(0.16, 1, 0.3, 1)" }}
      >
        {/* Backdrop */}
        <div 
          className="absolute inset-0 bg-ink/20 backdrop-blur-sm"
          onClick={() => setIsMobileMenuOpen(false)}
        />
        
        {/* Menu Panel */}
        <div
          className={`absolute top-0 right-0 h-full w-full max-w-sm transition-transform duration-700 ${
            isMobileMenuOpen ? "translate-x-0" : "translate-x-full"
          }`}
          style={{ background: "var(--bg-primary)", transitionTimingFunction: "cubic-bezier(0.16, 1, 0.3, 1)" }}
        >
          <div className="flex flex-col h-full pt-24 px-8 pb-12">
            <nav className="flex flex-col gap-2">
              {navItems.map((item, index) => (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setIsMobileMenuOpen(false)}
                  className="py-4 text-2xl font-display transition-colors"
                  style={{
                    color: "var(--text-primary)",
                    borderBottom: "1px solid var(--border-light)",
                    opacity: isMobileMenuOpen ? 1 : 0,
                    transform: isMobileMenuOpen ? "translateX(0)" : "translateX(20px)",
                    transition: `opacity 0.5s cubic-bezier(0.16, 1, 0.3, 1) ${150 + index * 50}ms, transform 0.5s cubic-bezier(0.16, 1, 0.3, 1) ${150 + index * 50}ms`,
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.color = "var(--accent-warm)"}
                  onMouseLeave={(e) => e.currentTarget.style.color = "var(--text-primary)"}
                >
                  {item.label}
                </Link>
              ))}
            </nav>
            
            <div className="mt-auto">
              <Link
                href="/login"
                onClick={() => setIsMobileMenuOpen(false)}
                className="inline-flex items-center gap-3 px-6 py-3 font-medium rounded-lg"
                style={{
                  background: "var(--text-primary)",
                  color: "var(--bg-primary)",
                  opacity: isMobileMenuOpen ? 1 : 0,
                  transform: isMobileMenuOpen ? "translateY(0)" : "translateY(20px)",
                  transition: `opacity 0.5s cubic-bezier(0.16, 1, 0.3, 1) 400ms, transform 0.5s cubic-bezier(0.16, 1, 0.3, 1) 400ms`,
                }}
              >
                Espace Client
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M3 8H13M13 8L9 4M13 8L9 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </Link>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
