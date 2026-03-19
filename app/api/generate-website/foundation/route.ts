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

  const { projectId, variantId } = await request.json();

  if (!projectId || !variantId) {
    return NextResponse.json(
      { error: "Missing projectId or variantId" },
      { status: 400 }
    );
  }

  // Fetch project + variant + images
  const [projectRes, variantRes, imagesRes] = await Promise.all([
    supabase
      .from("projects")
      .select("*")
      .eq("id", projectId)
      .eq("user_id", user.id)
      .single(),
    supabase.from("variants").select("*").eq("id", variantId).single(),
    supabase.from("project_images").select("*").eq("project_id", projectId),
  ]);

  const project = projectRes.data;
  const variant = variantRes.data;
  const images = imagesRes.data || [];

  if (!project || !variant) {
    return NextResponse.json(
      { error: "Project or variant not found" },
      { status: 404 }
    );
  }

  const businessInfo = project.business_info;
  const colorScheme = variant.color_scheme || {};

  // Collect real image URLs
  const logo = images.find((img: { type: string }) => img.type === "logo");
  const photos = images
    .filter((img: { type: string }) => img.type === "photo")
    .map((img: { url: string; analysis?: { suggestedPlacement?: string } }) => ({
      url: img.url,
      placement: img.analysis?.suggestedPlacement || "gallery",
    }));

  try {
    const replicate = getReplicate();

    // Create website_build record
    const { data: build, error: buildError } = await supabase
      .from("website_builds")
      .insert({
        project_id: projectId,
        variant_id: variantId,
        status: "generating_foundation",
      })
      .select()
      .single();

    if (buildError) throw buildError;

    // Update project status
    await supabase
      .from("projects")
      .update({ status: "building", updated_at: new Date().toISOString() })
      .eq("id", projectId);

    const photoList = photos
      .map(
        (p: { url: string; placement: string }, i: number) =>
          `Photo ${i + 1}: ${p.url} (suggested: ${p.placement})`
      )
      .join("\n");

    const prompt = `Tu es un développeur web senior expert en Next.js et Tailwind CSS. Tu dois créer un site web COMPLET et PROFESSIONNEL pour un vrai commerce.

REGARDE ATTENTIVEMENT l'image du mockup fournie. Tu dois recréer CE DESIGN de manière fidèle — mêmes couleurs, même disposition, même ambiance.

═══ COMMERCE ═══
Nom : "${businessInfo.name}"
Adresse : "${businessInfo.address}"
Type : ${businessInfo.cuisine || "Commerce"}
Téléphone : ${businessInfo.phone || "Non renseigné"}
Horaires : ${businessInfo.hours || "Non renseigné"}
Prix : ${businessInfo.priceRange || "N/A"}
Note : ${businessInfo.rating || "N/A"}

Description : ${businessInfo.description}
Ambiance : ${businessInfo.vibe || "Non spécifié"}
Points forts : ${businessInfo.uniqueSellingPoints?.join(", ") || "N/A"}
Sentiment clients : ${businessInfo.customerSentiment || "N/A"}

Menu/Services : ${businessInfo.menu || "Non disponible"}

Réseaux sociaux :
- Instagram : ${businessInfo.socialMedia?.instagram || ""}
- Facebook : ${businessInfo.socialMedia?.facebook || ""}
- Site existant : ${businessInfo.socialMedia?.website || ""}

═══ PALETTE DE COULEURS (du mockup sélectionné) ═══
Primary : ${colorScheme.primary || "#000"}
Secondary : ${colorScheme.secondary || "#fff"}
Accent : ${colorScheme.accent || "#666"}
Couleurs business : ${businessInfo.colors?.join(", ") || "N/A"}

═══ IMAGES DISPONIBLES ═══
Logo : ${logo ? logo.url : "Pas de logo"}
${photoList || "Pas de photos"}

═══ TA MISSION ═══
Génère les FICHIERS FONDATION du projet Next.js. Ces fichiers définissent le design system et la page d'accueil.

FICHIERS À GÉNÉRER :
1. package.json — Next.js 14, React 18, Tailwind CSS 3, TypeScript
2. next.config.js — avec images.remotePatterns permissif (hostname: "**")
3. tailwind.config.ts — avec les couleurs custom du commerce dans theme.extend.colors
4. postcss.config.js
5. tsconfig.json — standard Next.js
6. app/globals.css — imports Tailwind (@tailwind base/components/utilities) + styles custom
7. app/layout.tsx — RootLayout avec metadata (titre, description), import de globals.css, Header et Footer. IMPORTANT: le layout doit avoir les balises <html> et <body>
8. components/Header.tsx — Navigation responsive avec logo, liens (Accueil, À propos, ${businessInfo.cuisine?.includes("estaurant") || businessInfo.cuisine?.includes("afe") || businessInfo.cuisine?.includes("istrot") ? "Menu" : "Services"}, Galerie, Contact). Menu hamburger sur mobile
9. components/Footer.tsx — Footer complet avec infos de contact, horaires, réseaux sociaux, copyright
10. app/page.tsx — PAGE D'ACCUEIL qui reproduit FIDÈLEMENT le mockup. Hero section avec image de fond, sections features/services, témoignages clients, call-to-action

RÈGLES TECHNIQUES CRITIQUES :
- Utilise des balises <img> classiques (PAS next/image) pour toutes les images — plus simple et pas de config nécessaire
- Tailwind CSS v3 syntax (pas v4)
- Tous les composants sont des Client Components uniquement s'ils ont de l'interactivité (useState, onClick). Sinon, laisse-les comme Server Components (pas de "use client" inutile)
- Le Header DOIT avoir "use client" car il a un state pour le menu mobile
- Responsive design : mobile-first avec breakpoints sm/md/lg/xl
- Les liens de navigation utilisent des balises <a> avec href="/about", "/menu", etc.
- Utilise les VRAIES informations du commerce partout (nom, adresse, téléphone, horaires)
- Intègre les VRAIES photos aux bons endroits (hero, galerie, etc.)
- Le site doit être MAGNIFIQUE, professionnel, et donner envie d'y aller

FORMAT DE SORTIE — retourne UNIQUEMENT un tableau JSON valide, sans markdown :
[
  { "path": "package.json", "content": "contenu du fichier" },
  { "path": "next.config.js", "content": "..." },
  ...
]`;

    const prediction = await replicate.predictions.create({
      model: "anthropic/claude-4.5-sonnet",
      input: {
        prompt,
        image: variant.image_url,
        max_tokens: 16000,
        system_prompt:
          "Tu es un développeur web expert en Next.js 14 et Tailwind CSS 3. Tu génères du code propre, fonctionnel et magnifique. Tu retournes UNIQUEMENT du JSON valide — un tableau d'objets avec 'path' et 'content'. Jamais de blocs markdown. Jamais de commentaires avant/après le JSON.",
      },
    });

    return NextResponse.json({
      buildId: build.id,
      predictionId: prediction.id,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Foundation generation failed";
    console.error("Generate website foundation error:", msg, error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
