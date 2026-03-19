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

    // Extract city from address for more targeted searches
    const city = businessAddress.split(",").slice(-2, -1)[0]?.trim() || businessAddress;

    // Run 6 targeted parallel searches
    const [
      generalSearch,
      reviewSearch,
      menuSearch,
      socialSearch,
      imageSearch,
      mapsSearch,
    ] = await Promise.all([
      // 1. General info — who are they, what do they do
      tvly.search(`"${businessName}" ${businessAddress}`, {
        maxResults: 10,
        searchDepth: "advanced",
        includeAnswer: true,
        includeImages: true,
        includeImageDescriptions: true,
      }),

      // 2. Reviews — what customers say (multi-platform)
      tvly.search(
        `"${businessName}" ${city} avis reviews clients google tripadvisor yelp`,
        {
          maxResults: 10,
          searchDepth: "advanced",
          includeAnswer: true,
          includeImages: true,
          includeImageDescriptions: true,
        }
      ),

      // 3. Menu/Services/Products — what they offer with prices
      tvly.search(
        `"${businessName}" ${city} menu carte services tarifs prix horaires`,
        {
          maxResults: 8,
          searchDepth: "advanced",
          includeAnswer: true,
          includeImages: true,
          includeImageDescriptions: true,
        }
      ),

      // 4. Social media + official website
      tvly.search(
        `"${businessName}" site officiel instagram facebook telephone email contact`,
        {
          maxResults: 8,
          searchDepth: "basic",
          includeAnswer: true,
        }
      ),

      // 5. Dedicated image search — get the best visual content
      tvly.search(`"${businessName}" ${city} photos images interieur`, {
        maxResults: 10,
        searchDepth: "advanced",
        includeAnswer: false,
        includeImages: true,
        includeImageDescriptions: true,
      }),

      // 6. Google Maps / location data
      tvly.search(
        `"${businessName}" ${businessAddress} google maps fiche etablissement horaires`,
        {
          maxResults: 5,
          searchDepth: "advanced",
          includeAnswer: true,
        }
      ),
    ]);

    // Collect ALL found images (deduplicated, max 25)
    const allFoundImages = new Map<string, string>();
    const imageSearches = [
      generalSearch,
      reviewSearch,
      menuSearch,
      imageSearch,
    ];

    for (const search of imageSearches) {
      if (search.images) {
        for (const img of search.images) {
          if (
            img.url &&
            !allFoundImages.has(img.url) &&
            allFoundImages.size < 25 &&
            // Filter out common non-useful images
            !img.url.includes("favicon") &&
            !img.url.includes("logo-tripadvisor") &&
            !img.url.includes("google.com/maps") &&
            !img.url.includes("gstatic.com") &&
            !img.url.includes("yelp-logo") &&
            !img.url.includes("sprite") &&
            !img.url.includes("avatar") &&
            !img.url.includes("icon") &&
            // Must be a real image format or CDN
            (img.url.includes(".jpg") ||
              img.url.includes(".jpeg") ||
              img.url.includes(".png") ||
              img.url.includes(".webp") ||
              img.url.includes("photo") ||
              img.url.includes("image") ||
              img.url.includes("media") ||
              img.url.includes("upload") ||
              img.url.includes("cdn"))
          ) {
            allFoundImages.set(img.url, img.description || "");
          }
        }
      }
    }

    const foundImages = Array.from(allFoundImages.entries()).map(
      ([url, description]) => ({ url, description })
    );

    // Build comprehensive raw research text
    const rawResearch = `
=== GENERAL INFORMATION ===
${generalSearch.answer || "No answer available"}

Sources:
${generalSearch.results.map((r) => `- [${r.title}] ${r.content}`).join("\n")}

=== CUSTOMER REVIEWS & SENTIMENT ===
${reviewSearch.answer || "No review information found"}

Sources:
${reviewSearch.results.map((r) => `- [${r.title}] ${r.content}`).join("\n")}

=== MENU, SERVICES & PRICES ===
${menuSearch.answer || "No menu/services information found"}

Sources:
${menuSearch.results.map((r) => `- [${r.title}] ${r.content}`).join("\n")}

=== SOCIAL MEDIA & WEB PRESENCE ===
${socialSearch.answer || "No social media information found"}

Sources:
${socialSearch.results.map((r) => `- [${r.title}] ${r.content}`).join("\n")}

=== LOCATION & GOOGLE MAPS DATA ===
${mapsSearch.answer || "No location data found"}

Sources:
${mapsSearch.results.map((r) => `- [${r.title}] ${r.content}`).join("\n")}

=== IMAGES FOUND (${foundImages.length} images) ===
${foundImages.map((img, i) => `Image ${i + 1}: ${img.url} — ${img.description || "no description"}`).join("\n")}
`.trim();

    console.log(
      `[research/search] Found ${foundImages.length} images for "${businessName}"`
    );

    return NextResponse.json({ rawResearch, foundImages });
  } catch (error) {
    const msg =
      error instanceof Error ? error.message : "Search failed";
    console.error("Research search error:", msg, error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
