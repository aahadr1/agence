import { askGemini } from "../lead-agent/browser";
import type { CompetitorAnalysis, PainPoint, RecommendedOffer } from "@/lib/types";

/** Snapshot passed to the model — only facts gathered during research */
export interface InsightDossier {
  business_name: string;
  niche_category: string | null;
  maps_description: string | null;
  city: string | null;
  address: string | null;

  website_url: string | null;
  website_score: number | null;
  website_quality: string | null;
  has_https: boolean;
  has_booking: boolean;
  has_chatbot: boolean;
  has_contact_form: boolean;
  website_tech_notes: string | null;
  website_pain_summary: string | null;

  google_rating: number | null;
  google_review_count: number | null;
  review_highlights: string[];

  has_meta_ads: boolean;
  meta_ads_count: number;
  facebook_url: string | null;
  instagram_url: string | null;
  facebook_followers: number | null;
  linkedin_url: string | null;

  owner_name: string | null;
  company_type: string | null;
  revenue_bracket: string | null;
  employee_count: string | null;
  creation_date: string | null;

  competitors: CompetitorAnalysis[];
}

export interface BusinessReflection {
  vertical_label: string;
  business_model_summary: string;
  digital_expectations_for_vertical: string;
  how_to_interpret_booking_signal: string;
  competitor_pressure_notes: string;
  review_angle: string;
  scoring_weights: {
    missing_booking_gap: number;
    missing_chatbot_gap: number;
  };
}

export interface ContextualInsightsResult {
  reflection: BusinessReflection;
  pain_points: PainPoint[];
  recommended_offers: RecommendedOffer[];
}

function clamp01(n: unknown, fallback: number): number {
  const x = typeof n === "number" && !Number.isNaN(n) ? n : fallback;
  return Math.min(1, Math.max(0, x));
}

function asSeverity(s: unknown): PainPoint["severity"] {
  const v = String(s || "").toLowerCase();
  if (v === "critical" || v === "high" || v === "medium" || v === "low") return v;
  return "medium";
}

function asPriority(s: unknown): RecommendedOffer["priority"] {
  const v = String(s || "").toLowerCase();
  if (v === "high" || v === "medium" || v === "low") return v;
  return "medium";
}

/**
 * Two-phase Gemini flow: (1) sector reflexion + scoring weights, (2) contextual lacunes & offers.
 * Falls back to null on failure so the caller can use rule-based detection.
 */
export async function runContextualInsights(
  dossier: InsightDossier,
  log: (msg: string) => void
): Promise<ContextualInsightsResult | null> {
  const dossierJson = JSON.stringify(dossier, null, 2);

  try {
    log("[Insights] Phase 1 — Lecture métier & cadre digital…");
    const reflection = await askGemini<BusinessReflection>(
      `Tu es un stratège commercial senior (agence digitale française, B2B local).

Tu reçois un DOSSIER STRUCTURÉ issu de recherches réelles sur une entreprise. N'invente AUCUN fait : si une donnée manque, dis-le explicitement.

DOSSIER:
${dossierJson}

TÂCHE — Phase 1 « réflexion » (JSON uniquement, en français) :
{
  "vertical_label": "secteur précis (ex. Agence immobilière, Restaurant, Salon de coiffure, Cabinet d'avocats)",
  "business_model_summary": "2 à 4 phrases : ce qu'ils vendent, comment les clients entrent en contact, parcours type",
  "digital_expectations_for_vertical": "2 à 4 phrases : ce qu'une présence digitale crédible signifie POUR CE MÉTIER (pas du générique PME)",
  "how_to_interpret_booking_signal": "1 à 3 phrases : pour CETTE activité, est-ce qu'une « réservation en ligne » type resto est pertinente, ou plutôt prise de RDV visites/estimations, formulaire, téléphone ? Mentionner has_booking=${dossier.has_booking}.",
  "competitor_pressure_notes": "1 à 4 phrases : tirées uniquement des concurrents du dossier",
  "review_angle": "1 à 3 phrases : ce que les avis suggèrent ; s'il n'y en a pas, le dire",
  "scoring_weights": {
    "missing_booking_gap": nombre 0 à 1 — 1 seulement si l'absence d'automatisation / prise de rendez-vous en ligne est un vrai handicap pour CE métier ; 0 si le canal téléphone/formulaire est la norme (ex. beaucoup d'immobilier, B2B juridique, etc.),
    "missing_chatbot_gap": nombre 0 à 1 — 1 si capture de leads / FAQ instantanée compte vraiment ; moins si relation hautement personnalisée
  }
}

Réponds par un JSON valide uniquement.`
    );

    if (!reflection || typeof reflection.vertical_label !== "string") {
      log("[Insights] Phase 1 — réponse invalide");
      return null;
    }

    const rw = reflection.scoring_weights || { missing_booking_gap: 1, missing_chatbot_gap: 1 };
    reflection.scoring_weights = {
      missing_booking_gap: clamp01(rw.missing_booking_gap, 1),
      missing_chatbot_gap: clamp01(rw.missing_chatbot_gap, 1),
    };

    log("[Insights] Phase 2 — Lacunes & offres contextualisées…");
    const synthesized = await askGemini<{
      pain_points: Array<{
        label: string;
        severity: string;
        description: string;
        related_offer: string;
      }>;
      recommended_offers: Array<{
        name: string;
        reason: string;
        priority: string;
        estimated_value: string;
      }>;
    }>(
      `Tu es le même stratège. Phase 2 — synthèse commerciale.

RÉFLEXION (cadre prioritaire, ne pas la contredire) :
${JSON.stringify(reflection, null, 2)}

DOSSIER (faits — tu DOIS t'appuyer sur ces signaux dans les textes) :
${dossierJson}

RÈGLES STRICTES :
- 3 à 7 lacunes maximum, chacune SPÉCIFIQUE à cette entreprise et à ce vertical. Interdit : appliquer un modèle « restaurant » (résa table 24h/7) à une agence immobilière, un avocat, un grossiste, etc.
- Chaque lacune doit citer au moins un signal concret du dossier (score site, HTTPS, pubs Meta, réseaux, avis, concurrents, taille légale, etc.).
- Si un signal technique (ex. has_booking=false) n'est PAS pertinent pour ce métier selon la réflexion, ne pas en faire une lacune — ou la reformuler (ex. immobilier : manque d'outil de demande de visite / d'estimation en ligne, si c'est cohérent).
- Sévérité : critical | high | medium | low selon l'impact réel pour CE métier.
- related_offer : libellé court interne (ex. « Site vitrine & SEO local », « Meta Ads », « CRM & nurturing »).

- 3 à 6 offres recommandées : chaque offre doit découler clairement d'au moins une lacune ; la raison doit mentionner le signal observé.
- estimated_value : fourchettes crédibles pour une agence en France (ex. « 1 500 - 5 000 € », « 400 - 1 200 €/mois »).

Réponds par JSON uniquement :
{
  "pain_points": [ { "label": "...", "severity": "...", "description": "...", "related_offer": "..." } ],
  "recommended_offers": [ { "name": "...", "reason": "...", "priority": "high|medium|low", "estimated_value": "..." } ]
}`
    );

    const rawPp = Array.isArray(synthesized?.pain_points) ? synthesized.pain_points : [];
    const rawOff = Array.isArray(synthesized?.recommended_offers) ? synthesized.recommended_offers : [];

    let ppId = 0;
    const pain_points: PainPoint[] = rawPp.slice(0, 10).map((pp) => ({
      id: `pp-${++ppId}`,
      label: (pp.label || "Lacune").slice(0, 220),
      severity: asSeverity(pp.severity),
      description: (pp.description || "").slice(0, 4000),
      related_offer: (pp.related_offer || "Accompagnement digital").slice(0, 160),
    }));

    let offId = 0;
    const recommended_offers: RecommendedOffer[] = rawOff.slice(0, 8).map((o) => ({
      id: `offer-${++offId}`,
      name: (o.name || "Offre").slice(0, 220),
      reason: (o.reason || "").slice(0, 4000),
      priority: asPriority(o.priority),
      estimated_value: (o.estimated_value || "Sur devis").slice(0, 120),
    }));

    if (pain_points.length === 0) {
      log("[Insights] Phase 2 — aucune lacune générée");
      return null;
    }

    log(`[Insights] ✓ ${pain_points.length} lacunes, ${recommended_offers.length} offres`);
    return { reflection, pain_points, recommended_offers };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log(`[Insights] ✗ ${msg}`);
    return null;
  }
}
