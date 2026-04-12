"use client";

import Link from "next/link";
import { useRef, useState, useEffect } from "react";
import {
  ArrowRight,
  Target,
  Heart,
  Lightbulb,
  Users,
  Award,
  MapPin,
  Calendar,
  type LucideIcon,
} from "lucide-react";
import { InnerMarketingHero, InnerMarketingCta } from "../components/inner";
import { ScrollReveal } from "../components/animations/scroll-reveal";
import { TiltCard } from "../components/animations/tilt-card";
import { FloatingElement } from "../components/animations/tilt-card";

const values: { icon: LucideIcon; title: string; description: string }[] = [
  {
    icon: Target,
    title: "Excellence",
    description: "Exigence sur la qualité du code, du design et de la communication.",
  },
  {
    icon: Heart,
    title: "Passion",
    description: "Le digital comme levier durable pour les entreprises qu’on accompagne.",
  },
  {
    icon: Lightbulb,
    title: "Innovation",
    description: "Stack moderne, méthodes agiles, veille continue.",
  },
  {
    icon: Users,
    title: "Collaboration",
    description: "Transparence, pair-design avec vous, décisions partagées.",
  },
];

const team = [
  { name: "Alexandre Martin", role: "Fondateur & CEO", bio: "10+ ans web et stratégie digitale.", initials: "AM" },
  { name: "Sophie Dubois", role: "Directrice Technique", bio: "Architecture cloud et scalabilité.", initials: "SD" },
  { name: "Thomas Bernard", role: "Lead Developer", bio: "React / Next.js et UX.", initials: "TB" },
  { name: "Julie Moreau", role: "Growth Manager", bio: "Acquisition et leads B2B.", initials: "JM" },
  { name: "Nicolas Petit", role: "Designer UX/UI", bio: "Interfaces sobres et efficaces.", initials: "NP" },
  { name: "Marie Lefevre", role: "Chef de Projet", bio: "Qualité, planning, relation client.", initials: "ML" },
];

const milestones = [
  { year: "2016", event: "Création de LàHaut Agency à Paris" },
  { year: "2018", event: "Premier grand compte, équipe qui grandit." },
  { year: "2020", event: "Organisation hybride, produits SaaS internes." },
  { year: "2022", event: "100e projet livré, culture qualité renforcée." },
  { year: "2024", event: "Clients France & international, équipe élargie." },
];

function Timeline() {
  const ref = useRef<HTMLDivElement>(null);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          let start: number | null = null;
          const duration = 1400;
          const step = (ts: number) => {
            if (start === null) start = ts;
            const p = Math.min((ts - start) / duration, 1);
            setProgress(p);
            if (p < 1) requestAnimationFrame(step);
          };
          requestAnimationFrame(step);
          obs.disconnect();
        }
      },
      { threshold: 0.2 }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  return (
    <div ref={ref} className="max-w-3xl mx-auto relative pl-4 md:pl-0">
      <div
        className="absolute left-[31px] md:left-[31px] top-3 bottom-3 w-px overflow-hidden rounded-full"
        style={{ background: "var(--border-medium)" }}
      >
        <div
          className="w-full origin-top"
          style={{
            height: `${progress * 100}%`,
            background: "linear-gradient(to bottom, var(--accent-warm), var(--accent))",
            transition: "height 0.05s linear",
          }}
        />
      </div>
      <div className="space-y-12 relative">
        {milestones.map((m, i) => (
          <ScrollReveal key={m.year} delay={i * 100} distance={32}>
            <div className="flex gap-6 md:gap-8 items-start">
              <div
                className="w-14 h-14 rounded-full flex-shrink-0 flex items-center justify-center z-10 border-2 transition-transform duration-500 hover:scale-105"
                style={{
                  background: "var(--bg-card)",
                  borderColor: "var(--accent-warm)",
                  color: "var(--accent-warm)",
                }}
              >
                <Calendar className="w-6 h-6" />
              </div>
              <div className="pt-2">
                <div className="font-display text-2xl mb-1" style={{ color: "var(--accent-warm)" }}>
                  {m.year}
                </div>
                <p className="text-lg leading-relaxed" style={{ color: "var(--text-primary)" }}>
                  {m.event}
                </p>
              </div>
            </div>
          </ScrollReveal>
        ))}
      </div>
    </div>
  );
}

export default function AgencePage() {
  const visualRef = useRef<HTMLDivElement>(null);
  const [vmouse, setVmouse] = useState({ x: 0.5, y: 0.5 });

  const onVisualMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!visualRef.current) return;
    const r = visualRef.current.getBoundingClientRect();
    setVmouse({ x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height });
  };

  return (
    <>
      <InnerMarketingHero
        eyebrow="L’agence"
        title="Une structure"
        titleAccent="à taille humaine"
        accentSecondLine
        description="Depuis 2016, nous aidons les marques et les équipes à construire des produits digitaux sérieux : performance, clarté et relation directe."
        align="left"
      >
        <div className="flex flex-wrap gap-10 mt-4">
          {[
            { n: "8+", l: "Années" },
            { n: "150+", l: "Projets" },
            { n: "25", l: "Talents" },
          ].map((s) => (
            <div key={s.l}>
              <div className="font-display text-4xl" style={{ color: "var(--accent-warm)" }}>
                {s.n}
              </div>
              <div className="text-sm" style={{ color: "var(--text-muted)" }}>
                {s.l}
              </div>
            </div>
          ))}
        </div>
      </InnerMarketingHero>

      <section className="py-20 lg:py-28 relative overflow-hidden" style={{ background: "var(--bg-secondary)" }}>
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              "radial-gradient(ellipse at 80% 20%, var(--accent-warm-glow) 0%, transparent 50%), radial-gradient(ellipse at 10% 80%, var(--accent-glow) 0%, transparent 45%)",
          }}
        />
        <div className="max-w-7xl mx-auto px-6 lg:px-8 relative grid lg:grid-cols-2 gap-14 items-center">
          <ScrollReveal distance={40}>
            <p className="text-lg leading-relaxed mb-6" style={{ color: "var(--text-secondary)" }}>
              LàHaut Agency, c’est une équipe de passionnés qui allie exécution technique et vision business. Nous
              préférons les engagements tenus aux promesses creuses.
            </p>
            <Link
              href="/contact"
              className="inline-flex items-center gap-2 font-medium group"
              style={{ color: "var(--accent-warm-dark)" }}
            >
              Rencontrer l’équipe
              <ArrowRight className="w-5 h-5 transition-transform group-hover:translate-x-1" />
            </Link>
          </ScrollReveal>
          <div
            ref={visualRef}
            onMouseMove={onVisualMove}
            className="relative aspect-square max-w-lg mx-auto rounded-3xl overflow-hidden border"
            style={{
              borderColor: "var(--border-medium)",
              boxShadow: "0 32px 64px -24px rgba(26, 24, 22, 0.2)",
            }}
          >
            <div
              className="absolute inset-0"
              style={{
                background: `
                  radial-gradient(circle at ${vmouse.x * 100}% ${vmouse.y * 100}%, rgba(184,148,77,0.35) 0%, transparent 50%),
                  linear-gradient(145deg, rgba(26,24,22,0.95) 0%, rgba(90,107,93,0.5) 100%)
                `,
                transition: "background 0.4s ease-out",
              }}
            />
            <FloatingElement duration={7} distance={12} className="absolute top-10 right-10">
              <div className="w-20 h-20 rounded-full opacity-80" style={{ background: "var(--accent-warm-glow)" }} />
            </FloatingElement>
            <FloatingElement duration={9} distance={10} delay={1} className="absolute bottom-12 left-8">
              <div className="w-28 h-28 rounded-full opacity-60" style={{ background: "var(--accent-glow)" }} />
            </FloatingElement>
            <div className="absolute inset-0 flex items-center justify-center p-8">
              <div className="text-center" style={{ color: "var(--cream)" }}>
                <div
                  className="w-24 h-24 mx-auto mb-4 flex items-center justify-center rounded-2xl border backdrop-blur-sm"
                  style={{ borderColor: "rgba(255,255,255,0.2)", background: "rgba(0,0,0,0.2)" }}
                >
                  <span className="font-display text-4xl">L</span>
                </div>
                <div className="font-display text-2xl">LàHaut Agency</div>
                <div className="opacity-80 text-sm mt-1">Depuis 2016</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="py-24 lg:py-32" style={{ background: "var(--bg-primary)" }}>
        <div className="max-w-7xl mx-auto px-6 lg:px-8">
          <ScrollReveal className="max-w-3xl mx-auto text-center mb-16">
            <span className="marketing-eyebrow" style={{ color: "var(--accent)" }}>
              Mission
            </span>
            <h2 className="font-display text-3xl lg:text-5xl mt-4 leading-tight" style={{ color: "var(--text-primary)" }}>
              Transformer les idées en
              <br />
              <span style={{ color: "var(--accent-warm)" }}>succès digitaux</span>
            </h2>
            <p className="mt-6 text-lg leading-relaxed" style={{ color: "var(--text-muted)" }}>
              Chaque entreprise mérite une présence en ligne à la hauteur de son sérieux. Nous traduisons vos objectifs
              en roadmaps et en livrables mesurables.
            </p>
          </ScrollReveal>

          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
            {values.map((v, i) => {
              const VIcon = v.icon;
              return (
                <ScrollReveal key={v.title} delay={i * 80} distance={36}>
                  <TiltCard tiltAmount={9} className="h-full">
                    <div
                      className="h-full p-6 rounded-2xl border text-center transition-all duration-500 hover:-translate-y-1"
                      style={{
                        background: "var(--bg-card)",
                        borderColor: "var(--border-light)",
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.borderColor = "var(--accent-warm)";
                        e.currentTarget.style.boxShadow = "0 20px 40px -18px rgba(26, 24, 22, 0.15)";
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.borderColor = "var(--border-light)";
                        e.currentTarget.style.boxShadow = "none";
                      }}
                    >
                      <div
                        className="w-14 h-14 rounded-xl flex items-center justify-center mx-auto mb-4"
                        style={{ background: "var(--accent-subtle)", color: "var(--accent-warm-dark)" }}
                      >
                        <VIcon className="w-7 h-7" />
                      </div>
                      <h3 className="font-semibold text-lg mb-2" style={{ color: "var(--text-primary)" }}>
                        {v.title}
                      </h3>
                      <p className="text-sm leading-relaxed" style={{ color: "var(--text-muted)" }}>
                        {v.description}
                      </p>
                    </div>
                  </TiltCard>
                </ScrollReveal>
              );
            })}
          </div>
        </div>
      </section>

      <section className="py-24 lg:py-32 relative" style={{ background: "var(--bg-secondary)" }}>
        <div
          className="absolute inset-0 pointer-events-none opacity-70"
          style={{ background: "radial-gradient(ellipse at 50% 0%, var(--accent-glow) 0%, transparent 55%)" }}
        />
        <div className="max-w-7xl mx-auto px-6 lg:px-8 relative">
          <ScrollReveal className="text-center mb-14">
            <span className="marketing-eyebrow" style={{ color: "var(--accent)" }}>
              Équipe
            </span>
            <h2 className="font-display text-3xl lg:text-5xl mt-4" style={{ color: "var(--text-primary)" }}>
              Les talents derrière{" "}
              <span style={{ color: "var(--accent-warm)" }}>vos projets</span>
            </h2>
            <p className="mt-4 max-w-2xl mx-auto" style={{ color: "var(--text-muted)" }}>
              Profils seniors et complémentaires, même exigence sur la qualité et les délais.
            </p>
          </ScrollReveal>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6 lg:gap-8">
            {team.map((member, i) => (
              <ScrollReveal key={member.name} delay={(i % 3) * 90} distance={40}>
                <div
                  className="group p-6 rounded-2xl border h-full transition-all duration-500"
                  style={{
                    background: "var(--bg-card)",
                    borderColor: "var(--border-light)",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = "var(--accent)";
                    e.currentTarget.style.transform = "translateY(-4px)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = "var(--border-light)";
                    e.currentTarget.style.transform = "translateY(0)";
                  }}
                >
                  <div className="flex items-start gap-4">
                    <div
                      className="w-14 h-14 rounded-xl flex items-center justify-center font-display text-lg flex-shrink-0 transition-transform duration-500 group-hover:scale-105"
                      style={{
                        background: "linear-gradient(135deg, var(--accent-warm), var(--accent-dark))",
                        color: "var(--cream)",
                      }}
                    >
                      {member.initials}
                    </div>
                    <div>
                      <h3 className="font-semibold text-lg" style={{ color: "var(--text-primary)" }}>
                        {member.name}
                      </h3>
                      <p className="text-sm font-medium mb-2" style={{ color: "var(--accent-warm-dark)" }}>
                        {member.role}
                      </p>
                      <p className="text-sm leading-relaxed" style={{ color: "var(--text-muted)" }}>
                        {member.bio}
                      </p>
                    </div>
                  </div>
                </div>
              </ScrollReveal>
            ))}
          </div>
        </div>
      </section>

      <section className="py-24 lg:py-32" style={{ background: "var(--bg-primary)" }}>
        <div className="max-w-7xl mx-auto px-6 lg:px-8">
          <ScrollReveal className="text-center mb-14">
            <span className="marketing-eyebrow" style={{ color: "var(--accent)" }}>
              Histoire
            </span>
            <h2 className="font-display text-3xl lg:text-5xl mt-4" style={{ color: "var(--text-primary)" }}>
              Une trajectoire
              <br />
              <span style={{ color: "var(--accent-warm)" }}>construite pas à pas</span>
            </h2>
          </ScrollReveal>
          <Timeline />
        </div>
      </section>

      <section className="py-24 lg:py-32 relative overflow-hidden" style={{ background: "var(--bg-secondary)" }}>
        <div className="max-w-7xl mx-auto px-6 lg:px-8 grid lg:grid-cols-2 gap-12 items-center">
          <ScrollReveal distance={40}>
            <span className="marketing-eyebrow" style={{ color: "var(--accent)" }}>
              Localisation
            </span>
            <h2 className="font-display text-3xl lg:text-4xl mt-4 mb-6 leading-tight" style={{ color: "var(--text-primary)" }}>
              Basés à Paris,
              <br />
              <span style={{ color: "var(--accent-warm)" }}>actifs partout</span>
            </h2>
            <p className="leading-relaxed mb-8" style={{ color: "var(--text-muted)" }}>
              Mode hybride : bureaux parisiens et remote. Clients en France et à l’international, mêmes standards de
              livraison.
            </p>
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: "var(--accent-subtle)" }}>
                  <MapPin className="w-5 h-5" style={{ color: "var(--accent-warm-dark)" }} />
                </div>
                <span style={{ color: "var(--text-primary)" }}>Paris, France</span>
              </div>
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: "var(--accent-subtle)" }}>
                  <Award className="w-5 h-5" style={{ color: "var(--accent-warm-dark)" }} />
                </div>
                <span style={{ color: "var(--text-primary)" }}>Engagement qualité & transparence</span>
              </div>
            </div>
          </ScrollReveal>
          <ScrollReveal distance={50} delay={80}>
            <div
              className="aspect-video rounded-2xl border relative overflow-hidden flex items-center justify-center"
              style={{
                borderColor: "var(--border-medium)",
                background: "var(--bg-card)",
              }}
            >
              <div
                className="absolute inset-0 opacity-40"
                style={{
                  background:
                    "radial-gradient(circle at 40% 40%, var(--accent-warm-glow) 0%, transparent 50%), radial-gradient(circle at 70% 70%, var(--accent-glow) 0%, transparent 45%)",
                }}
              />
              <div className="relative text-center z-10">
                <MapPin className="w-12 h-12 mx-auto mb-2" style={{ color: "var(--accent-warm)" }} />
                <p style={{ color: "var(--text-muted)" }}>Paris & remote</p>
              </div>
            </div>
          </ScrollReveal>
        </div>
      </section>

      <InnerMarketingCta
        eyebrow="Rejoindre l’aventure"
        title={
          <>
            Un projet ou une <span style={{ color: "var(--accent-warm)" }}>candidature</span> ?
          </>
        }
        subtitle="Clients ou talents : échangeons sur ce que nous pouvons construire ensemble."
        href="/contact"
        ctaLabel="Démarrer un projet"
        secondaryHref="/contact"
        secondaryLabel="Nous contacter"
      />
    </>
  );
}
