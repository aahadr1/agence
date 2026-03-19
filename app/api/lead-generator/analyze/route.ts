import { createClient, createServiceClient } from "@/lib/supabase/server";
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

  const { searchId, niche, location, rawResearch } = await request.json();

  if (!searchId || !rawResearch) {
    return NextResponse.json(
      { error: "searchId and rawResearch are required" },
      { status: 400 }
    );
  }

  try {
    const replicate = getReplicate();

    const analysisPrompt = `You are an expert lead generation analyst. Your mission is to analyze web research data and extract EVERY business you can identify that operates in the specified niche and location.

═══ SEARCH PARAMETERS ═══
Niche: "${niche}"
Location: "${location}"

═══ RAW RESEARCH DATA ═══
${rawResearch}

═══ YOUR MISSION ═══
Carefully analyze ALL the research data above. For EACH business you can identify:

1. Extract their name, address, phone number, email (if found)
2. Determine if they have a website or not — this is CRITICAL:
   - If their only online presence is Google Maps, Facebook, Instagram, Yelp, or directory listings → they likely have NO website
   - If you find a direct URL to their own domain (not a social media or directory page) → they HAVE a website
   - Look for clues like "visit website", "site web", direct .com/.fr/.ca URLs
3. Extract their Google rating and number of reviews if available
4. Note any review highlights or descriptions of the business
5. Find their Google Maps URL if mentioned

IMPORTANT RULES:
- Extract EVERY business you find, even if information is partial
- Be thorough — a business with just a name and phone number is still a valuable lead
- For the "has_website" field: default to false unless you find clear evidence of a website
- For "source": note where you found this business (Google Maps, Yelp, directory, etc.)
- Do NOT invent information. Only use what's in the research data.
- Focus especially on businesses WITHOUT websites — these are the most valuable leads

Return a JSON array of businesses. Each business should have this structure:
[
  {
    "business_name": "Exact business name",
    "description": "Brief description of what they do / their specialty",
    "address": "Full address if found",
    "phone": "Phone number if found",
    "email": "Email if found",
    "rating": "X.X/5" or null,
    "review_count": "number of reviews" or null,
    "review_highlights": ["Notable review quotes or summaries"],
    "has_website": false,
    "website_url": "URL if they have one, null if not",
    "google_maps_url": "Google Maps URL if found",
    "source": "Where this business was found"
  }
]

Return ONLY the JSON array. No markdown, no comments, no explanation.`;

    const prediction = await replicate.predictions.create({
      model: "anthropic/claude-4.5-sonnet",
      input: {
        prompt: analysisPrompt,
        max_tokens: 8000,
        system_prompt:
          "You are a precise lead generation analyst. You extract business information from research data with surgical accuracy. You return valid JSON arrays only, no markdown blocks or extra text. You are especially skilled at identifying businesses that lack their own website — these are the most valuable leads for a web agency.",
      },
    });

    return NextResponse.json({ predictionId: prediction.id });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Analysis failed";
    console.error("Lead generator analyze error:", msg, error);

    const serviceClient = await createServiceClient();
    await serviceClient
      .from("lead_searches")
      .update({ status: "failed", updated_at: new Date().toISOString() })
      .eq("id", searchId);

    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
