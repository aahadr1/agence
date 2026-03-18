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
    // ── Phase 1: Multi-search with Tavily ──
    const tvly = tavily({ apiKey: process.env.TAVILY_API_KEY! });

    const [generalSearch, reviewSearch, menuSearch, socialSearch] =
      await Promise.all([
        tvly.search(`"${businessName}" ${businessAddress} restaurant`, {
          maxResults: 5,
          searchDepth: "advanced",
          includeAnswer: true,
        }),
        tvly.search(`"${businessName}" avis reviews clients`, {
          maxResults: 5,
          searchDepth: "advanced",
          includeAnswer: true,
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

    // Compile all raw research
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
`.trim();

    // ── Phase 2: Claude synthesizes the raw research ──
    const replicate = getReplicate();

    const synthesisPrompt = `You have been given real web research data about a business. Your job is to extract and synthesize this into a detailed, actionable profile that a web designer could use to build a perfect custom website.

Business: "${businessName}"
Address: "${businessAddress}"

RAW RESEARCH DATA:
${rawResearch}

Analyze this research deeply. Don't just list facts — interpret the data:
- What's the VIBE of this place? (from reviews, descriptions, photos descriptions)
- What do customers LOVE most? (recurring themes in reviews)
- What's unique about this business vs competitors?
- What mood should the website convey?
- What are the REAL opening hours, phone number, prices?
- What social media accounts exist?

Return ONLY valid JSON, no markdown fences:
{
  "name": "exact business name",
  "address": "full address",
  "hours": "real opening hours if found, or best estimate",
  "cuisine": "type/category",
  "menu": "real menu items with real prices if found, formatted as readable text",
  "description": "a rich, compelling 3-4 sentence description capturing the essence of this place — not generic, deeply specific to what makes it special",
  "vibe": "1-2 sentences describing the atmosphere and feeling (e.g. 'intimate candlelit dining with a modern French twist, where plates are as artistic as they are delicious')",
  "uniqueSellingPoints": ["point 1", "point 2", "point 3"],
  "customerSentiment": "synthesis of what real customers say — common praise, any criticisms, overall feeling",
  "reviewHighlights": ["actual quote or paraphrased highlight 1", "highlight 2", "highlight 3"],
  "socialMedia": {
    "instagram": "@handle or empty string",
    "facebook": "page URL or name or empty string",
    "twitter": "@handle or empty string",
    "website": "URL or empty string"
  },
  "colors": ["#hex1", "#hex2", "#hex3"],
  "photos": [],
  "phone": "real phone if found",
  "priceRange": "€/€€/€€€/€€€€",
  "rating": "X/5 from Google or TripAdvisor if found"
}

For colors: suggest 3 colors that would PERFECTLY match this specific business's identity — based on the vibe, cuisine type, and any visual identity clues from the research. Not generic — deeply considered.`;

    const output = await replicate.run("anthropic/claude-4.5-sonnet", {
      input: {
        prompt: synthesisPrompt,
        max_tokens: 4096,
        system_prompt:
          "You are an expert business analyst and brand strategist. You extract deep, actionable insights from raw web data. You always return valid JSON only.",
      },
    });

    const rawOutput = Array.isArray(output) ? output.join("") : String(output);
    const jsonMatch = rawOutput.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("Failed to parse AI response");
    }

    const businessInfo = JSON.parse(jsonMatch[0]);

    // Get user-chosen colors and instructions from project
    const { data: project } = await supabase
      .from("projects")
      .select("user_colors, user_instructions")
      .eq("id", projectId)
      .single();

    // If user chose manual colors, override AI colors
    if (project?.user_colors && project.user_colors.length > 0) {
      businessInfo.colors = project.user_colors;
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
