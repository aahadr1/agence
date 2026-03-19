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
            prompt: `Analyze this image for "${businessName}" (${businessAddress}). Context: "${img.description}". Reply in VALID JSON only:
{"shows":"what it shows (food/interior/exterior/logo/team)","quality":"low|medium|high|excellent","placement":"hero|gallery|about|menu|background","mood":"brief mood","confirmed_business":true or false if you're sure this is actually from this specific business}`,
            image: img.url,
            max_tokens: 200,
            system_prompt: "Reply with valid JSON only. No markdown.",
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
