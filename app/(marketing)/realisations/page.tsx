"use client";

import { useState, useRef } from "react";
import { Filter } from "lucide-react";
import { InnerMarketingHero, InnerMarketingCta } from "../components/inner";
import { ScrollReveal } from "../components/animations/scroll-reveal";
import { TiltCard } from "../components/animations/tilt-card";

const categories = [
  "Tous",
  "Site Vitrine",
  "E-commerce",
  "Application Web",
  "CRM/ERP",
  "Lead Generation",
];

const projects = [
  {
    id: 1,
    title: "ModeParisienne",
    category: "E-commerce",
    description:
      "Boutique e-commerce premium : personnalisation produit, tailles, paiement multi-devises.",
    challenge: "Expérience luxe et tunnel de conversion optimisé.",
    results: ["+150% conversions", "4.8s chargement", "+200K€ CA"],
    tags: ["Shopify", "React", "Stripe", "Klaviyo"],
    year: "2024",
    tone: 0 as const,
  },
  {
    id: 2,
    title: "ImmoGestion Pro",
    category: "CRM/ERP",
    description: "CRM sur-mesure pour agence immobilière : biens, mandats, portail client.",
    challenge: "Centraliser données et automatiser le suivi des dossiers.",
    results: ["-60% temps admin", "+40% closing", "500+ biens"],
    tags: ["Next.js", "Supabase", "n8n", "Twilio"],
    year: "2024",
    tone: 1 as const,
  },
  {
    id: 3,
    title: "SaaS RecrutPro",
    category: "Application Web",
    description: "SaaS recrutement : parsing CV, matching, multi-entreprises.",
    challenge: "Puissance et simplicité pour digitaliser le recrutement.",
    results: ["15K utilisateurs", "99.9% uptime", "2M CV traités"],
    tags: ["React", "Python", "AWS", "OpenAI"],
    year: "2023",
    tone: 2 as const,
  },
  {
    id: 4,
    title: "Cabinet Expertise",
    category: "Site Vitrine",
    description: "Site premium pour cabinet d’expertise : prise de RDV et espace client.",
    challenge: "Moderniser l’image et digitaliser les rendez-vous.",
    results: ["+300% leads", "80% RDV en ligne", "Page 1 Google"],
    tags: ["WordPress", "Calendly", "SEO", "RGPD"],
    year: "2023",
    tone: 0 as const,
  },
  {
    id: 5,
    title: "B2B LeadMachine",
    category: "Lead Generation",
    description: "Prospection B2B automatisée : enrichissement et séquences personnalisées.",
    challenge: "1000+ leads qualifiés / mois avec budget maîtrisé.",
    results: ["12K leads/mois", "18% réponse", "45 clients signés"],
    tags: ["Python", "Clay", "Lemlist", "Zapier"],
    year: "2024",
    tone: 1 as const,
  },
  {
    id: 6,
    title: "FoodDelivery App",
    category: "Application Web",
    description: "App livraison repas : géoloc, suivi temps réel, paiement.",
    challenge: "Fluidité clients et livreurs.",
    results: ["50K téléchargements", "4.7★", "200 restaurants"],
    tags: ["React Native", "Node.js", "Stripe", "Maps"],
    year: "2023",
    tone: 2 as const,
  },
  {
    id: 7,
    title: "LuxuryWatch Store",
    category: "E-commerce",
    description: "E-commerce montres de luxe : authenticité et conciergerie.",
    challenge: "Expérience exclusive et confiance.",
    results: ["+500K€ CA", "0% fraude", "NPS 92"],
    tags: ["Next.js", "Shopify Plus", "Blockchain", "AR"],
    year: "2024",
    tone: 0 as const,
  },
  {
    id: 8,
    title: "StartupHub",
    category: "Site Vitrine",
    description: "Site incubateur : membres, blog, événements.",
    challenge: "Valoriser l’écosystème et faciliter les connexions.",
    results: ["200+ startups", "50 events/an", "+180% visibilité"],
    tags: ["Webflow", "Airtable", "Zapier", "Analytics"],
    year: "2023",
    tone: 1 as const,
  },
];

function cardGradient(tone: 0 | 1 | 2): string {
  if (tone === 0)
    return "linear-gradient(135deg, rgba(184,148,77,0.55) 0%, rgba(26,24,22,0.88) 50%, rgba(90,107,93,0.4) 100%)";
  if (tone === 1)
    return "linear-gradient(135deg, rgba(90,107,93,0.55) 0%, rgba(26,24,22,0.9) 45%, rgba(184,148,77,0.35) 100%)";
  return "linear-gradient(140deg, rgba(26,24,22,0.95) 0%, rgba(90,107,93,0.45) 40%, rgba(184,148,77,0.4) 100%)";
}

export default function RealisationsPage() {
  const [activeCategory, setActiveCategory] = useState("Tous");
  const [mouse, setMouse] = useState({ x: 0.5, y: 0.5 });
  const filterRef = useRef<HTMLElement>(null);

  const filteredProjects =
    activeCategory === "Tous" ? projects : projects.filter((p) => p.category === activeCategory);

  const onFilterMove = (e: React.MouseEvent<HTMLElement>) => {
    if (!filterRef.current) return;
    const r = filterRef.current.getBoundingClientRect();
    setMouse({ x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height });
  };

  return (
    <>
      <InnerMarketingHero
        eyebrow="Portfolio"
        title="Nos"
        titleAccent="réalisations"
        description="Études de cas et résultats : la même ligne directrice que sur l’accueil — précision, matière et mouvement."
        align="center"
      />

      <section
        ref={filterRef}
        onMouseMove={onFilterMove}
        className="sticky top-20 z-40 py-5 border-b backdrop-blur-md"
        style={{
          background: "color-mix(in srgb, var(--bg-primary) 88%, transparent)",
          borderColor: "var(--border-light)",
        }}
      >
        <div
          className="absolute inset-0 pointer-events-none opacity-60"
          style={{
            background: `radial-gradient(ellipse at ${mouse.x * 100}% 50%, var(--accent-warm-glow) 0%, transparent 45%)`,
          }}
        />
        <div className="max-w-7xl mx-auto px-6 lg:px-8 relative flex items-center gap-3 overflow-x-auto pb-1 scrollbar-hide">
          <Filter className="w-5 h-5 flex-shrink-0" style={{ color: "var(--text-muted)" }} />
          {categories.map((category) => (
            <button
              key={category}
              type="button"
              onClick={() => setActiveCategory(category)}
              className="px-4 py-2.5 text-sm font-medium whitespace-nowrap transition-all duration-500 rounded-lg"
              style={
                activeCategory === category
                  ? {
                      background: "var(--accent-warm)",
                      color: "var(--ink)",
                      boxShadow: "0 8px 24px -8px rgba(184, 148, 77, 0.5)",
                      transform: "translateY(-1px)",
                    }
                  : {
                      background: "var(--bg-card)",
                      color: "var(--text-secondary)",
                      border: "1px solid var(--border-light)",
                    }
              }
            >
              {category}
            </button>
          ))}
        </div>
      </section>

      <section className="py-16 lg:py-24 relative" style={{ background: "var(--bg-secondary)" }}>
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              "radial-gradient(ellipse at 0% 30%, var(--accent-glow) 0%, transparent 45%), radial-gradient(ellipse at 100% 70%, var(--accent-warm-glow) 0%, transparent 40%)",
          }}
        />
        <div className="max-w-7xl mx-auto px-6 lg:px-8 relative grid md:grid-cols-2 gap-8 lg:gap-10">
          {filteredProjects.map((project, index) => (
            <ScrollReveal key={project.id} delay={(index % 4) * 80} distance={44}>
              <TiltCard tiltAmount={7} glareOpacity={0.1} className="h-full">
                <article
                  id={`project-${project.id}`}
                  className="group h-full rounded-2xl overflow-hidden border transition-all duration-500"
                  style={{
                    background: "var(--bg-card)",
                    borderColor: "var(--border-light)",
                    boxShadow: "0 8px 32px -12px rgba(26, 24, 22, 0.12)",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = "var(--accent-warm)";
                    e.currentTarget.style.boxShadow = "0 24px 48px -16px rgba(26, 24, 22, 0.18)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = "var(--border-light)";
                    e.currentTarget.style.boxShadow = "0 8px 32px -12px rgba(26, 24, 22, 0.12)";
                  }}
                >
                  <div className="aspect-[16/9] relative overflow-hidden">
                    <div
                      className="absolute inset-0 transition-transform duration-700 group-hover:scale-105"
                      style={{ background: cardGradient(project.tone) }}
                    />
                    <div
                      className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-700 pointer-events-none"
                      style={{
                        background: "radial-gradient(circle at 50% 0%, rgba(255,255,255,0.2) 0%, transparent 55%)",
                      }}
                    />
                    <div className="absolute inset-0 p-6 lg:p-8 flex flex-col justify-between">
                      <div className="flex items-start justify-between">
                        <span
                          className="px-3 py-1 text-xs font-medium uppercase tracking-wider"
                          style={{
                            background: "rgba(0,0,0,0.35)",
                            color: "var(--cream)",
                            border: "1px solid rgba(255,255,255,0.15)",
                          }}
                        >
                          {project.category}
                        </span>
                        <span className="text-sm opacity-80" style={{ color: "var(--cream)" }}>
                          {project.year}
                        </span>
                      </div>
                      <div>
                        <h2 className="font-display text-2xl lg:text-3xl mb-3" style={{ color: "var(--cream)" }}>
                          {project.title}
                        </h2>
                        <div className="flex flex-wrap gap-2">
                          {project.tags.slice(0, 3).map((tag) => (
                            <span
                              key={tag}
                              className="px-2 py-0.5 text-xs"
                              style={{
                                background: "rgba(255,255,255,0.12)",
                                color: "rgba(240,235,226,0.9)",
                              }}
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="p-6 lg:p-8">
                    <p className="mb-6 leading-relaxed" style={{ color: "var(--text-muted)" }}>
                      {project.description}
                    </p>
                    <div className="mb-5">
                      <h3 className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--accent-warm-dark)" }}>
                        Challenge
                      </h3>
                      <p className="text-sm leading-relaxed" style={{ color: "var(--text-secondary)" }}>
                        {project.challenge}
                      </p>
                    </div>
                    <div className="mb-6">
                      <h3 className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--accent-warm-dark)" }}>
                        Résultats
                      </h3>
                      <div className="flex flex-wrap gap-2">
                        {project.results.map((result) => (
                          <span
                            key={result}
                            className="px-3 py-1.5 text-sm font-medium rounded-lg"
                            style={{
                              background: "var(--accent-subtle)",
                              color: "var(--accent-dark)",
                              border: "1px solid var(--border-light)",
                            }}
                          >
                            {result}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div
                      className="flex flex-wrap gap-2 pt-5 border-t"
                      style={{ borderColor: "var(--border-light)" }}
                    >
                      {project.tags.map((tag) => (
                        <span key={tag} className="text-xs" style={{ color: "var(--text-subtle)" }}>
                          #{tag}
                        </span>
                      ))}
                    </div>
                  </div>
                </article>
              </TiltCard>
            </ScrollReveal>
          ))}
        </div>
      </section>

      <InnerMarketingCta
        eyebrow="Votre tour"
        title={
          <>
            Votre projet, le <span style={{ color: "var(--accent-warm)" }}>prochain</span> de la liste
          </>
        }
        subtitle="Expliquez-nous vos objectifs : nous vous proposons une feuille de route réaliste et chiffrée."
        href="/contact"
        ctaLabel="Lancer mon projet"
      />
    </>
  );
}
