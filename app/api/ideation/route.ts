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
  const uploadedPhotos = allPhotos.filter(
    (img) => img.storage_path && !img.storage_path.startsWith("http")
  );
  const foundPhotos = allPhotos.filter(
    (img) => img.storage_path && img.storage_path.startsWith("http")
  );

  // Filter found photos: exclude only explicitly low quality
  const qualityFoundPhotos = foundPhotos.filter((img) => {
    const analysis = img.analysis;
    if (!analysis) return true;
    const quality = (analysis.quality || "").toLowerCase();
    return quality !== "low";
  });

  // Build structured image inventory
  const imageInventory: string[] = [];
  let imgIndex = 1;

  if (logo) {
    imageInventory.push(
      `[IMG-${imgIndex}] LOGO (mandatory) | URL: ${logo.url} | ${
        logo.analysis
          ? `Colors: ${logo.analysis.dominantColors?.join(", ") || "N/A"}, Style: ${logo.analysis.mood || "N/A"}`
          : "User-uploaded logo"
      }`
    );
    imgIndex++;
  }

  uploadedPhotos.forEach((photo) => {
    imageInventory.push(
      `[IMG-${imgIndex}] USER PHOTO (mandatory) | URL: ${photo.url} | ${
        photo.analysis
          ? `Shows: ${photo.analysis.description || "Business photo"}, Mood: ${photo.analysis.mood || "N/A"}, Best for: ${photo.analysis.suggestedPlacement || "gallery"}`
          : "User-uploaded business photo"
      }`
    );
    imgIndex++;
  });

  qualityFoundPhotos.forEach((photo) => {
    imageInventory.push(
      `[IMG-${imgIndex}] WEB PHOTO (recommended) | URL: ${photo.url} | ${
        photo.analysis
          ? `Shows: ${photo.analysis.description || "Photo found online"}, Quality: ${photo.analysis.quality || "medium"}, Best for: ${photo.analysis.suggestedPlacement || "gallery"}`
          : "Photo found online"
      }`
    );
    imgIndex++;
  });

  const businessInfo = project.business_info;
  const userColors = project.user_colors || [];
  const userInstructions = project.user_instructions || "";

  try {
    const replicate = getReplicate();

    const prompt = `You are a senior creative director at an award-winning digital agency. A client has hired you to design their website. You have comprehensive research data about their business. Your job is to THINK DEEPLY about this specific business, then propose 3 radically different website concepts.

=== THE CLIENT ===
Business name: "${businessInfo.name}"
Location: "${businessInfo.address}"
Type: ${businessInfo.cuisine || "Business"}
Price range: ${businessInfo.priceRange || "N/A"}
Rating: ${businessInfo.rating || "N/A"}/5

What they do:
${businessInfo.description || "No description available."}

The atmosphere:
${businessInfo.vibe || "Not described."}

What makes them special:
${businessInfo.uniqueSellingPoints?.join("\n") || "N/A"}

What real customers say:
${businessInfo.customerSentiment || "N/A"}

Memorable quotes from reviews:
${businessInfo.reviewHighlights?.join("\n") || "N/A"}

Hours: ${businessInfo.hours || "N/A"}
Phone: ${businessInfo.phone || "N/A"}
Menu/Services: ${businessInfo.menu || "Not available"}

Social media:
- Instagram: ${businessInfo.socialMedia?.instagram || "none"}
- Facebook: ${businessInfo.socialMedia?.facebook || "none"}
- Website: ${businessInfo.socialMedia?.website || "none"}

=== BRAND ASSETS ===
${userColors.length > 0 ? `Client-chosen brand colors (MUST respect): ${userColors.join(", ")}` : `Suggested brand colors: ${businessInfo.colors?.join(", ") || "Not determined yet — you decide"}`}

=== IMAGE INVENTORY (${imageInventory.length} assets) ===
${imageInventory.length > 0 ? imageInventory.join("\n") : "No images available — concepts will rely on typography, color, and layout."}

=== CLIENT BRIEF ===
${userInstructions || "No specific instructions — surprise us with your best work."}

=== YOUR CREATIVE PROCESS ===

STEP 1 — STRATEGIC ANALYSIS (think before designing)
Before you touch a single pixel, answer these questions in your mind:
- What is the SOUL of this business? Not just what they sell, but what they represent.
- Who walks through their door? What are these people looking for when they visit the website?
- What emotion should hit a visitor in the first 0.5 seconds of seeing the homepage?
- What are the top 3 websites in this industry category that are considered best-in-class? What design patterns do they use?
- What visual language communicates this business's positioning? (luxury = lots of white space and serifs; trendy = bold sans-serif and motion; traditional = warm tones and texture)
- How should the photography be treated? (full-bleed, contained, overlapping, with overlays, with crops?)
- What's the right content hierarchy? What should visitors see first, second, third?

STEP 2 — DESIGN 3 FUNDAMENTALLY DIFFERENT CONCEPTS
Not just 3 color variations. Each concept should differ in:
- Layout architecture (grid system, section flow, whitespace strategy)
- Typography personality (serif vs sans-serif, weight contrast, size hierarchy)
- Hero strategy (full-screen image vs split layout vs text-first vs scroll-triggered reveal)
- Navigation style (fixed top bar vs sidebar vs minimal/hidden vs overlay)
- Photography treatment (full-bleed vs contained frames vs grid vs parallax)
- Content rhythm (dense information vs breathing space vs interactive scroll)
- Overall design philosophy (what award-winning website is this inspired by?)

Each concept must feel like it could win a design award. No generic templates. No safe choices.

STEP 3 — WRITE IMAGE GENERATION PROMPTS
For each concept, write a hyper-specific prompt to generate a website mockup screenshot. The prompt MUST:
- Describe the EXACT layout of the homepage in a browser window
- Specify where each image from the inventory appears (by IMG number and URL)
- Describe the precise color palette, typography choice, and spacing
- Describe what text appears in the hero section (the business name, a tagline)
- Describe each visible section from top to bottom
- Mention the navigation style and footer
- The result should look like a 4K screenshot of a real, premium, production website — not a wireframe or mockup

=== OUTPUT FORMAT ===
Return ONLY a valid JSON array. No markdown, no explanation, no thinking out loud. Just the array:

[
  {
    "theme_name": "A evocative 2-3 word name capturing this concept's essence",
    "design_rationale": "2-3 sentences explaining WHY this design approach is perfect for THIS specific business. Reference the business's personality, clientele, and positioning.",
    "color_scheme": {
      "primary": "#hex — the dominant brand color",
      "secondary": "#hex — the supporting background/surface color",
      "accent": "#hex — the action/highlight color"
    },
    "typography": "The font pairing concept (e.g., 'Playfair Display for headings with Inter for body — classic elegance meets modern readability')",
    "layout_concept": "Brief description of the layout architecture (e.g., 'Asymmetric grid with full-bleed photography and text overlays, horizontal scroll gallery')",
    "image_usage": {
      "logo": "Exactly how the logo is displayed (size, position, treatment — e.g., 'Small monochrome logo in top-left of fixed transparent header, 32px height')",
      "hero_image": "Which IMG-X is used for the hero and how (e.g., 'IMG-3 as full-bleed hero background with dark gradient overlay from bottom, 100vh height')",
      "section_images": ["How each remaining image is used in the layout — be specific about treatment, size, and section"]
    },
    "image_prompt": "EXTREMELY detailed prompt describing the website mockup to generate. Start with 'A 4K screenshot of a premium website displayed in a minimal browser chrome.' Then describe every visible element from top to bottom: header (navigation items, logo placement), hero section (exact text, image treatment, overlay), each content section (layout, imagery, text blocks), and footer. Reference specific images by saying 'displaying the image from [IMG-X URL]' so the generator knows which reference image to place where. Describe colors as exact hex values. The design must look like a real shipped website, not a template."
  }
]

CRITICAL: Your 3 concepts must each feel like they come from a different design philosophy. If concept 1 is minimal and typographic, concept 2 should be immersive and photographic, and concept 3 should be bold and editorial. Surprise us.`;

    // Create prediction (non-blocking) — frontend will poll for result
    const prediction = await replicate.predictions.create({
      model: "anthropic/claude-4.5-sonnet",
      input: {
        prompt,
        max_tokens: 8000,
        system_prompt:
          "You are an elite creative director who has designed websites for Michelin-star restaurants, luxury brands, and award-winning businesses. You think strategically about every design decision. You never produce generic work — every concept is deeply tailored to the client's identity. You return valid JSON only, never markdown fences or commentary.",
      },
    });

    return NextResponse.json({ predictionId: prediction.id, projectId });
  } catch (error) {
    console.error("Ideation error:", error);
    return NextResponse.json(
      { error: "Failed to generate concepts. Please try again." },
      { status: 500 }
    );
  }
}
