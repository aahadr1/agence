import { createClient, createServiceClient } from "@/lib/supabase/server";
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

  const { buildId, foundationFiles } = await request.json();

  if (!buildId || !foundationFiles) {
    return NextResponse.json(
      { error: "Missing buildId or foundationFiles" },
      { status: 400 }
    );
  }

  const serviceClient = await createServiceClient();

  // Fetch build + project + variant
  const { data: build } = await serviceClient
    .from("website_builds")
    .select("*, projects(*), variants(*)")
    .eq("id", buildId)
    .single();

  if (!build) {
    return NextResponse.json({ error: "Build not found" }, { status: 404 });
  }

  const project = build.projects;
  const variant = build.variants;
  const businessInfo = project.business_info;

  // Fetch images
  const { data: images } = await supabase
    .from("project_images")
    .select("*")
    .eq("project_id", project.id);

  const photos = (images || [])
    .filter((img: { type: string }) => img.type === "photo")
    .map((img: { url: string; analysis?: { suggestedPlacement?: string } }) => ({
      url: img.url,
      placement: img.analysis?.suggestedPlacement || "gallery",
    }));

  const photoList = photos
    .map(
      (p: { url: string; placement: string }, i: number) =>
        `Photo ${i + 1}: ${p.url} (suggested: ${p.placement})`
    )
    .join("\n");

  // Extract key foundation files for context
  const parsedFoundation: { path: string; content: string }[] =
    typeof foundationFiles === "string"
      ? JSON.parse(foundationFiles)
      : foundationFiles;

  const globalsCss =
    parsedFoundation.find((f) => f.path === "app/globals.css")?.content || "";
  const layoutTsx =
    parsedFoundation.find((f) => f.path === "app/layout.tsx")?.content || "";
  const headerTsx =
    parsedFoundation.find((f) => f.path === "components/Header.tsx")?.content || "";
  const footerTsx =
    parsedFoundation.find((f) => f.path === "components/Footer.tsx")?.content || "";
  const homePage =
    parsedFoundation.find((f) => f.path === "app/page.tsx")?.content || "";
  const tailwindConfig =
    parsedFoundation.find((f) => f.path === "tailwind.config.ts")?.content || "";

  const isRestaurant =
    businessInfo.cuisine?.toLowerCase().includes("restaurant") ||
    businessInfo.cuisine?.toLowerCase().includes("cafe") ||
    businessInfo.cuisine?.toLowerCase().includes("bistrot") ||
    businessInfo.cuisine?.toLowerCase().includes("brasserie") ||
    businessInfo.menu;

  try {
    const replicate = getReplicate();

    // Save foundation files to build
    await serviceClient
      .from("website_builds")
      .update({
        files: parsedFoundation,
        status: "generating_pages",
        updated_at: new Date().toISOString(),
      })
      .eq("id", buildId);

    const prompt = `Tu es un développeur web senior. Tu continues la construction d'un site Next.js pour "${businessInfo.name}".

REGARDE l'image du mockup — toutes les pages doivent suivre EXACTEMENT le même style visuel.

═══ CONTEXTE DU COMMERCE ═══
Nom : "${businessInfo.name}"
Adresse : "${businessInfo.address}"
Téléphone : ${businessInfo.phone || "Non renseigné"}
Horaires : ${businessInfo.hours || "Non renseigné"}
Type : ${businessInfo.cuisine || "Commerce"}
Prix : ${businessInfo.priceRange || "N/A"}
Note : ${businessInfo.rating || "N/A"}
Description : ${businessInfo.description}
Ambiance : ${businessInfo.vibe || "Non spécifié"}
Points forts : ${businessInfo.uniqueSellingPoints?.join(", ") || "N/A"}
Avis clients : ${businessInfo.reviewHighlights?.join(" | ") || "N/A"}
Menu/Services : ${businessInfo.menu || "Non disponible"}

═══ PHOTOS DISPONIBLES ═══
${photoList || "Pas de photos"}

═══ FICHIERS DÉJÀ CRÉÉS (pour référence de style) ═══

--- tailwind.config.ts ---
${tailwindConfig}

--- app/globals.css ---
${globalsCss}

--- app/layout.tsx ---
${layoutTsx}

--- components/Header.tsx ---
${headerTsx}

--- components/Footer.tsx ---
${footerTsx}

--- app/page.tsx (accueil) ---
${homePage}

═══ PAGES À GÉNÉRER ═══
Génère ces pages dans le MÊME style que la page d'accueil :

1. app/about/page.tsx — Page "À propos"
   - Histoire du commerce, ses valeurs, son équipe
   - Section avec les points forts uniques
   - Utilise les vraies infos du commerce
   - Photo(s) si disponibles

2. app/${isRestaurant ? "menu" : "services"}/page.tsx — Page "${isRestaurant ? "Menu" : "Services"}"
   ${isRestaurant ? `- Affiche le VRAI menu avec les vrais prix
   - Catégories (entrées, plats, desserts, boissons)
   - Design élégant avec les prix alignés
   - Photos de plats si disponibles` : `- Liste des services proposés
   - Description détaillée de chaque service
   - Tarifs si disponibles`}

3. app/gallery/page.tsx — Page "Galerie"
   - Grille responsive de photos (2 cols mobile, 3 cols tablette, 4 cols desktop)
   - Utilise TOUTES les vraies photos disponibles
   - Effet hover élégant
   - Si pas assez de photos, affiche un message invitant à voir sur les réseaux

4. app/contact/page.tsx — Page "Contact"
   - Formulaire de contact (nom, email, message) — juste le HTML, pas de logique serveur
   - Adresse complète avec lien Google Maps
   - Téléphone cliquable (tel:)
   - Horaires d'ouverture détaillés
   - Liens réseaux sociaux
   - Intégration Google Maps iframe avec l'adresse

RÈGLES :
- MÊME design system que les fichiers existants (mêmes couleurs Tailwind, mêmes espacements, même typographie)
- Les composants Header et Footer sont DÉJÀ dans le layout, ne les inclus PAS dans les pages
- Utilise les balises <img> classiques (pas next/image)
- Responsive mobile-first
- Contenu RÉEL du commerce, jamais de Lorem ipsum
- Chaque page doit être visuellement cohérente avec l'accueil
- Server Components par défaut (pas de "use client" sauf si interactivité)

FORMAT — retourne UNIQUEMENT un tableau JSON valide :
[
  { "path": "app/about/page.tsx", "content": "..." },
  { "path": "app/${isRestaurant ? "menu" : "services"}/page.tsx", "content": "..." },
  { "path": "app/gallery/page.tsx", "content": "..." },
  { "path": "app/contact/page.tsx", "content": "..." }
]`;

    const pageInput: Record<string, unknown> = {
      prompt,
      max_tokens: 16000,
      system_prompt:
        "Tu es un développeur web expert en Next.js 14 et Tailwind CSS 3. Tu génères du code propre et cohérent avec le design existant. Tu retournes UNIQUEMENT du JSON valide — un tableau d'objets avec 'path' et 'content'. Jamais de blocs markdown.",
    };

    if (variant.image_url && !variant.image_url.includes("replicate.delivery")) {
      pageInput.image = variant.image_url;
    }

    const prediction = await replicate.predictions.create({
      model: "anthropic/claude-4.5-sonnet",
      input: pageInput,
    });

    return NextResponse.json({ predictionId: prediction.id });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Pages generation failed";
    console.error("Generate website pages error:", msg, error);

    await serviceClient
      .from("website_builds")
      .update({ status: "failed", error: msg, updated_at: new Date().toISOString() })
      .eq("id", buildId);

    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
