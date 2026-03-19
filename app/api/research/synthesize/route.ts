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

    const synthesisPrompt = `You have real web research data AND analyzed images for a business. Synthesize ALL of it into a comprehensive profile for building a custom website.

Business: "${businessName}"
Address: "${businessAddress}"

RAW RESEARCH DATA:
${fullResearch}

Analyze deeply:
- What's the VIBE of this place? (from reviews, descriptions, AND the images)
- What do customers LOVE most?
- What's unique about this business?
- What mood should the website convey?
- Which found images are best for the website and WHERE should they go?

Return ONLY valid JSON, no markdown fences:
{
  "name": "exact business name",
  "address": "full address",
  "hours": "real opening hours if found",
  "cuisine": "type/category",
  "menu": "real menu items with real prices if found",
  "description": "rich 3-4 sentence description capturing the essence — specific, not generic",
  "vibe": "1-2 sentences on the atmosphere and feeling",
  "uniqueSellingPoints": ["point 1", "point 2", "point 3"],
  "customerSentiment": "synthesis of what real customers say",
  "reviewHighlights": ["highlight 1", "highlight 2", "highlight 3"],
  "socialMedia": {
    "instagram": "@handle or empty",
    "facebook": "page or empty",
    "twitter": "@handle or empty",
    "website": "url or empty"
  },
  "colors": ["#hex1", "#hex2", "#hex3"],
  "photos": [],
  "phone": "real phone if found",
  "priceRange": "€/€€/€€€/€€€€",
  "rating": "X/5 if found",
  "foundImages": [
    {
      "url": "image url",
      "analysis": "what it shows and where to use it on the website",
      "suggestedPlacement": "hero|gallery|about|menu|background|testimonials",
      "quality": "low|medium|high|excellent"
    }
  ]
}

For colors: suggest 3 colors that PERFECTLY match this business's identity based on the vibe, images, and research.
For foundImages: include the best images you analyzed (max 10), with specific placement recommendations.`;

    const output = await replicate.run("anthropic/claude-4.5-sonnet", {
      input: {
        prompt: synthesisPrompt,
        max_tokens: 5000,
        system_prompt:
          "You are an expert business analyst and brand strategist. You extract deep, actionable insights from web data and image analysis. Return valid JSON only.",
      },
    });

    const rawOutput = Array.isArray(output) ? output.join("") : String(output);
    const jsonMatch = rawOutput.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("Failed to parse AI response");
    }

    const businessInfo = JSON.parse(jsonMatch[0]);

    // Get user-chosen colors
    const { data: project } = await supabase
      .from("projects")
      .select("user_colors, user_instructions")
      .eq("id", projectId)
      .single();

    if (project?.user_colors && project.user_colors.length > 0) {
      businessInfo.colors = project.user_colors;
    }

    // Save found images to project_images table
    if (businessInfo.foundImages && businessInfo.foundImages.length > 0) {
      const inserts = businessInfo.foundImages.map(
        (img: {
          url: string;
          analysis: string;
          quality: string;
          suggestedPlacement: string;
        }) => ({
          project_id: projectId,
          storage_path: img.url,
          url: img.url,
          type: "photo" as const,
          analysis: {
            description: img.analysis,
            quality: (img.quality || "medium").toLowerCase().trim(),
            suggestedPlacement: img.suggestedPlacement || "gallery",
            dominantColors: [],
            mood: "",
            websiteRelevance: img.analysis,
          },
        })
      );

      await supabase.from("project_images").insert(inserts);

      businessInfo.photos = businessInfo.foundImages.map(
        (img: { url: string }) => img.url
      );
    }

    // Save research results to project
    await supabase
      .from("projects")
      .update({
        business_info: businessInfo,
        status: "info_gathering",
        updated_at: new Date().toISOString(),
      })
      .eq("id", projectId);

    return NextResponse.json({ businessInfo });
  } catch (error) {
    const msg =
      error instanceof Error ? error.message : "Synthesis failed";
    console.error("Research synthesize error:", msg, error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
