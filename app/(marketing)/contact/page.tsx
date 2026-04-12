"use client";

import { useState, useRef } from "react";
import Link from "next/link";
import {
  Mail,
  Phone,
  MapPin,
  Send,
  Calendar,
  MessageSquare,
  Briefcase,
  CheckCircle,
  Loader2,
  ChevronDown,
} from "lucide-react";
import { InnerMarketingHero } from "../components/inner";
import { ScrollReveal } from "../components/animations/scroll-reveal";
import { TiltCard } from "../components/animations/tilt-card";

const contactReasons = [
  { id: "project", label: "J’ai un projet", icon: Briefcase },
  { id: "quote", label: "Demande de devis", icon: MessageSquare },
  { id: "meeting", label: "Prendre rendez-vous", icon: Calendar },
  { id: "other", label: "Autre demande", icon: Mail },
];

const services = [
  "Développement Web",
  "Application Web",
  "CRM / ERP",
  "Lead Generation",
  "SEO / Publicité",
  "Présence Digitale",
];

const budgets = [
  "< 5 000€",
  "5 000€ - 10 000€",
  "10 000€ - 25 000€",
  "25 000€ - 50 000€",
  "> 50 000€",
  "À définir",
];

const faqs = [
  {
    q: "Combien coûte un projet ?",
    a: "Chaque projet est unique. Nous établissons un devis après analyse de vos besoins. À titre indicatif : à partir de 3 000€ pour un site vitrine, à partir de 10 000€ pour une application web.",
  },
  {
    q: "Quels sont les délais ?",
    a: "Ils dépendent de la complexité. Un vitrine peut être livré en 2–4 semaines, une application en 2–4 mois. Nous vous donnons un planning détaillé dès le cadrage.",
  },
  {
    q: "Proposez-vous de la maintenance ?",
    a: "Oui : corrections, mises à jour, évolutions et support. Les formules sont adaptées à votre stack et à votre rythme de releases.",
  },
  {
    q: "Travaillez-vous en remote ?",
    a: "Oui. Équipe hybride, clients en France et à l’international. Nous utilisons les outils qui vous conviennent (Visio, Slack, Notion, etc.).",
  },
];

function FaqAccordion() {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <div className="space-y-3">
      {faqs.map((faq, i) => {
        const isOpen = open === i;
        return (
          <div
            key={faq.q}
            className="rounded-xl border overflow-hidden transition-all duration-500"
            style={{
              background: "var(--bg-card)",
              borderColor: isOpen ? "var(--accent-warm)" : "var(--border-light)",
              boxShadow: isOpen ? "0 16px 40px -20px rgba(26, 24, 22, 0.12)" : "none",
            }}
          >
            <button
              type="button"
              onClick={() => setOpen(isOpen ? null : i)}
              className="w-full flex items-center justify-between gap-4 p-5 text-left"
            >
              <span className="font-semibold pr-4" style={{ color: "var(--text-primary)" }}>
                {faq.q}
              </span>
              <ChevronDown
                className="w-5 h-5 flex-shrink-0 transition-transform duration-500"
                style={{
                  color: "var(--accent-warm)",
                  transform: isOpen ? "rotate(180deg)" : "rotate(0)",
                }}
              />
            </button>
            <div
              className="grid transition-[grid-template-rows] duration-500 ease-out"
              style={{ gridTemplateRows: isOpen ? "1fr" : "0fr" }}
            >
              <div className="min-h-0 overflow-hidden">
                <p className="px-5 pb-5 text-sm leading-relaxed" style={{ color: "var(--text-muted)" }}>
                  {faq.a}
                </p>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function ContactPage() {
  const [formState, setFormState] = useState({
    reason: "",
    name: "",
    email: "",
    phone: "",
    company: "",
    service: "",
    budget: "",
    message: "",
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const infoRef = useRef<HTMLDivElement>(null);
  const [imouse, setImouse] = useState({ x: 0.5, y: 0.5 });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    await new Promise((resolve) => setTimeout(resolve, 1500));
    setIsSubmitting(false);
    setIsSubmitted(true);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    setFormState((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const onInfoMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!infoRef.current) return;
    const r = infoRef.current.getBoundingClientRect();
    setImouse({ x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height });
  };

  if (isSubmitted) {
    return (
      <div className="pt-24 min-h-[70vh] flex items-center justify-center relative overflow-hidden" style={{ background: "var(--bg-primary)" }}>
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background: `radial-gradient(ellipse at 50% 40%, var(--accent-warm-glow) 0%, transparent 50%)`,
          }}
        />
        <ScrollReveal className="max-w-md mx-auto px-6 text-center relative z-10">
          <div
            className="w-24 h-24 rounded-full flex items-center justify-center mx-auto mb-8 animate-pulse"
            style={{ background: "var(--accent-subtle)", color: "var(--accent-warm-dark)" }}
          >
            <CheckCircle className="w-12 h-12" />
          </div>
          <h1 className="font-display text-3xl mb-4" style={{ color: "var(--text-primary)" }}>
            Message envoyé
          </h1>
          <p className="mb-10 leading-relaxed" style={{ color: "var(--text-muted)" }}>
            Merci pour votre message. Nous revenons vers vous sous 24h ouvrées.
          </p>
          <button
            type="button"
            onClick={() => {
              setIsSubmitted(false);
              setFormState({
                reason: "",
                name: "",
                email: "",
                phone: "",
                company: "",
                service: "",
                budget: "",
                message: "",
              });
            }}
            className="font-medium underline-offset-4 hover:underline"
            style={{ color: "var(--accent-warm-dark)" }}
          >
            Envoyer un autre message
          </button>
        </ScrollReveal>
      </div>
    );
  }

  return (
    <>
      <InnerMarketingHero
        eyebrow="Contact"
        title="Parlons de votre"
        titleAccent="projet"
        description="Une question, une idée, un cadrage ? Nous répondons sous 24h. Même ton, même soin que sur l’accueil."
        align="center"
      />

      <section className="py-12 lg:py-20 relative" style={{ background: "var(--bg-secondary)" }}>
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              "radial-gradient(ellipse at 0% 50%, var(--accent-glow) 0%, transparent 45%), radial-gradient(ellipse at 100% 30%, var(--accent-warm-glow) 0%, transparent 40%)",
          }}
        />
        <div className="max-w-7xl mx-auto px-6 lg:px-8 relative grid lg:grid-cols-3 gap-12 lg:gap-16">
          <div ref={infoRef} onMouseMove={onInfoMove} className="lg:col-span-1 relative">
            <div
              className="absolute -inset-4 rounded-3xl opacity-50 pointer-events-none blur-2xl"
              style={{
                background: `radial-gradient(ellipse at ${imouse.x * 100}% ${imouse.y * 100}%, var(--accent-warm-glow) 0%, transparent 55%)`,
              }}
            />
            <ScrollReveal distance={36}>
              <h2 className="font-display text-2xl mb-6" style={{ color: "var(--text-primary)" }}>
                Coordonnées
              </h2>
              <div className="space-y-4 mb-10">
                {[
                  {
                    href: "mailto:contact@lahaut.agency",
                    icon: Mail,
                    label: "Email",
                    value: "contact@lahaut.agency",
                  },
                  {
                    href: "tel:+33123456789",
                    icon: Phone,
                    label: "Téléphone",
                    value: "+33 1 23 45 67 89",
                  },
                ].map((item) => {
                  const Ic = item.icon;
                  return (
                    <a
                      key={item.label}
                      href={item.href}
                      className="flex items-start gap-4 p-4 rounded-xl border transition-all duration-300 group"
                      style={{
                        background: "var(--bg-card)",
                        borderColor: "var(--border-light)",
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.borderColor = "var(--accent-warm)";
                        e.currentTarget.style.transform = "translateX(4px)";
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.borderColor = "var(--border-light)";
                        e.currentTarget.style.transform = "translateX(0)";
                      }}
                    >
                      <div
                        className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 transition-colors duration-300"
                        style={{ background: "var(--accent-subtle)", color: "var(--accent-warm-dark)" }}
                      >
                        <Ic className="w-6 h-6" />
                      </div>
                      <div>
                        <div className="font-medium mb-0.5" style={{ color: "var(--text-primary)" }}>
                          {item.label}
                        </div>
                        <div className="text-sm" style={{ color: "var(--text-muted)" }}>
                          {item.value}
                        </div>
                      </div>
                    </a>
                  );
                })}
                <div
                  className="flex items-start gap-4 p-4 rounded-xl border"
                  style={{ background: "var(--bg-card)", borderColor: "var(--border-light)" }}
                >
                  <div
                    className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0"
                    style={{ background: "var(--accent-subtle)", color: "var(--accent-warm-dark)" }}
                  >
                    <MapPin className="w-6 h-6" />
                  </div>
                  <div>
                    <div className="font-medium mb-0.5" style={{ color: "var(--text-primary)" }}>
                      Adresse
                    </div>
                    <div className="text-sm" style={{ color: "var(--text-muted)" }}>
                      Paris, France
                      <br />
                      Sur rendez-vous
                    </div>
                  </div>
                </div>
              </div>

              <div className="relative rounded-2xl p-px overflow-hidden">
                <div className="absolute inset-0 shimmer-border opacity-40" />
                <div className="relative rounded-2xl p-6" style={{ background: "var(--ink)", color: "var(--cream)" }}>
                  <h3 className="font-semibold mb-4">Pourquoi nous écrire</h3>
                  <ul className="space-y-3 text-sm" style={{ color: "rgba(240,235,226,0.85)" }}>
                    <li className="flex items-center gap-2">
                      <CheckCircle className="w-5 h-5 flex-shrink-0" style={{ color: "var(--accent-warm)" }} />
                      Devis gratuit sous 24h
                    </li>
                    <li className="flex items-center gap-2">
                      <CheckCircle className="w-5 h-5 flex-shrink-0" style={{ color: "var(--accent-warm)" }} />
                      Sans engagement
                    </li>
                    <li className="flex items-center gap-2">
                      <CheckCircle className="w-5 h-5 flex-shrink-0" style={{ color: "var(--accent-warm)" }} />
                      100% Made in France
                    </li>
                    <li className="flex items-center gap-2">
                      <CheckCircle className="w-5 h-5 flex-shrink-0" style={{ color: "var(--accent-warm)" }} />
                      Réponse humaine, pas un bot
                    </li>
                  </ul>
                </div>
              </div>
            </ScrollReveal>
          </div>

          <div className="lg:col-span-2">
            <ScrollReveal distance={44} delay={60}>
              <TiltCard tiltAmount={5} glareOpacity={0.08}>
                <div
                  className="rounded-2xl border p-8 lg:p-10 relative overflow-hidden"
                  style={{
                    background: "var(--bg-card)",
                    borderColor: "var(--border-medium)",
                    boxShadow: "0 24px 48px -24px rgba(26, 24, 22, 0.14)",
                  }}
                >
                  <div
                    className="absolute top-0 right-0 w-64 h-64 rounded-full opacity-30 pointer-events-none"
                    style={{ background: "var(--accent-warm-glow)", filter: "blur(60px)", transform: "translate(30%, -40%)" }}
                  />
                  <h2 className="font-display text-2xl mb-2 relative z-10" style={{ color: "var(--text-primary)" }}>
                    Envoyez-nous un message
                  </h2>
                  <p className="mb-8 relative z-10" style={{ color: "var(--text-muted)" }}>
                    Plus vous êtes précis, plus notre retour sera utile.
                  </p>

                  <form onSubmit={handleSubmit} className="space-y-6 relative z-10">
                    <div>
                      <label className="block text-sm font-medium mb-3" style={{ color: "var(--text-primary)" }}>
                        Objet de votre demande *
                      </label>
                      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                        {contactReasons.map((reason) => {
                          const Rc = reason.icon;
                          const active = formState.reason === reason.id;
                          return (
                            <button
                              key={reason.id}
                              type="button"
                              onClick={() => setFormState((p) => ({ ...p, reason: reason.id }))}
                              className="p-4 rounded-xl border text-center transition-all duration-300"
                              style={{
                                borderColor: active ? "var(--accent-warm)" : "var(--border-light)",
                                background: active ? "var(--accent-warm-glow)" : "transparent",
                                transform: active ? "translateY(-2px)" : "none",
                                boxShadow: active ? "0 12px 28px -12px rgba(184, 148, 77, 0.35)" : "none",
                              }}
                            >
                              <Rc
                                className="w-6 h-6 mx-auto mb-2"
                                style={{ color: active ? "var(--accent-warm-dark)" : "var(--text-muted)" }}
                              />
                              <span className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
                                {reason.label}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div className="grid md:grid-cols-2 gap-6">
                      <div>
                        <label htmlFor="name" className="block text-sm font-medium mb-2" style={{ color: "var(--text-primary)" }}>
                          Nom complet *
                        </label>
                        <input
                          type="text"
                          id="name"
                          name="name"
                          required
                          value={formState.name}
                          onChange={handleChange}
                          className="input-minimal w-full"
                          placeholder="Jean Dupont"
                          style={{ background: "var(--bg-primary)" }}
                        />
                      </div>
                      <div>
                        <label htmlFor="email" className="block text-sm font-medium mb-2" style={{ color: "var(--text-primary)" }}>
                          Email *
                        </label>
                        <input
                          type="email"
                          id="email"
                          name="email"
                          required
                          value={formState.email}
                          onChange={handleChange}
                          className="input-minimal w-full"
                          placeholder="jean@entreprise.fr"
                          style={{ background: "var(--bg-primary)" }}
                        />
                      </div>
                    </div>

                    <div className="grid md:grid-cols-2 gap-6">
                      <div>
                        <label htmlFor="phone" className="block text-sm font-medium mb-2" style={{ color: "var(--text-primary)" }}>
                          Téléphone
                        </label>
                        <input
                          type="tel"
                          id="phone"
                          name="phone"
                          value={formState.phone}
                          onChange={handleChange}
                          className="input-minimal w-full"
                          placeholder="+33 6 12 34 56 78"
                          style={{ background: "var(--bg-primary)" }}
                        />
                      </div>
                      <div>
                        <label htmlFor="company" className="block text-sm font-medium mb-2" style={{ color: "var(--text-primary)" }}>
                          Entreprise
                        </label>
                        <input
                          type="text"
                          id="company"
                          name="company"
                          value={formState.company}
                          onChange={handleChange}
                          className="input-minimal w-full"
                          placeholder="Nom de l’entreprise"
                          style={{ background: "var(--bg-primary)" }}
                        />
                      </div>
                    </div>

                    <div className="grid md:grid-cols-2 gap-6">
                      <div>
                        <label htmlFor="service" className="block text-sm font-medium mb-2" style={{ color: "var(--text-primary)" }}>
                          Service souhaité
                        </label>
                        <select
                          id="service"
                          name="service"
                          value={formState.service}
                          onChange={handleChange}
                          className="input-minimal w-full"
                          style={{ background: "var(--bg-primary)" }}
                        >
                          <option value="">Sélectionnez</option>
                          {services.map((s) => (
                            <option key={s} value={s}>
                              {s}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label htmlFor="budget" className="block text-sm font-medium mb-2" style={{ color: "var(--text-primary)" }}>
                          Budget estimé
                        </label>
                        <select
                          id="budget"
                          name="budget"
                          value={formState.budget}
                          onChange={handleChange}
                          className="input-minimal w-full"
                          style={{ background: "var(--bg-primary)" }}
                        >
                          <option value="">Sélectionnez</option>
                          {budgets.map((b) => (
                            <option key={b} value={b}>
                              {b}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div>
                      <label htmlFor="message" className="block text-sm font-medium mb-2" style={{ color: "var(--text-primary)" }}>
                        Votre message *
                      </label>
                      <textarea
                        id="message"
                        name="message"
                        required
                        rows={5}
                        value={formState.message}
                        onChange={handleChange}
                        className="input-minimal resize-none w-full"
                        placeholder="Contexte, objectifs, contraintes, liens utiles…"
                        style={{ background: "var(--bg-primary)" }}
                      />
                    </div>

                    <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pt-4">
                      <p className="text-sm" style={{ color: "var(--text-subtle)" }}>
                        * Champs obligatoires
                      </p>
                      <button
                        type="submit"
                        disabled={
                          isSubmitting ||
                          !formState.reason ||
                          !formState.name ||
                          !formState.email ||
                          !formState.message
                        }
                        className="inline-flex items-center gap-2 px-8 py-3.5 font-medium transition-all duration-500 disabled:opacity-45 disabled:cursor-not-allowed disabled:hover:translate-y-0 hover:-translate-y-0.5"
                        style={{
                          background: "var(--text-primary)",
                          color: "var(--bg-primary)",
                        }}
                        onMouseEnter={(e) => {
                          if (!e.currentTarget.disabled) e.currentTarget.style.background = "var(--accent-warm)";
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = "var(--text-primary)";
                        }}
                      >
                        {isSubmitting ? (
                          <>
                            <Loader2 className="w-5 h-5 animate-spin" />
                            Envoi…
                          </>
                        ) : (
                          <>
                            Envoyer
                            <Send className="w-5 h-5" />
                          </>
                        )}
                      </button>
                    </div>
                  </form>
                </div>
              </TiltCard>
            </ScrollReveal>
          </div>
        </div>
      </section>

      <section className="py-20 lg:py-28 relative" style={{ background: "var(--bg-primary)" }}>
        <div
          className="absolute top-0 left-0 right-0 h-px"
          style={{ background: "linear-gradient(to right, transparent, var(--border-medium), transparent)" }}
        />
        <div className="max-w-3xl mx-auto px-6 lg:px-8">
          <ScrollReveal className="text-center mb-12">
            <h2 className="font-display text-3xl mb-3" style={{ color: "var(--text-primary)" }}>
              Questions fréquentes
            </h2>
            <p style={{ color: "var(--text-muted)" }}>Réponses courtes — le détail se discute en direct.</p>
          </ScrollReveal>
          <ScrollReveal delay={80} distance={30}>
            <FaqAccordion />
          </ScrollReveal>
        </div>
      </section>

      <section className="py-16 text-center" style={{ background: "var(--bg-secondary)" }}>
        <Link
          href="/"
          className="text-sm font-medium transition-colors"
          style={{ color: "var(--text-muted)" }}
          onMouseEnter={(e) => (e.currentTarget.style.color = "var(--accent-warm-dark)")}
          onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-muted)")}
        >
          Retour à l’accueil
        </Link>
      </section>
    </>
  );
}
