import { createClient } from "@/lib/supabase/server";
import { getReplicate } from "@/lib/replicate";
import { NextResponse } from "next/server";
import { tavily } from "@tavily/core";

export const maxDuration = 60;

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { projectId, businessName, businessAddress } = await request.json();

  if (!businessName || !businessAddress || !projectId) {
    return NextResponse.json(
      { error: "Business name, address, and project ID are required" },
      { status: 400 }
    );
  }

  try {
    // ── Phase 1: Parallel Tavily searches ──
    const tvly = tavily({ apiKey: process.env.TAVILY_API_KEY! });

    const [generalSearch, reviewSearch] = await Promise.all([
      tvly.search(`"${businessName}" ${businessAddress}`, {
        maxResults: 5,
        searchDepth: "advanced",
        includeAnswer: true,
        includeImages: true,
        includeImageDescriptions: true,
      }),
      tvly.search(
        `"${businessName}" avis reviews menu prix site web instagram`,
        {
          maxResults: 5,
          searchDepth: "advanced",
          includeAnswer: true,
          includeImages: true,
          includeImageDescriptions: true,
        }
      ),
    ]);

    // ── Phase 2: Collect found images (deduplicated, max 10) ──
    const allFoundImages = new Map<string, string>();
    for (const search of [generalSearch, reviewSearch]) {
      if (search.images) {
        for (const img of search.images) {
          if (
            img.url &&
            !allFoundImages.has(img.url) &&
            allFoundImages.size < 10
          ) {
            allFoundImages.set(img.url, img.description || "");
          }
        }
      }
    }

    const foundImagesList = Array.from(allFoundImages.entries()).map(
      ([url, description]) => ({ url, description })
    );

    const imageReport =
      foundImagesList.length > 0
        ? foundImagesList
            .map(
              (img, i) =>
                `Image ${i + 1}: ${img.url}\nDescription: ${img.description}`
            )
            .join("\n\n")
        : "No images found online.";

    // ── Phase 3: Compile raw research ──
    const rawResearch = `
=== GENERAL INFORMATION ===
${generalSearch.answer || "No answer"}

Sources:
${generalSearch.results.map((r) => `- ${r.title}: ${r.content}`).join("\n")}

=== REVIEWS, MENU & SOCIAL ===
${reviewSearch.answer || "No answer"}

Sources:
${reviewSearch.results.map((r) => `- ${r.title}: ${r.content}`).join("\n")}

=== IMAGES FOUND ONLINE (${foundImagesList.length}) ===
${imageReport}
`.trim();

    // ── Phase 4: Claude synthesizes everything in ONE call ──
    const replicate = getReplicate();

    const synthesisPrompt = `Synthesize this web research into a business profile for building a custom website.

Business: "${businessName}"
Address: "${businessAddress}"

RAW RESEARCH:
${rawResearch}

Return ONLY valid JSON:
{
  "name": "exact business name",
  "address": "full address",
  "hours": "opening hours if found",
  "cuisine": "type/category",
  "menu": "real menu items with prices if found",
  "description": "rich 3-4 sentence description",
  "vibe": "1-2 sentences on atmosphere",
  "uniqueSellingPoints": ["point1", "point2", "point3"],
  "customerSentiment": "what customers say",
  "reviewHighlights": ["highlight1", "highlight2", "highlight3"],
  "socialMedia": {"instagram":"","facebook":"","twitter":"","website":""},
  "colors": ["#hex1", "#hex2", "#hex3"],
  "photos": [],
  "phone": "phone if found",
  "priceRange": "€/€€/€€€/€€€€",
  "rating": "X/5 if found",
  "foundImages": [
    {"url":"image url","analysis":"what it likely shows and where to use it","suggestedPlacement":"hero|gallery|about|menu|background","quality":"low|medium|high|excellent"}
  ]
}

For foundImages: include ALL ${foundImagesList.length} images from the research. Judge quality from the description and URL context. Be specific about placement.
For colors: suggest 3 colors matching this business's identity.`;

    const output = await replicate.run("anthropic/claude-4.5-sonnet", {
      input: {
        prompt: synthesisPrompt,
        max_tokens: 4000,
        system_prompt:
          "Expert business analyst. Extract actionable insights from web data. Return valid JSON only, no markdown.",
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
      error instanceof Error ? error.message : "Failed to research business";
    console.error("Research error:", msg, error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
