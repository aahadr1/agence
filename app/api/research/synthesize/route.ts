import { createClient } from "@/lib/supabase/server";
import { getReplicate } from "@/lib/replicate";
import { NextResponse } from "next/server";

export const maxDuration = 30;

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

    const synthesisPrompt = `You are a senior brand strategist preparing a comprehensive creative brief for a web design team. You have raw research data from the internet about a real business. Your job is to DEEPLY UNDERSTAND this business — not fill out a template, but truly grasp what makes it tick.

=== THE BUSINESS ===
Name: "${businessName}"
Address: "${businessAddress}"

=== RAW RESEARCH DATA ===
${fullResearch}

=== YOUR MISSION ===

Read every word of the research above. Then write the most insightful, specific, and useful business profile you've ever created.

PHASE 1 — DEEP UNDERSTANDING
Before writing anything, think about:
- What EXACTLY does this business do? Not the category — the specific, unique thing they do.
- What is their STORY? Every business has one — a founding moment, a passion, a tradition, a rebellion against something.
- Who are their PEOPLE? Not demographics — real human beings. The regulars, the first-timers, the occasions they serve.
- What's the EXPERIENCE like? Not just "nice" — the specific sensory details. The smell when you walk in, the sound, the light, the temperature, the vibe between staff and customers.
- What are they KNOWN FOR? The one thing people tell their friends about. The dish, the service, the feeling, the detail that sticks.
- What makes them DIFFERENT? Not "quality" or "service" — the actual, concrete, only-here thing.
- What do CUSTOMERS actually say? Not a summary — the specific words, complaints, praises, surprises.
- What's their VISUAL IDENTITY? Colors, logo style, interior design, plating style, uniform, signage — anything visual.

PHASE 2 — STRUCTURED OUTPUT
Now organize your understanding into JSON. Every field should feel like it was written by someone who actually visited this place and fell in love with it.

Return a SINGLE JSON object (no markdown fences, no commentary):

{
  "name": "The exact business name as they use it",
  "address": "Full address",
  "phone": "Phone number if found, or empty string",
  "hours": "Real opening hours in a readable format, or 'Not found'",
  "cuisine": "Their specific type — not generic. E.g., not 'restaurant' but 'neo-bistrot parisien avec cuisine de marche' or 'salon de coiffure afro specialise tresses et locks'",
  "priceRange": "Price range with context, e.g., '15-25 EUR for lunch, 35-50 EUR for dinner' or 'EUR/EUREUR'",
  "rating": "Rating out of 5 if found",

  "description": "5-8 sentences that paint a vivid, specific picture of this place. Write as if you're describing it to a friend who's never been. Mention real details: the chef's name if known, specific dishes, the decor, the neighborhood, the history. Never use words like 'quality', 'professional', 'welcoming' without a concrete detail attached. This should read like the opening paragraph of a great magazine feature.",

  "vibe": "4-6 sentences of pure sensory detail. What does it FEEL like to be here? The lighting (warm Edison bulbs? harsh fluorescent? natural light through big windows?), the music (jazz? silence? hip-hop? French chanson?), the decor (exposed brick? minimalist white? colorful tiles? vintage posters?), the energy (bustling? intimate? focused? chaotic?), the staff (formal? tattooed? family?). Be so specific someone could close their eyes and feel it.",

  "uniqueSellingPoints": [
    "5-7 points that are ACTUALLY unique to THIS business. Not 'great food' but 'the owner hand-picks produce from Rungis market every morning at 4am'. Not 'good service' but 'they remember every regular's name and order'. Real, specific, verified things from the research."
  ],

  "customerSentiment": "A rich, honest summary of what real customers feel about this place. Include the good AND the bad. What do people consistently praise? What do some complain about? What surprises people? What do they wish was different? Write this like a balanced journalist, not a PR person.",

  "reviewHighlights": [
    "5-8 actual quotes or close paraphrases from real reviews. Mark each with the platform if known: '[Google] Best croissants in the 11th!', '[TripAdvisor] We waited 45 min but it was worth every second'"
  ],

  "menu": "If this is a restaurant/cafe/food business: write out the ACTUAL menu items with REAL prices, organized by category. Be exhaustive with whatever the research provides. If it's not a food business: describe their services/products in the same detailed way. If no menu data found, write 'Menu not available online'.",

  "socialMedia": {
    "instagram": "@handle or URL if found",
    "facebook": "page URL or name if found",
    "twitter": "@handle if found",
    "website": "official website URL if found"
  },

  "colors": ["#hex1", "#hex2", "#hex3", "#hex4", "#hex5"],
  "colorExplanation": "Why these 5 colors? Connect each one to something REAL about the business — their logo, their interior, their food, their neighborhood, their vibe. Don't just pick pretty colors — pick THEIR colors.",

  "targetAudience": "Who actually comes here? Be specific and human — not 'millennials' but 'young couples from the neighborhood on date night, freelancers working through the afternoon, older locals who've been coming for 20 years'",
  "websiteTone": "What should the website's copywriting feel like? Reference specific adjectives, sentence structures, and the level of formality. E.g., 'Warm and slightly irreverent, like a friend who's passionate about wine. Short punchy sentences. French with occasional English words for menu items.'",
  "heroTagline": "Propose 3 taglines separated by ' | ' — each should capture something ESSENTIAL about this business in under 10 words. Not generic marketing speak but something that could ONLY apply to this place.",

  "competitors": "Who are their main competitors in the area? What makes this business different from them?",
  "neighborhood": "What's the neighborhood/area like? How does it influence the business?",

  "foundImages": [
    {
      "url": "image URL",
      "analysis": "What this image shows AND why it matters for the website",
      "suggestedPlacement": "hero|gallery|about|menu|background|testimonials",
      "quality": "low|medium|high|excellent"
    }
  ]
}

CRITICAL RULES:
- NEVER invent information. If you don't know something, say so honestly. "Hours not found online" is infinitely better than fake hours.
- BE SPECIFIC. Every sentence should contain a concrete detail that could only be true about THIS business.
- WRITE WITH SOUL. This isn't a database entry — it's a creative brief that should make the web designer excited to work on this project.
- For "foundImages": include ALL images that were analyzed, with honest quality assessments.
- For "colors": derive them from real visual evidence (logo, interior photos, branding) when possible.`;

    // Create prediction (non-blocking)
    const prediction = await replicate.predictions.create({
      model: "anthropic/claude-4.5-sonnet",
      input: {
        prompt: synthesisPrompt,
        max_tokens: 16000,
        system_prompt:
          "You are a senior brand strategist with 20 years of experience understanding businesses. You write creative briefs that make designers cry with excitement. You never use generic language — every word is specific, vivid, and true. You return valid JSON only, no markdown fences.",
      },
    });

    await supabase
      .from("projects")
      .update({
        status: "synthesizing",
        updated_at: new Date().toISOString(),
      })
      .eq("id", projectId);

    return NextResponse.json({ predictionId: prediction.id });
  } catch (error) {
    const msg =
      error instanceof Error ? error.message : "Synthesis failed";
    console.error("Research synthesize error:", msg, error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
