import { createClient } from "@/lib/supabase/server";
import { getReplicate } from "@/lib/replicate";
import { NextResponse } from "next/server";

export const maxDuration = 30;

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const {
    projectId,
    businessName,
    businessAddress,
    rawResearch,
    imageAnalyses,
  } = await request.json();

  if (!projectId || !businessName || !rawResearch) {
    return NextResponse.json(
      { error: "Missing required fields" },
      { status: 400 }
    );
  }

  try {
    const replicate = getReplicate();

    // Build image report from analyses
    const imageReport =
      imageAnalyses && imageAnalyses.length > 0
        ? imageAnalyses
            .map(
              (
                img: { url: string; description: string; analysis: string },
                i: number
              ) =>
                `Image ${i + 1}: ${img.url}\nSearch description: ${img.description}\nAI Analysis: ${img.analysis}`
            )
            .join("\n\n")
        : "No images found online for this business.";

    const fullResearch = `${rawResearch}

=== IMAGES FOUND ONLINE (${imageAnalyses?.length || 0} analyzed) ===
${imageReport}`;

    const synthesisPrompt = `Tu es un expert en stratégie de marque et création de sites web. Tu dois créer le profil le plus COMPLET et DÉTAILLÉ possible de ce commerce à partir de données de recherche web réelles, dans le but de créer un site web parfaitement adapté.

═══ COMMERCE ═══
Nom : "${businessName}"
Adresse : "${businessAddress}"

═══ DONNÉES DE RECHERCHE WEB ═══
${fullResearch}

═══ TA MISSION ═══
Analyse en profondeur TOUTES les données ci-dessus. Pense comme si tu devais présenter ce commerce à un designer web qui ne le connaît pas du tout. Sois SPÉCIFIQUE, CONCRET, DÉTAILLÉ — jamais générique.

AVANT de produire le JSON, réfléchis à ces questions :
- Quelle est l'IDENTITÉ profonde de ce lieu ? Qu'est-ce qui le rend unique par rapport à ses concurrents ?
- Quel est le RESSENTI des vrais clients ? Quels mots reviennent dans les avis ?
- Quelle AMBIANCE se dégage (cosy, branché, familial, haut de gamme, décontracté) ?
- Quels sont les plats/produits/services PHARES ? À quels prix ?
- Quelles COULEURS et quel STYLE visuel correspondraient parfaitement à cette identité ?
- Parmi les images trouvées, lesquelles sont les plus PERTINENTES pour le site web et OÙ les placer ?

Puis retourne UN SEUL bloc JSON (pas de markdown, pas de commentaires avant/après) avec ces champs TRÈS DÉTAILLÉS :

{
  "name": "nom exact du commerce",
  "address": "adresse complète",
  "hours": "horaires réels si trouvés (ex: 'Lun-Ven 11h30-14h30 et 18h30-22h30, Sam 18h30-23h')",
  "cuisine": "type précis (ex: 'Bistrot français contemporain', 'Pizzeria napolitaine artisanale')",
  "phone": "numéro si trouvé",
  "priceRange": "€/€€/€€€/€€€€",
  "rating": "note /5 si trouvée",
  "menu": "DÉTAILLE les vrais plats/produits avec les vrais prix. Ex: 'Entrées: Tartare de saumon (14€), Soupe à l'oignon gratinée (9€). Plats: Magret de canard au miel (24€), Risotto aux cèpes (19€)...' — Sois le plus exhaustif possible avec les données disponibles.",
  "description": "4-5 phrases riches et spécifiques qui capturent l'ESSENCE de ce lieu. Pas de phrases génériques. Mentionne des détails concrets: le chef, l'histoire, la spécialité, ce qui le distingue. Écris comme un critique gastronomique passionné.",
  "vibe": "3-4 phrases décrivant l'atmosphère avec des détails sensoriels: lumière, musique, décoration, matériaux, l'énergie du lieu.",
  "uniqueSellingPoints": ["5 points forts CONCRETS et SPÉCIFIQUES à ce commerce"],
  "customerSentiment": "Synthèse DÉTAILLÉE de ce que les VRAIS clients disent. Cite des mots/expressions des avis réels si possible.",
  "reviewHighlights": ["5 citations ou paraphrases marquantes d'avis clients réels"],
  "socialMedia": {
    "instagram": "@handle exact ou vide",
    "facebook": "URL ou nom de page ou vide",
    "twitter": "@handle ou vide",
    "website": "URL du site web existant ou vide"
  },
  "colors": ["#hex1", "#hex2", "#hex3", "#hex4", "#hex5"],
  "colorExplanation": "Explique pourquoi ces 5 couleurs correspondent à l'identité du commerce.",
  "photos": [],
  "targetAudience": "Qui sont les clients typiques ?",
  "websiteTone": "Quel ton adopter pour les textes du site ?",
  "heroTagline": "Propose 3 accroches percutantes pour la section hero du site, séparées par ' | '",
  "foundImages": [
    {
      "url": "URL de l'image",
      "analysis": "Description DÉTAILLÉE: ce que montre l'image, pourquoi elle est pertinente, comment l'utiliser sur le site",
      "suggestedPlacement": "hero|gallery|about|menu|background|testimonials",
      "quality": "low|medium|high|excellent"
    }
  ]
}

RÈGLES CRITIQUES :
- Chaque champ doit être RICHE et SPÉCIFIQUE. Si tu n'as pas l'info, écris "Non trouvé" plutôt qu'inventer.
- Pour "colors": choisis 5 couleurs qui forment une palette cohérente et qui correspondent VRAIMENT à l'identité du lieu.
- Pour "foundImages": inclus TOUTES les images analysées (max 10), avec des recommandations précises de placement.
- Pour "menu": détaille TOUT ce que tu as trouvé, avec les prix réels.
- N'invente JAMAIS de fausses informations. Utilise UNIQUEMENT les données de la recherche.`;

    // Create prediction (non-blocking) instead of waiting for completion
    const prediction = await replicate.predictions.create({
      model: "anthropic/claude-4.5-sonnet",
      input: {
        prompt: synthesisPrompt,
        max_tokens: 8000,
        system_prompt:
          "Tu es un expert en stratégie de marque et création de sites web premium. Tu analyses les données de recherche web avec une précision chirurgicale pour extraire TOUTES les informations utiles. Tu es extrêmement détaillé et spécifique — jamais générique. Tu retournes du JSON valide uniquement, sans blocs markdown.",
      },
    });

    // Store prediction ID and context in the project for later processing
    await supabase
      .from("projects")
      .update({
        status: "synthesizing",
        updated_at: new Date().toISOString(),
      })
      .eq("id", projectId);

    return NextResponse.json({ predictionId: prediction.id });
  } catch (error) {
    const msg =
      error instanceof Error ? error.message : "Synthesis failed";
    console.error("Research synthesize error:", msg, error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
