import { askGeminiText } from "../browser";
import type { LeadResult } from "../index";

export interface ProspectAnalysisResult {
  prospect_analysis: string;
  targeted_offer: "website" | "software" | "ads" | "combo" | "seo" | "other" | null;
  identified_need: string | null;
  priority_score: "hot" | "warm" | "cold";
}

/**
 * Generate a comprehensive prospect analysis using Gemini.
 *
 * Returns:
 * - prospect_analysis: 3-5 sentence French analysis of the business, digital gaps, and pitch angle
 * - targeted_offer: auto-detected best offer for this prospect
 * - identified_need: short summary of the main identified need
 * - priority_score: hot / warm / cold based on all available data
 */
export async function analyzeProspect(
  lead: LeadResult,
  location: string,
  log: (msg: string) => void
): Promise<ProspectAnalysisResult> {
  log(`[ProspectAnalyzer] Generating analysis for ${lead.business_name}...`);

  const digitalGaps: string[] = [];

  if (!lead.has_website || lead.website_quality === "none") {
    digitalGaps.push("aucun site web");
  } else if (lead.website_quality === "dead") {
    digitalGaps.push("site web hors ligne");
  } else if (lead.website_quality === "outdated") {
    digitalGaps.push("site web obsolète");
  } else if (lead.website_quality === "poor") {
    digitalGaps.push("site web de mauvaise qualité");
  }

  if (lead.has_booking === false) digitalGaps.push("pas de réservation en ligne");
  if (lead.has_https === false && lead.has_website) digitalGaps.push("site non sécurisé (HTTP)");
  if (lead.has_chatbot === false && lead.has_website) digitalGaps.push("pas de chat/bot");
  if (lead.has_meta_ads === false) digitalGaps.push("aucune publicité Meta");

  const ownerBlock = lead.owner_name
    ? `Dirigeant : ${lead.owner_name}${lead.owner_role ? ` (${lead.owner_role})` : ""}${lead.linkedin_url ? " — profil LinkedIn disponible" : ""}.`
    : "Dirigeant : inconnu.";

  const legalBlock = [
    lead.company_type,
    lead.creation_date ? `créée en ${lead.creation_date.slice(0, 4)}` : null,
    lead.employee_count ? `${lead.employee_count} salariés` : null,
    lead.revenue_bracket ? `CA : ${lead.revenue_bracket}` : null,
  ]
    .filter(Boolean)
    .join(", ");

  const contactBlock = [
    lead.phone ? `tél : ${lead.phone}` : null,
    lead.email ? `email : ${lead.email}` : null,
    lead.owner_phone ? `tél dirigeant : ${lead.owner_phone}` : null,
    lead.owner_email ? `email dirigeant : ${lead.owner_email}` : null,
  ]
    .filter(Boolean)
    .join(" | ");

  const rating = parseFloat(lead.rating || "0");
  const reviews = parseInt(lead.review_count || "0", 10);
  const googleBlock =
    rating > 0
      ? `Note Google : ${rating}/5 (${reviews} avis).`
      : "Pas de note Google visible.";

  const socialBlock = [
    lead.facebook_url ? "Facebook" : null,
    lead.instagram_url ? "Instagram" : null,
    lead.follower_count ? `${lead.follower_count} abonnés` : null,
  ]
    .filter(Boolean)
    .join(", ");

  const websiteBlock = lead.has_website && lead.website_url
    ? `Site actuel : ${lead.website_url}${lead.website_quality ? ` (qualité : ${lead.website_quality}, score : ${lead.website_score ?? "?"}/100)` : ""}.`
    : "Pas de site web.";

  const adsBlock = lead.has_meta_ads
    ? `Fait de la publicité Meta (${lead.meta_ads_count ?? "?"} ads actives).`
    : "Aucune publicité Meta détectée.";

  const prompt = `Tu es un consultant commercial senior dans une agence web française. Analyse ce prospect et génère une fiche de prospection commerciale.

PROSPECT : ${lead.business_name}
Secteur / niche : ${lead.niche || "non précisé"}
Ville : ${location}
Description : ${lead.description || "non disponible"}
${ownerBlock}
Infos légales : ${legalBlock || "non disponibles"}
${contactBlock ? `Contacts : ${contactBlock}` : ""}
${googleBlock}
${websiteBlock}
${adsBlock}
${socialBlock ? `Réseaux sociaux : ${socialBlock}` : "Aucune présence sociale identifiée."}
Lacunes digitales : ${digitalGaps.length > 0 ? digitalGaps.join(", ") : "aucune lacune majeure identifiée"}
Score de potentiel : ${lead.potential_score ?? "non calculé"}/100

Génère une réponse JSON avec :
{
  "prospect_analysis": "3 à 5 phrases en français : ce que fait l'entreprise, ses points forts, ses lacunes digitales, comment une agence web peut l'aider, et l'angle de pitch principal. Sois précis, actionnable et commercial.",
  "targeted_offer": one of: "website" (création/refonte site), "ads" (publicité Meta/Google), "seo" (référencement naturel), "combo" (site + ads), "software" (logiciel/appli métier), "other" — choisir l'offre la plus pertinente selon les lacunes détectées,
  "identified_need": "court résumé du besoin principal en 5-10 mots",
  "priority_score": "hot" si très peu de présence digitale ET bonne activité business (note/avis élevés), "warm" si quelques lacunes mais déjà une base, "cold" si bien équipé ou peu intéressant
}

Return JSON only.`;

  try {
    const raw = await askGeminiText(prompt);
    // Clean potential markdown fences
    const cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    const parsed = JSON.parse(cleaned) as ProspectAnalysisResult;
    log(
      `[ProspectAnalyzer] ✓ offer=${parsed.targeted_offer} priority=${parsed.priority_score}`
    );
    return parsed;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log(`[ProspectAnalyzer] ✗ ${msg.slice(0, 80)}`);

    // Fallback: build a basic analysis without Gemini
    const priority: "hot" | "warm" | "cold" =
      (!lead.has_website || lead.website_quality === "none" || lead.website_quality === "dead") &&
      rating >= 4.0
        ? "hot"
        : digitalGaps.length >= 2
        ? "warm"
        : "cold";

    const offer = !lead.has_website
      ? "website"
      : lead.has_meta_ads === false
      ? "ads"
      : "combo";

    return {
      prospect_analysis: `${lead.business_name} — ${lead.niche || "entreprise locale"} à ${location}. ${digitalGaps.length > 0 ? `Lacunes identifiées : ${digitalGaps.join(", ")}.` : "Présence digitale existante."} ${lead.owner_name ? `Décideur : ${lead.owner_name}.` : ""} Score : ${lead.potential_score ?? "—"}/100.`,
      targeted_offer: offer,
      identified_need: digitalGaps[0] || "analyser la présence digitale",
      priority_score: priority,
    };
  }
}
