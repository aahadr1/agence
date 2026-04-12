import { createClient } from "@/lib/supabase/server";
import { getReplicate } from "@/lib/replicate";
import { NextResponse } from "next/server";

export const maxDuration = 60;

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { foundImages, businessName, businessAddress } = await request.json();

  if (!foundImages || !businessName) {
    return NextResponse.json(
      { error: "Found images and business name are required" },
      { status: 400 }
    );
  }

  try {
    const replicate = getReplicate();

    // Analyze up to 5 images in PARALLEL
    const imagesToAnalyze = (
      foundImages as { url: string; description: string }[]
    ).slice(0, 5);

    const imageAnalysisPromises = imagesToAnalyze.map(async (img) => {
      try {
        const output = await replicate.run("anthropic/claude-4.5-sonnet", {
          input: {
            prompt: `Analyse cette image trouvée en ligne pour "${businessName}" (${businessAddress}).
Contexte de la recherche : "${img.description}"

Décris en détail :
1. Que montre exactement cette image ? (plat spécifique, intérieur du restaurant, façade, équipe, logo, etc.)
2. Est-ce que tu es SÛR que c'est bien de ce commerce spécifique ? Ou c'est une image générique ?
3. Quelle est la qualité visuelle pour un site web ?
4. Où placer cette image sur le site web et pourquoi ?
5. Quelle ambiance/mood se dégage ?

Réponds en JSON valide uniquement :
{"shows":"description détaillée de ce que montre l'image","quality":"low|medium|high|excellent","placement":"hero|gallery|about|menu|background","placementReason":"pourquoi ce placement","mood":"ambiance détaillée","confirmed_business":true/false,"confidence":"low|medium|high"}`,
            image: img.url,
            max_tokens: 400,
            system_prompt: "Tu es un directeur artistique expert en web design. Analyse les images avec précision pour déterminer leur utilité sur un site web. Retourne du JSON valide uniquement.",
          },
        });

        const analysisText = Array.isArray(output)
          ? output.join("")
          : String(output);

        return {
          url: img.url,
          description: img.description,
          analysis: analysisText,
        };
      } catch {
        return null;
      }
    });

    const results = await Promise.all(imageAnalysisPromises);
    const imageAnalyses = results.filter(
      (r): r is NonNullable<typeof r> => r !== null
    );

    return NextResponse.json({ imageAnalyses });
  } catch (error) {
    const msg =
      error instanceof Error ? error.message : "Image analysis failed";
    console.error("Research analyze error:", msg, error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
