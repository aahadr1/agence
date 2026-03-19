import { createClient, createServiceClient } from "@/lib/supabase/server";
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

  const { niche, location } = await request.json();

  if (!niche || !location) {
    return NextResponse.json(
      { error: "Niche and location are required" },
      { status: 400 }
    );
  }

  try {
    // Create search record with service role (bypasses RLS)
    const serviceClient = await createServiceClient();
    const { data: search, error: insertErr } = await serviceClient
      .from("lead_searches")
      .insert({
        user_id: user.id,
        niche,
        location,
        status: "searching",
      })
      .select()
      .single();

    if (insertErr || !search) {
      return NextResponse.json(
        { error: insertErr?.message || "Failed to create search record" },
        { status: 500 }
      );
    }

    const searchId = search.id;

    const tvly = tavily({ apiKey: process.env.TAVILY_API_KEY! });

    // Deep multi-angle search to find businesses in this niche+location
    // Strategy: hit Google Maps/GMB listings, directories, review sites
    const [
      mapsSearch,
      directorySearch,
      reviewSearch,
      socialSearch,
      noWebsiteSearch,
    ] = await Promise.all([
      // 1. Google Maps / GMB listings - the primary source
      tvly.search(
        `${niche} in ${location} google maps`,
        {
          maxResults: 10,
          searchDepth: "advanced",
          includeAnswer: true,
        }
      ),
      // 2. Business directories (Yelp, Yellow Pages, PagesJaunes, etc.)
      tvly.search(
        `${niche} ${location} business directory listing phone number address`,
        {
          maxResults: 10,
          searchDepth: "advanced",
          includeAnswer: true,
        }
      ),
      // 3. Review sites for more businesses + their details
      tvly.search(
        `best ${niche} ${location} reviews ratings avis`,
        {
          maxResults: 10,
          searchDepth: "advanced",
          includeAnswer: true,
        }
      ),
      // 4. Social media / local listings
      tvly.search(
        `${niche} ${location} facebook instagram local business`,
        {
          maxResults: 8,
          searchDepth: "basic",
          includeAnswer: true,
        }
      ),
      // 5. Specifically target businesses without websites
      tvly.search(
        `${niche} ${location} -site:*.com phone number "no website" OR "pas de site" OR "google.com/maps"`,
        {
          maxResults: 8,
          searchDepth: "advanced",
          includeAnswer: true,
        }
      ),
    ]);

    // Compile all raw research
    const rawResearch = `
=== GOOGLE MAPS / GMB LISTINGS ===
${mapsSearch.answer || "No answer"}

Sources:
${mapsSearch.results.map((r) => `- [${r.title}](${r.url}): ${r.content}`).join("\n")}

=== BUSINESS DIRECTORIES ===
${directorySearch.answer || "No answer"}

Sources:
${directorySearch.results.map((r) => `- [${r.title}](${r.url}): ${r.content}`).join("\n")}

=== REVIEWS & RATINGS ===
${reviewSearch.answer || "No answer"}

Sources:
${reviewSearch.results.map((r) => `- [${r.title}](${r.url}): ${r.content}`).join("\n")}

=== SOCIAL MEDIA / LOCAL PRESENCE ===
${socialSearch.answer || "No answer"}

Sources:
${socialSearch.results.map((r) => `- [${r.title}](${r.url}): ${r.content}`).join("\n")}

=== BUSINESSES POTENTIALLY WITHOUT WEBSITES ===
${noWebsiteSearch.answer || "No answer"}

Sources:
${noWebsiteSearch.results.map((r) => `- [${r.title}](${r.url}): ${r.content}`).join("\n")}
`.trim();

    // Update the search record with raw research
    await serviceClient
      .from("lead_searches")
      .update({
        raw_research: rawResearch,
        status: "analyzing",
        updated_at: new Date().toISOString(),
      })
      .eq("id", searchId);

    return NextResponse.json({ rawResearch, searchId });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Search failed";
    console.error("Lead generator search error:", msg, error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
