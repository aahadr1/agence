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

  const { projectId } = await request.json();

  if (!projectId) {
    return NextResponse.json(
      { error: "Project ID is required" },
      { status: 400 }
    );
  }

  // Fetch full project context
  const { data: project } = await supabase
    .from("projects")
    .select("*")
    .eq("id", projectId)
    .eq("user_id", user.id)
    .single();

  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  // Fetch uploaded images with analyses
  const { data: images } = await supabase
    .from("project_images")
    .select("*")
    .eq("project_id", projectId);

  const logo = images?.find((img) => img.type === "logo");
  const photos = images?.filter((img) => img.type === "photo") || [];

  // Build image context for Claude
  const imageDescriptions: string[] = [];
  if (logo) {
    imageDescriptions.push(
      `IMAGE 1 (LOGO): URL: ${logo.url}\nAnalysis: ${
        logo.analysis ? JSON.stringify(logo.analysis) : "Business logo"
      }`
    );
  }
  photos.forEach((photo, i) => {
    imageDescriptions.push(
      `IMAGE ${i + 2} (PHOTO): URL: ${photo.url}\nAnalysis: ${
        photo.analysis ? JSON.stringify(photo.analysis) : "Business photo"
      }`
    );
  });

  const businessInfo = project.business_info;
  const userColors = project.user_colors || [];
  const userInstructions = project.user_instructions || "";

  try {
    const replicate = getReplicate();

    const prompt = `You are an elite web designer creating 3 distinct website concepts for a real business. You have deep research data, image analysis, and brand context. Use ALL of it.

═══ BUSINESS PROFILE ═══
Name: ${businessInfo.name}
Address: ${businessInfo.address}
Type: ${businessInfo.cuisine || "Business"}
Price range: ${businessInfo.priceRange || "N/A"}
Rating: ${businessInfo.rating || "N/A"}

Description: ${businessInfo.description}
Vibe: ${businessInfo.vibe || "Not specified"}
Unique selling points: ${businessInfo.uniqueSellingPoints?.join(", ") || "N/A"}
Customer sentiment: ${businessInfo.customerSentiment || "N/A"}
Review highlights: ${businessInfo.reviewHighlights?.join(" | ") || "N/A"}

Hours: ${businessInfo.hours}
Phone: ${businessInfo.phone || "N/A"}
Menu: ${businessInfo.menu || "N/A"}

═══ BRAND COLORS ═══
${userColors.length > 0 ? `User-chosen colors (MUST use these): ${userColors.join(", ")}` : `AI-suggested colors: ${businessInfo.colors?.join(", ") || "Not determined"}`}

═══ UPLOADED IMAGES (${imageDescriptions.length} total) ═══
${imageDescriptions.length > 0 ? imageDescriptions.join("\n\n") : "No images uploaded"}

═══ USER INSTRUCTIONS ═══
${userInstructions || "None"}

═══ YOUR TASK ═══
Create 3 COMPLETELY DIFFERENT website design concepts. Each must:
1. Be deeply informed by the research (not generic)
2. Reflect the real vibe and customer sentiment
3. Use the brand colors (or user-chosen colors)
4. INCORPORATE the uploaded images — specify exactly where each image goes
5. Be specific to THIS business, not a template

CRITICAL — For each concept, you must specify:
- "image_usage": describe exactly how each uploaded image should be used in the website (e.g., "Logo placed top-left in the navigation bar at small size on a dark background", "Photo 1 used as full-width hero background with dark overlay and text on top", "Photo 2 in the about-us section as a circular crop")

For image_prompt: Write a DETAILED prompt to generate a website landing page that INCORPORATES the provided reference images. The prompt MUST:
- Describe a professional website landing page screenshot
- Explicitly instruct to use the provided logo in the header/navigation area
- Explicitly instruct to feature the provided photos in the hero section, gallery, or relevant sections
- Specify the business name "${businessInfo.name}" visible in the hero text
- Describe the exact color scheme, typography, and layout
- Describe what each section shows (hero, about, menu/services, contact, footer)
- Make it look like a REAL high-quality website, not an illustration

Return ONLY a valid JSON array with exactly 3 objects:
[
  {
    "theme_name": "Creative concept name",
    "color_scheme": {
      "primary": "#hex",
      "secondary": "#hex",
      "accent": "#hex"
    },
    "image_usage": {
      "logo": "Exact description of how the logo is placed and sized on the website",
      "photos": ["How photo 1 is used", "How photo 2 is used"]
    },
    "image_prompt": "Ultra-detailed prompt that instructs the image generator to create a website mockup using the provided reference images (logo and photos). Describe the complete layout, colors, sections, and where each reference image appears..."
  }
]

Make concept 1 elegant/refined, concept 2 bold/modern, concept 3 warm/inviting. Each should feel like it could be a real website for this specific business.`;

    const output = await replicate.run("anthropic/claude-4.5-sonnet", {
      input: {
        prompt,
        max_tokens: 6000,
        system_prompt:
          "You are a world-class web designer. You create stunning, unique website concepts deeply tailored to each business. You always specify exactly how uploaded brand assets (logo, photos) should be incorporated. Return valid JSON only, no markdown fences.",
      },
    });

    const rawOutput = Array.isArray(output) ? output.join("") : String(output);

    const jsonMatch = rawOutput.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      throw new Error("Failed to parse AI concepts");
    }

    const concepts = JSON.parse(jsonMatch[0]);

    if (!Array.isArray(concepts) || concepts.length !== 3) {
      throw new Error("Expected exactly 3 concepts");
    }

    // Insert variants with image_usage metadata
    const variants = [];
    for (const concept of concepts) {
      const { data: variant, error: insertError } = await supabase
        .from("variants")
        .insert({
          project_id: projectId,
          prompt: concept.image_prompt,
          theme_name: concept.theme_name,
          color_scheme: {
            ...concept.color_scheme,
            image_usage: concept.image_usage,
          },
          selected: false,
        })
        .select()
        .single();

      if (insertError) throw insertError;
      variants.push(variant);
    }

    // Update project status
    await supabase
      .from("projects")
      .update({ status: "selection", updated_at: new Date().toISOString() })
      .eq("id", projectId);

    return NextResponse.json({ variants });
  } catch (error) {
    console.error("Ideation error:", error);
    return NextResponse.json(
      { error: "Failed to generate concepts. Please try again." },
      { status: 500 }
    );
  }
}
