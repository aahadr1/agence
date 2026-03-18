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
  const allPhotos = images?.filter((img) => img.type === "photo") || [];

  // Separate user-uploaded photos from web-found photos
  // Web-found images have external URLs, uploaded ones have our storage URLs
  const uploadedPhotos = allPhotos.filter(
    (img) => img.storage_path && !img.storage_path.startsWith("http")
  );
  const foundPhotos = allPhotos.filter(
    (img) => img.storage_path && img.storage_path.startsWith("http")
  );

  // Filter found photos: exclude only explicitly low quality
  const qualityFoundPhotos = foundPhotos.filter((img) => {
    const analysis = img.analysis;
    if (!analysis) return true; // include if no analysis
    const quality = (analysis.quality || "").toLowerCase();
    return quality !== "low";
  });

  // Build image context for Claude with clear categorization
  const imageDescriptions: string[] = [];
  let imgIndex = 1;

  if (logo) {
    imageDescriptions.push(
      `IMAGE ${imgIndex} (USER LOGO — MUST USE): URL: ${logo.url}\nAnalysis: ${
        logo.analysis ? JSON.stringify(logo.analysis) : "Business logo uploaded by user"
      }`
    );
    imgIndex++;
  }

  uploadedPhotos.forEach((photo) => {
    imageDescriptions.push(
      `IMAGE ${imgIndex} (USER PHOTO — MUST USE): URL: ${photo.url}\nAnalysis: ${
        photo.analysis ? JSON.stringify(photo.analysis) : "Business photo uploaded by user"
      }`
    );
    imgIndex++;
  });

  qualityFoundPhotos.forEach((photo) => {
    imageDescriptions.push(
      `IMAGE ${imgIndex} (WEB PHOTO — HIGH QUALITY, USE IF RELEVANT): URL: ${photo.url}\nAnalysis: ${
        photo.analysis ? JSON.stringify(photo.analysis) : "Photo found online"
      }\nSuggested placement: ${photo.analysis?.suggestedPlacement || "gallery"}`
    );
    imgIndex++;
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

═══ AVAILABLE IMAGES (${imageDescriptions.length} total) ═══
${imageDescriptions.length > 0 ? imageDescriptions.join("\n\n") : "No images available"}

═══ USER INSTRUCTIONS ═══
${userInstructions || "None"}

═══ YOUR TASK ═══
Create 3 COMPLETELY DIFFERENT website design concepts. Each must:
1. Be deeply informed by the research (not generic)
2. Reflect the real vibe and customer sentiment
3. Use the brand colors (or user-chosen colors)
4. INCORPORATE the real images into the website design — the generated mockup should visually contain these actual images
5. Be specific to THIS business, not a template

CRITICAL IMAGE RULES:
- Images marked "MUST USE" (user-uploaded logo and photos) MUST appear in every concept
- Images marked "HIGH QUALITY, USE IF RELEVANT" (found online) should be used if they show real food, interior, or ambiance of this specific business
- For each concept, specify exactly WHERE each image goes and HOW it's displayed
- The image_prompt MUST instruct the image generator to place these reference images naturally inside the website layout (e.g., "use reference image 1 as the logo in the top navigation bar", "use reference image 3 as the hero background photo", "display reference images 4-6 in a 3-column gallery grid in the menu section")

For image_prompt: Write a DETAILED prompt to generate a website landing page mockup that VISUALLY CONTAINS the provided reference images as part of the website design. The prompt MUST:
- Describe a professional website landing page screenshot
- EXPLICITLY say "incorporate the provided reference images into the website design"
- Say "use reference image 1 (the logo) in the header navigation"
- Say which reference images to display as hero photo, food gallery, interior shots, etc.
- Specify the business name "${businessInfo.name}" visible in the hero text
- Describe the exact color scheme, typography, and layout
- Describe each section: hero with real photo, about section, menu/gallery with real food photos, contact, footer
- Make it look like a REAL production website with actual photos embedded in it

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
