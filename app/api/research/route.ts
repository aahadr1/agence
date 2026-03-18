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
    // ── Phase 1: Multi-search with Tavily (with images) ──
    const tvly = tavily({ apiKey: process.env.TAVILY_API_KEY! });

    const [generalSearch, reviewSearch, menuSearch, socialSearch] =
      await Promise.all([
        tvly.search(`"${businessName}" ${businessAddress}`, {
          maxResults: 5,
          searchDepth: "advanced",
          includeAnswer: true,
          includeImages: true,
          includeImageDescriptions: true,
        }),
        tvly.search(`"${businessName}" avis reviews clients`, {
          maxResults: 5,
          searchDepth: "advanced",
          includeAnswer: true,
          includeImages: true,
          includeImageDescriptions: true,
        }),
        tvly.search(`"${businessName}" menu carte prix prices`, {
          maxResults: 5,
          searchDepth: "basic",
          includeAnswer: true,
        }),
        tvly.search(`"${businessName}" instagram facebook site web`, {
          maxResults: 5,
          searchDepth: "basic",
          includeAnswer: true,
        }),
      ]);

    // ── Phase 2: Collect found images (deduplicated, max 15) ──
    const allFoundImages = new Map<string, string>(); // url -> description
    for (const search of [generalSearch, reviewSearch]) {
      if (search.images) {
        for (const img of search.images) {
          if (
            img.url &&
            !allFoundImages.has(img.url) &&
            allFoundImages.size < 15
          ) {
            allFoundImages.set(img.url, img.description || "");
          }
        }
      }
    }

    const foundImagesList = Array.from(allFoundImages.entries()).map(
      ([url, description]) => ({ url, description })
    );

    // ── Phase 3: Analyze found images with Claude vision (in parallel) ──
    const replicate = getReplicate();

    // Analyze up to 5 images in PARALLEL for speed
    const imagesToAnalyze = foundImagesList.slice(0, 5);

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

    const imageAnalysisResults = await Promise.all(imageAnalysisPromises);
    const imageAnalyses = imageAnalysisResults.filter(
      (r): r is NonNullable<typeof r> => r !== null
    );

    // ── Phase 4: Build the image report for Claude synthesis ──
    const imageReport =
      imageAnalyses.length > 0
        ? imageAnalyses
            .map(
              (img, i) =>
                `Image ${i + 1}: ${img.url}\nSearch description: ${img.description}\nAI Analysis: ${img.analysis}`
            )
            .join("\n\n")
        : "No images found online for this business.";

    // ── Phase 5: Compile raw research ──
    const rawResearch = `
=== GENERAL INFORMATION ===
${generalSearch.answer || "No answer"}

Sources:
${generalSearch.results.map((r) => `- ${r.title}: ${r.content}`).join("\n")}

=== CUSTOMER REVIEWS & SENTIMENT ===
${reviewSearch.answer || "No answer"}

Sources:
${reviewSearch.results.map((r) => `- ${r.title}: ${r.content}`).join("\n")}

=== MENU & PRICES ===
${menuSearch.answer || "No answer"}

Sources:
${menuSearch.results.map((r) => `- ${r.title}: ${r.content}`).join("\n")}

=== SOCIAL MEDIA & WEB PRESENCE ===
${socialSearch.answer || "No answer"}

Sources:
${socialSearch.results.map((r) => `- ${r.title}: ${r.content}`).join("\n")}

=== IMAGES FOUND ONLINE (${imageAnalyses.length} analyzed) ===
${imageReport}
`.trim();

    // ── Phase 6: Claude synthesizes everything ──
    const synthesisPrompt = `You have real web research data AND analyzed images for a business. Synthesize ALL of it into a comprehensive profile for building a custom website.

Business: "${businessName}"
Address: "${businessAddress}"

RAW RESEARCH DATA:
${rawResearch}

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
      for (const img of businessInfo.foundImages) {
        await supabase.from("project_images").insert({
          project_id: projectId,
          storage_path: img.url, // external URL stored as path
          url: img.url,
          type: "photo",
          analysis: {
            description: img.analysis,
            quality: (img.quality || "medium").toLowerCase().trim(),
            suggestedPlacement: img.suggestedPlacement || "gallery",
            dominantColors: [],
            mood: "",
            websiteRelevance: img.analysis,
          },
        });
      }

      // Also store the URLs in businessInfo.photos for easy access
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
    console.error("Research error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to research business",
      },
      { status: 500 }
    );
  }
}
