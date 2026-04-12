"use client";

import Link from "next/link";
import {
  Globe,
  Smartphone,
  Users,
  Target,
  Search,
  Megaphone,
  ArrowRight,
  Check,
  Zap,
  Clock,
  Shield,
  type LucideIcon,
} from "lucide-react";
import { InnerMarketingHero, InnerMarketingCta } from "../components/inner";
import { ScrollReveal } from "../components/animations/scroll-reveal";
import { TiltCard } from "../components/animations/tilt-card";

type Service = {
  id: string;
  icon: LucideIcon;
  title: string;
  subtitle: string;
  description: string;
  features: string[];
  technologies: string[];
  stats: Record<string, string>;
  tone: 0 | 1 | 2;
};

const services: Service[] = [
  {
    id: "web",
    icon: Globe,
    title: "Développement Web",
    subtitle: "Des sites qui convertissent",
    description:
      "Sites performants, responsive et SEO-ready. Du vitrine à l’e-commerce, nous concevons des solutions sur-mesure alignées sur vos objectifs.",
    features: [
      "Sites vitrines professionnels",
      "E-commerce (Shopify, WooCommerce, sur-mesure)",
      "Sites institutionnels et corporate",
      "Landing pages haute conversion",
      "Refonte et migration",
      "CMS (WordPress, Strapi, headless)",
    ],
    technologies: ["Next.js", "React", "WordPress", "Shopify", "WooCommerce"],
    stats: { projects: "80+", satisfaction: "98%" },
    tone: 0,
  },
  {
    id: "apps",
    icon: Smartphone,
    title: "Applications Web",
    subtitle: "Digitalisez vos processus",
    description:
      "Web apps et SaaS sur-mesure : automatisation métier, outils internes, produits logiciels scalables.",
    features: [
      "Applications métier sur-mesure",
      "Plateformes SaaS",
      "Dashboards et reporting",
      "Portails clients / extranet",
      "Apps de gestion interne",
      "PWA",
    ],
    technologies: ["React", "Node.js", "Python", "PostgreSQL", "AWS"],
    stats: { projects: "45+", satisfaction: "99%" },
    tone: 1,
  },
  {
    id: "crm",
    icon: Users,
    title: "CRM & ERP",
    subtitle: "Centralisez votre gestion",
    description:
      "CRM et outils de gestion adaptés à vos flux : données unifiées, pipelines et automatisation.",
    features: [
      "CRM sur-mesure par métier",
      "Contacts et opportunités",
      "Pipeline de vente automatisé",
      "Intégrations outils existants",
      "Tableaux de bord",
      "Workflows",
    ],
    technologies: ["Supabase", "PostgreSQL", "n8n", "Zapier", "APIs"],
    stats: { projects: "30+", satisfaction: "97%" },
    tone: 2,
  },
  {
    id: "leads",
    icon: Target,
    title: "Lead Generation",
    subtitle: "Trouvez vos clients idéaux",
    description:
      "Prospection B2B, enrichissement et outbound structuré pour alimenter votre CRM en continu.",
    features: [
      "Extraction et enrichissement de données",
      "Qualification et scoring",
      "Séquences d’outreach",
      "LinkedIn & multicanal",
      "Intégration CRM",
      "Reporting",
    ],
    technologies: ["Python", "Puppeteer", "APIs", "Make", "Clay"],
    stats: { leads: "100K+", conversion: "15%" },
    tone: 0,
  },
  {
    id: "seo",
    icon: Search,
    title: "Référencement & Publicité",
    subtitle: "Boostez votre visibilité",
    description:
      "SEO, SEA et social ads avec une vision ROI : mesure, itération et transparence.",
    features: [
      "Audit SEO technique et sémantique",
      "On-page / off-page",
      "Google Ads",
      "Meta Ads",
      "Google Business Profile",
      "Reporting",
    ],
    technologies: ["Google Ads", "Meta", "GA4", "Search Console"],
    stats: { budget: "500K€+", roas: "4.5x" },
    tone: 1,
  },
  {
    id: "digital",
    icon: Megaphone,
    title: "Présence Digitale",
    subtitle: "Construisez votre marque",
    description:
      "Stratégie de marque, contenus et canaux : une présence cohérente et crédible.",
    features: [
      "Stratégie de marque digitale",
      "Identité visuelle",
      "Réseaux sociaux",
      "Content marketing",
      "Email marketing",
      "Influence & partenariats",
    ],
    technologies: ["Figma", "Notion", "Mailchimp", "HubSpot"],
    stats: { clients: "60+", engagement: "+200%" },
    tone: 2,
  },
];

const process = [
  { step: 1, title: "Découverte", description: "Échange gratuit pour cadrer besoins, objectifs et contraintes." },
  { step: 2, title: "Proposition", description: "Recommandations et devis détaillé sous 48h." },
  { step: 3, title: "Conception", description: "Maquettes et prototypes validés ensemble." },
  { step: 4, title: "Développement", description: "Livraisons incrémentales et points réguliers." },
  { step: 5, title: "Livraison", description: "Tests, formation et mise en production accompagnée." },
  { step: 6, title: "Suivi", description: "Maintenance, support et évolutions." },
];

function RowIcon({ icon: Icon }: { icon: LucideIcon }) {
  return (
    <div
      className="inline-flex items-center justify-center w-14 h-14 rounded-xl mb-6 transition-transform duration-500 hover:scale-105"
      style={{
        background: "var(--bg-card)",
        border: "1px solid var(--border-medium)",
        color: "var(--accent-warm)",
      }}
    >
      <Icon className="w-7 h-7" />
    </div>
  );
}

function tonePanelGradient(tone: 0 | 1 | 2): string {
  if (tone === 0)
    return "linear-gradient(145deg, rgba(184,148,77,0.45) 0%, rgba(26,24,22,0.92) 45%, rgba(90,107,93,0.35) 100%)";
  if (tone === 1)
    return "linear-gradient(145deg, rgba(90,107,93,0.5) 0%, rgba(26,24,22,0.9) 50%, rgba(184,148,77,0.3) 100%)";
  return "linear-gradient(155deg, rgba(26,24,22,0.95) 0%, rgba(90,107,93,0.4) 40%, rgba(184,148,77,0.35) 100%)";
}

function ServiceVisual({ service, index }: { service: Service; index: number }) {
  const SIcon = service.icon;
  return (
    <TiltCard tiltAmount={10} glareOpacity={0.12} className="h-full min-h-[320px] lg:min-h-[400px]">
      <div
        className="relative h-full min-h-[320px] lg:min-h-[400px] rounded-2xl overflow-hidden border flex flex-col justify-between p-8 lg:p-10"
        style={{
          background: tonePanelGradient(service.tone),
          borderColor: "var(--border-medium)",
          boxShadow: "0 24px 60px -20px rgba(26, 24, 22, 0.25)",
        }}
      >
        <div
          className="absolute inset-0 pointer-events-none opacity-40"
          style={{
            background: `radial-gradient(circle at 30% 20%, rgba(255,255,255,0.15) 0%, transparent 45%)`,
          }}
        />
        <div className="relative flex items-center gap-4">
          <div
            className="w-14 h-14 flex items-center justify-center rounded-xl"
            style={{
              background: "rgba(255,255,255,0.12)",
              border: "1px solid rgba(255,255,255,0.2)",
            }}
          >
            <SIcon className="w-7 h-7" style={{ color: "var(--cream)" }} />
          </div>
          <div>
            <p className="text-xs uppercase tracking-[0.2em] opacity-70" style={{ color: "var(--cream)" }}>
              {String(index + 1).padStart(2, "0")} — Offre
            </p>
            <p className="font-display text-xl lg:text-2xl" style={{ color: "var(--cream)" }}>
              {service.title}
            </p>
          </div>
        </div>
        <div className="relative grid grid-cols-2 gap-4">
          {Object.entries(service.stats).map(([key, value]) => (
            <div key={key} className="rounded-lg p-4" style={{ background: "rgba(0,0,0,0.2)" }}>
              <div className="font-display text-2xl lg:text-3xl" style={{ color: "var(--accent-warm-light)" }}>
                {value}
              </div>
              <div className="text-xs mt-1 capitalize opacity-75" style={{ color: "var(--cream)" }}>
                {key}
              </div>
            </div>
          ))}
        </div>
      </div>
    </TiltCard>
  );
}

export default function ServicesPage() {
  return (
    <>
      <InnerMarketingHero
        eyebrow="Nos services"
        title="Des solutions digitales"
        titleAccent="complètes et sur-mesure"
        accentSecondLine
        description="De la création web à la génération de leads, nous vous accompagnons dans toute votre transformation digitale avec la même exigence que sur notre vitrine."
        align="center"
      >
        <Link
          href="/contact"
          className="inline-flex items-center gap-3 px-8 py-4 font-medium transition-all duration-500"
          style={{
            background: "var(--text-primary)",
            color: "var(--bg-primary)",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "var(--accent-warm)";
            e.currentTarget.style.color = "var(--ink)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "var(--text-primary)";
            e.currentTarget.style.color = "var(--bg-primary)";
          }}
        >
          Discuter de votre projet
          <ArrowRight className="w-5 h-5" />
        </Link>
      </InnerMarketingHero>

      <section className="relative py-20 lg:py-28 overflow-hidden" style={{ background: "var(--bg-secondary)" }}>
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              "radial-gradient(ellipse at 20% 0%, var(--accent-glow) 0%, transparent 50%), radial-gradient(ellipse at 100% 80%, var(--accent-warm-glow) 0%, transparent 45%)",
          }}
        />
        <div
          className="absolute top-0 left-0 right-0 h-px"
          style={{ background: "linear-gradient(to right, transparent, var(--border-medium), transparent)" }}
        />
        <div className="max-w-7xl mx-auto px-6 lg:px-8 relative space-y-24 lg:space-y-32">
          {services.map((service, index) => (
            <ScrollReveal key={service.id} delay={index * 40} distance={48}>
              <div
                id={service.id}
                className={`grid lg:grid-cols-2 gap-12 lg:gap-16 items-center ${
                  index % 2 === 1 ? "lg:grid-flow-dense" : ""
                }`}
              >
                <div className={index % 2 === 1 ? "lg:col-start-2" : ""}>
                  <RowIcon icon={service.icon} />
                  <h2 className="font-display text-3xl lg:text-4xl mb-2" style={{ color: "var(--text-primary)" }}>
                    {service.title}
                  </h2>
                  <p className="text-lg font-medium mb-4" style={{ color: "var(--accent-warm-dark)" }}>
                    {service.subtitle}
                  </p>
                  <p className="mb-8 leading-relaxed" style={{ color: "var(--text-muted)" }}>
                    {service.description}
                  </p>
                  <div className="grid sm:grid-cols-2 gap-3 mb-8">
                    {service.features.map((feature) => (
                      <div key={feature} className="flex items-start gap-2 text-sm" style={{ color: "var(--text-secondary)" }}>
                        <Check className="w-5 h-5 flex-shrink-0 mt-0.5" style={{ color: "var(--accent)" }} />
                        <span>{feature}</span>
                      </div>
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-2 mb-8">
                    {service.technologies.map((tech) => (
                      <span
                        key={tech}
                        className="px-3 py-1 text-xs font-medium uppercase tracking-wider"
                        style={{
                          border: "1px solid var(--border-medium)",
                          color: "var(--text-muted)",
                          background: "var(--bg-card)",
                        }}
                      >
                        {tech}
                      </span>
                    ))}
                  </div>
                  <Link
                    href="/contact"
                    className="inline-flex items-center gap-2 font-medium group"
                    style={{ color: "var(--accent-warm-dark)" }}
                  >
                    Demander un devis
                    <ArrowRight className="w-5 h-5 transition-transform group-hover:translate-x-1" />
                  </Link>
                </div>
                <div className={index % 2 === 1 ? "lg:col-start-1 lg:row-start-1" : ""}>
                  <ServiceVisual service={service} index={index} />
                </div>
              </div>
            </ScrollReveal>
          ))}
        </div>
      </section>

      <section className="py-24 lg:py-32 relative" style={{ background: "var(--bg-primary)" }}>
        <div
          className="absolute top-0 left-0 right-0 h-px"
          style={{ background: "linear-gradient(to right, transparent, var(--border-medium), transparent)" }}
        />
        <div className="max-w-7xl mx-auto px-6 lg:px-8">
          <ScrollReveal className="text-center max-w-3xl mx-auto mb-16">
            <span className="marketing-eyebrow" style={{ color: "var(--accent)" }}>
              Notre approche
            </span>
            <h2 className="font-display text-3xl lg:text-5xl mt-4 leading-tight" style={{ color: "var(--text-primary)" }}>
              Un processus
              <br />
              <span style={{ color: "var(--accent-warm)" }}>éprouvé et transparent</span>
            </h2>
          </ScrollReveal>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6 lg:gap-8">
            {process.map((step, i) => (
              <ScrollReveal key={step.step} delay={i * 70} distance={40}>
                <div
                  className="relative h-full p-6 lg:p-8 rounded-2xl transition-all duration-500 hover:-translate-y-1"
                  style={{
                    background: "var(--bg-card)",
                    border: "1px solid var(--border-light)",
                    boxShadow: "0 4px 24px -8px rgba(26, 24, 22, 0.08)",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = "var(--accent-warm)";
                    e.currentTarget.style.boxShadow = "0 20px 40px -16px rgba(26, 24, 22, 0.12)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = "var(--border-light)";
                    e.currentTarget.style.boxShadow = "0 4px 24px -8px rgba(26, 24, 22, 0.08)";
                  }}
                >
                  <div
                    className="w-11 h-11 rounded-full flex items-center justify-center font-display text-lg mb-4"
                    style={{
                      background: "var(--accent-warm)",
                      color: "var(--ink)",
                    }}
                  >
                    {step.step}
                  </div>
                  <h3 className="font-semibold text-lg mb-2" style={{ color: "var(--text-primary)" }}>
                    {step.title}
                  </h3>
                  <p className="text-sm leading-relaxed" style={{ color: "var(--text-muted)" }}>
                    {step.description}
                  </p>
                </div>
              </ScrollReveal>
            ))}
          </div>
        </div>
      </section>

      <section className="py-24 lg:py-32 relative overflow-hidden" style={{ background: "var(--bg-secondary)" }}>
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ background: "radial-gradient(ellipse at 50% 100%, var(--accent-warm-glow) 0%, transparent 55%)" }}
        />
        <div className="max-w-7xl mx-auto px-6 lg:px-8 relative grid lg:grid-cols-3 gap-6 lg:gap-8">
          {[
            {
              icon: Zap,
              title: "Rapidité",
              text: "Méthodes agiles, premiers livrables visibles rapidement.",
            },
            {
              icon: Clock,
              title: "Disponibilité",
              text: "Interlocuteur dédié, réponse sous 24h.",
            },
            {
              icon: Shield,
              title: "Engagement",
              text: "Qualité, sécurité et suivi après livraison.",
            },
          ].map((b, i) => {
            const BIcon = b.icon;
            return (
            <ScrollReveal key={b.title} delay={i * 90} distance={36}>
              <TiltCard tiltAmount={8} className="h-full">
                <div
                  className="h-full p-8 rounded-2xl border relative overflow-hidden group"
                  style={{
                    background: "var(--bg-card)",
                    borderColor: "var(--border-medium)",
                  }}
                >
                  <div
                    className="absolute -right-8 -top-8 w-32 h-32 rounded-full opacity-0 group-hover:opacity-100 transition-opacity duration-700"
                    style={{ background: "var(--accent-warm-glow)" }}
                  />
                  <BIcon className="w-10 h-10 mb-4 relative z-10" style={{ color: "var(--accent-warm)" }} />
                  <h3 className="font-display text-2xl mb-2 relative z-10" style={{ color: "var(--text-primary)" }}>
                    {b.title}
                  </h3>
                  <p className="relative z-10 leading-relaxed" style={{ color: "var(--text-muted)" }}>
                    {b.text}
                  </p>
                </div>
              </TiltCard>
            </ScrollReveal>
            );
          })}
        </div>
      </section>

      <InnerMarketingCta
        eyebrow="Prochaine étape"
        title={
          <>
            Prêt à lancer votre <span style={{ color: "var(--accent-warm)" }}>projet</span> ?
          </>
        }
        subtitle="Premier échange gratuit et sans engagement. Nous revenons vers vous avec une proposition claire."
        href="/contact"
        ctaLabel="Demander un devis gratuit"
      />
    </>
  );
}
