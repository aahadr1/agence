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

  const { projectId, imageUrls } = await request.json();

  if (!projectId || !imageUrls?.length) {
    return NextResponse.json(
      { error: "Project ID and image URLs are required" },
      { status: 400 }
    );
  }

  // Get project context for informed analysis
  const { data: project } = await supabase
    .from("projects")
    .select("business_info")
    .eq("id", projectId)
    .single();

  const businessContext = project?.business_info || {};

  try {
    const replicate = getReplicate();

    // Analyze each image with full business context
    for (const imageUrl of imageUrls) {
      const { data: imageRecord } = await supabase
        .from("project_images")
        .select("*")
        .eq("project_id", projectId)
        .eq("url", imageUrl)
        .single();

      if (!imageRecord) continue;

      const isLogo = imageRecord.type === "logo";

      const prompt = isLogo
        ? `Analyze this logo image for the business "${businessContext.name || "unknown"}".

Business context: ${businessContext.description || "A business"} — ${businessContext.vibe || ""}.

Analyze:
1. What does this logo communicate about the brand? (style, feeling, professionalism)
2. What are the dominant colors? (extract exact hex codes)
3. Is it suitable for web use? (quality, transparency, scalability)
4. What typography style does it use?
5. What website design direction does this logo suggest?

Return ONLY valid JSON:
{
  "description": "detailed description of the logo and what it communicates",
  "quality": "low|medium|high|excellent",
  "suggestedPlacement": "where and how to use this on the website (e.g. 'top-left header, keep small and clean' or 'can be used as a large hero element')",
  "dominantColors": ["#hex1", "#hex2", "#hex3"],
  "mood": "what mood/feeling this logo conveys",
  "websiteRelevance": "how this should influence the website design direction"
}`
        : `Analyze this business photo for "${businessContext.name || "unknown"}".

Business context: ${businessContext.description || "A business"} — ${businessContext.vibe || ""}.
Type: ${businessContext.cuisine || "business"}.

Analyze contextually — don't just describe what you see, but how it relates to this specific business's website:
1. What does this photo show? (interior, food, exterior, team, etc.)
2. Quality assessment — is it web-ready or needs enhancement?
3. Where should this be placed on the website? (hero, gallery, about section, background, etc.)
4. What mood does it convey? Does it match the business's vibe?
5. What are the dominant colors?

Return ONLY valid JSON:
{
  "description": "what the photo shows and why it matters for this business",
  "quality": "low|medium|high|excellent",
  "suggestedPlacement": "specific placement recommendation for the website",
  "dominantColors": ["#hex1", "#hex2"],
  "mood": "mood/atmosphere the photo conveys",
  "websiteRelevance": "how valuable this photo is for the website and specific usage recommendations"
}`;

      try {
        const output = await replicate.run("anthropic/claude-4.5-sonnet", {
          input: {
            prompt,
            image: imageUrl,
            max_tokens: 1500,
            system_prompt:
              "You are an expert web designer and brand consultant analyzing images for a website project. Return valid JSON only.",
          },
        });

        const rawOutput = Array.isArray(output)
          ? output.join("")
          : String(output);
        const jsonMatch = rawOutput.match(/\{[\s\S]*\}/);

        if (jsonMatch) {
          const analysis = JSON.parse(jsonMatch[0]);

          await supabase
            .from("project_images")
            .update({ analysis })
            .eq("id", imageRecord.id);
        }
      } catch (err) {
        console.error(`Failed to analyze image ${imageUrl}:`, err);
        // Continue with other images
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Image analysis error:", error);
    return NextResponse.json(
      { error: "Failed to analyze images" },
      { status: 500 }
    );
  }
}
