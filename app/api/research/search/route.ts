import { createClient } from "@/lib/supabase/server";
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

  const { businessName, businessAddress } = await request.json();

  if (!businessName || !businessAddress) {
    return NextResponse.json(
      { error: "Business name and address are required" },
      { status: 400 }
    );
  }

  try {
    const tvly = tavily({ apiKey: process.env.TAVILY_API_KEY! });

    const [generalSearch, reviewSearch, menuSearch, socialSearch] =
      await Promise.all([
        tvly.search(`"${businessName}" ${businessAddress} restaurant commerce`, {
          maxResults: 8,
          searchDepth: "advanced",
          includeAnswer: true,
          includeImages: true,
          includeImageDescriptions: true,
        }),
        tvly.search(`"${businessName}" avis reviews clients témoignages google tripadvisor`, {
          maxResults: 8,
          searchDepth: "advanced",
          includeAnswer: true,
          includeImages: true,
          includeImageDescriptions: true,
        }),
        tvly.search(`"${businessName}" menu carte plats prix horaires`, {
          maxResults: 5,
          searchDepth: "advanced",
          includeAnswer: true,
          includeImages: true,
          includeImageDescriptions: true,
        }),
        tvly.search(`"${businessName}" instagram facebook site officiel téléphone`, {
          maxResults: 5,
          searchDepth: "basic",
          includeAnswer: true,
        }),
      ]);

    // Collect found images (deduplicated, max 15)
    const allFoundImages = new Map<string, string>();
    for (const search of [generalSearch, reviewSearch, menuSearch]) {
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

    const foundImages = Array.from(allFoundImages.entries()).map(
      ([url, description]) => ({ url, description })
    );

    // Build raw research text
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

    return NextResponse.json({ rawResearch, foundImages });
  } catch (error) {
    const msg =
      error instanceof Error ? error.message : "Search failed";
    console.error("Research search error:", msg, error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
