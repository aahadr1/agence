import type { PainPoint, RecommendedOffer, CompetitorAnalysis } from "@/lib/types";

interface ScoringInput {
  has_website: boolean;
  website_score: number | null;
  website_quality: string | null;
  has_https: boolean;
  has_booking: boolean;
  has_chatbot: boolean;
  google_rating: number | null;
  google_review_count: number | null;
  has_meta_ads: boolean;
  meta_ads_count: number;
  facebook_url: string | null;
  instagram_url: string | null;
  facebook_followers: number | null;
  employee_count: string | null;
  revenue_bracket: string | null;
  creation_date: string | null;
  competitors: CompetitorAnalysis[];
  /** 0–1 from sector reflexion: omit booking gap when irrelevant (e.g. many B2B verticals) */
  booking_gap_weight?: number;
  /** 0–1 from sector reflexion */
  chatbot_gap_weight?: number;
}

/**
 * Calculate the potential score (1-100) for a business.
 * Higher = more opportunity for the agency to sell services.
 * Factors: digital gaps, market size, competitor pressure.
 */
export function calculatePotentialScore(input: ScoringInput): number {
  let score = 0;

  // ── Website gaps (max 35 points) ──
  if (!input.has_website) {
    score += 35;
  } else {
    const ws = input.website_score ?? 50;
    if (ws < 30) score += 28;
    else if (ws < 50) score += 20;
    else if (ws < 70) score += 10;

    if (!input.has_https) score += 5;
  }

  // ── Reviews gap (max 15 points) ──
  const rating = input.google_rating ?? 0;
  if (rating > 0 && rating < 3.0) score += 15;
  else if (rating > 0 && rating < 3.5) score += 10;
  else if (rating > 0 && rating < 4.0) score += 5;

  // Low review count = opportunity for reputation management
  const reviewCount = input.google_review_count ?? 0;
  if (reviewCount < 10) score += 5;

  // ── Missing features (max 15 points) — weights adapt to vertical relevance ──
  const bookingW = input.booking_gap_weight ?? 1;
  const chatbotW = input.chatbot_gap_weight ?? 1;
  if (!input.has_booking) score += Math.round(7 * bookingW);
  if (!input.has_chatbot) score += Math.round(5 * chatbotW);
  if (!input.has_meta_ads) score += 8;

  // ── Social presence gap (max 10 points) ──
  if (!input.facebook_url) score += 4;
  if (!input.instagram_url) score += 4;
  if ((input.facebook_followers ?? 0) < 100) score += 2;

  // ── Competitor pressure (max 15 points) ──
  if (input.competitors.length > 0) {
    const competitorsWithAds = input.competitors.filter((c) => c.has_meta_ads).length;
    const competitorsWithSites = input.competitors.filter((c) => c.website_url && (c.website_score ?? 0) > 60).length;

    if (!input.has_meta_ads && competitorsWithAds >= 2) score += 10;
    else if (!input.has_meta_ads && competitorsWithAds >= 1) score += 6;

    if (!input.has_website && competitorsWithSites >= 2) score += 5;
  }

  // ── Business viability bonus (max 10 points) ──
  // Higher revenue = can afford services
  const rev = (input.revenue_bracket || "").toLowerCase();
  if (rev.includes("million") || rev.includes("m€") || rev.includes("1 000") || rev.includes("500")) {
    score += 5;
  }
  // Established businesses with employees
  const empCount = parseInt(input.employee_count || "0");
  if (empCount >= 5) score += 3;
  else if (empCount >= 2) score += 1;

  // Young businesses need more help establishing online
  if (input.creation_date) {
    const year = parseInt(input.creation_date);
    if (year && year >= new Date().getFullYear() - 2) score += 3;
  }

  return Math.min(100, Math.max(1, score));
}

/**
 * Detect pain points from business analysis data.
 * Returns actionable pain points with severity and related offer.
 */
export function detectPainPoints(input: ScoringInput): PainPoint[] {
  const points: PainPoint[] = [];
  let id = 0;

  if (!input.has_website) {
    points.push({
      id: `pp-${++id}`,
      label: "Aucun site web",
      severity: "critical",
      description: "Le business n'a aucune présence web propre. Les clients potentiels ne peuvent pas les trouver en ligne.",
      related_offer: "Site Web",
    });
  } else {
    const ws = input.website_score ?? 50;
    if (ws < 30) {
      points.push({
        id: `pp-${++id}`,
        label: "Site web obsolète",
        severity: "critical",
        description: `Score de qualité très faible (${ws}/100). Le site fait fuir les visiteurs.`,
        related_offer: "Refonte Site Web",
      });
    } else if (ws < 50) {
      points.push({
        id: `pp-${++id}`,
        label: "Site web daté",
        severity: "high",
        description: `Score de qualité insuffisant (${ws}/100). Design vieillissant, mauvaise UX.`,
        related_offer: "Refonte Site Web",
      });
    }

    if (!input.has_https) {
      points.push({
        id: `pp-${++id}`,
        label: "Pas de HTTPS",
        severity: "high",
        description: "Le site n'est pas sécurisé. Google pénalise les sites sans HTTPS dans le classement.",
        related_offer: "Refonte + Conformité",
      });
    }
  }

  if (!input.has_booking) {
    points.push({
      id: `pp-${++id}`,
      label: "Pas de réservation en ligne",
      severity: "high",
      description: "Aucun système de prise de RDV ou réservation en ligne. Les clients modernes s'attendent à pouvoir réserver 24/7.",
      related_offer: "Chatbot / Système de RDV",
    });
  }

  if (!input.has_chatbot) {
    points.push({
      id: `pp-${++id}`,
      label: "Pas de chatbot",
      severity: "medium",
      description: "Aucun assistant virtuel pour répondre aux questions courantes. Perte de leads hors horaires d'ouverture.",
      related_offer: "Chatbot IA",
    });
  }

  const rating = input.google_rating ?? 0;
  if (rating > 0 && rating < 3.5) {
    points.push({
      id: `pp-${++id}`,
      label: "Mauvais avis Google",
      severity: "critical",
      description: `Note Google de ${rating}/5. Les avis négatifs font perdre jusqu'à 22% de clients potentiels.`,
      related_offer: "Gestion de Réputation + Ads",
    });
  } else if (rating > 0 && rating < 4.0) {
    points.push({
      id: `pp-${++id}`,
      label: "Avis Google moyens",
      severity: "medium",
      description: `Note Google de ${rating}/5. Marge d'amélioration pour se démarquer.`,
      related_offer: "Gestion de Réputation",
    });
  }

  if (!input.has_meta_ads) {
    const competitorsWithAds = input.competitors.filter((c) => c.has_meta_ads).length;
    const severity = competitorsWithAds >= 2 ? "critical" : competitorsWithAds >= 1 ? "high" : "medium";
    const competitorNote = competitorsWithAds > 0
      ? ` ${competitorsWithAds} concurrent(s) font déjà de la pub Meta.`
      : "";

    points.push({
      id: `pp-${++id}`,
      label: "Pas de publicité Meta",
      severity,
      description: `Aucune publicité active sur Facebook/Instagram.${competitorNote} Visibilité locale en danger.`,
      related_offer: "Publicité Meta Ads",
    });
  }

  if (!input.facebook_url && !input.instagram_url) {
    points.push({
      id: `pp-${++id}`,
      label: "Absence des réseaux sociaux",
      severity: "high",
      description: "Aucune présence sur Facebook ni Instagram. Canal de communication principal manquant.",
      related_offer: "Gestion Réseaux Sociaux",
    });
  }

  return points.sort((a, b) => {
    const order = { critical: 0, high: 1, medium: 2, low: 3 };
    return order[a.severity] - order[b.severity];
  });
}

/**
 * Generate offer recommendations based on detected pain points.
 */
export function recommendOffers(painPoints: PainPoint[], input: ScoringInput): RecommendedOffer[] {
  const offers: RecommendedOffer[] = [];
  const seenOffers = new Set<string>();
  let id = 0;

  const offerDetails: Record<string, { name: string; value: string }> = {
    "Site Web": { name: "Création de site web", value: "1 500 - 5 000 €" },
    "Refonte Site Web": { name: "Refonte de site web", value: "2 000 - 8 000 €" },
    "Refonte + Conformité": { name: "Refonte + HTTPS + Conformité RGPD", value: "2 500 - 6 000 €" },
    "Chatbot / Système de RDV": { name: "Chatbot IA + Système de réservation", value: "800 - 3 000 €" },
    "Chatbot IA": { name: "Chatbot IA conversationnel", value: "500 - 2 000 €" },
    "Gestion de Réputation + Ads": { name: "Gestion de réputation + Publicité", value: "500 - 1 500 €/mois" },
    "Gestion de Réputation": { name: "Gestion de réputation en ligne", value: "300 - 800 €/mois" },
    "Publicité Meta Ads": { name: "Campagnes Facebook & Instagram Ads", value: "500 - 2 000 €/mois" },
    "Gestion Réseaux Sociaux": { name: "Community management", value: "400 - 1 200 €/mois" },
  };

  for (const pp of painPoints) {
    if (seenOffers.has(pp.related_offer)) continue;
    seenOffers.add(pp.related_offer);

    const details = offerDetails[pp.related_offer];
    if (!details) continue;

    offers.push({
      id: `offer-${++id}`,
      name: details.name,
      reason: pp.description,
      priority: pp.severity === "critical" ? "high" : pp.severity === "high" ? "medium" : "low",
      estimated_value: details.value,
    });
  }

  return offers;
}
