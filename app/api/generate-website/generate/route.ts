import { createClient, createServiceClient } from "@/lib/supabase/server";
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
      { error: "Missing projectId" },
      { status: 400 }
    );
  }

  const serviceClient = await createServiceClient();

  const [projectRes, imagesRes] = await Promise.all([
    supabase
      .from("projects")
      .select("*")
      .eq("id", projectId)
      .eq("user_id", user.id)
      .single(),
    supabase
      .from("project_images")
      .select("*")
      .eq("project_id", projectId),
  ]);

  const project = projectRes.data;
  if (!project) {
    return NextResponse.json(
      { error: "Project not found" },
      { status: 404 }
    );
  }

  const variantId = project.selected_variant_id;
  if (!variantId) {
    return NextResponse.json(
      { error: "No variant selected" },
      { status: 400 }
    );
  }

  const { data: variant } = await supabase
    .from("variants")
    .select("*")
    .eq("id", variantId)
    .single();

  if (!variant) {
    return NextResponse.json(
      { error: "Variant not found" },
      { status: 404 }
    );
  }

  const images = imagesRes.data || [];
  const logo = images.find(
    (img: { type: string }) => img.type === "logo"
  );
  const photos = images.filter(
    (img: { type: string }) => img.type === "photo"
  );
  const businessInfo = project.business_info;
  const colorScheme = variant.color_scheme || {};

  await serviceClient
    .from("website_builds")
    .delete()
    .eq("project_id", projectId)
    .in("status", ["failed", "pending", "generating_foundation", "generating_pages"]);

  const { data: build, error: buildError } = await serviceClient
    .from("website_builds")
    .insert({
      project_id: projectId,
      variant_id: variantId,
      status: "generating_foundation",
    })
    .select()
    .single();

  if (buildError) {
    return NextResponse.json(
      { error: buildError.message },
      { status: 500 }
    );
  }

  serviceClient
    .from("projects")
    .update({ status: "building", updated_at: new Date().toISOString() })
    .eq("id", projectId)
    .then(() => {});

  const isRestaurant = !!(
    businessInfo.cuisine
      ?.toLowerCase()
      ?.match(/restaurant|cafe|café|bistrot|brasserie|pizza|sushi|burger/) ||
    businessInfo.menu
  );

  const pageType = isRestaurant ? "menu" : "services";
  const pageTypeLabel = isRestaurant ? "Menu / Carte" : "Services";

  const photoLines = photos
    .map(
      (p: { url: string; analysis?: { suggestedPlacement?: string } }, i: number) =>
        `  - Photo ${i + 1}: ${p.url} (placement: ${p.analysis?.suggestedPlacement || "gallery"})`
    )
    .join("\n");

  const prompt = `You are an expert web developer. Generate a complete, beautiful, multi-page static website for a real business.

LOOK AT THE ATTACHED MOCKUP IMAGE. The generated website MUST faithfully match its colors, visual style, layout spirit, and overall mood.

══════ BUSINESS DETAILS ══════
Name: "${businessInfo.name}"
Address: "${businessInfo.address || "N/A"}"
Phone: ${businessInfo.phone || "N/A"}
Hours: ${businessInfo.hours || "N/A"}
Type: ${businessInfo.cuisine || "Business"}
Price range: ${businessInfo.priceRange || "N/A"}
Rating: ${businessInfo.rating || "N/A"}

Description: ${businessInfo.description || "A local business."}
Vibe: ${businessInfo.vibe || "Professional and welcoming"}
Unique selling points: ${businessInfo.uniqueSellingPoints?.join(", ") || "N/A"}
Customer sentiment: ${businessInfo.customerSentiment || "N/A"}
Review highlights: ${businessInfo.reviewHighlights?.join(" | ") || "N/A"}

${isRestaurant ? `Menu / Services:\n${businessInfo.menu || "Not available"}` : `Services: ${businessInfo.description || "Various professional services"}`}

Social media:
  Instagram: ${businessInfo.socialMedia?.instagram || ""}
  Facebook: ${businessInfo.socialMedia?.facebook || ""}
  Website: ${businessInfo.socialMedia?.website || ""}

══════ COLOR PALETTE (from selected mockup) ══════
Primary: ${colorScheme.primary || "#6d28d9"}
Secondary: ${colorScheme.secondary || "#1a1a2e"}
Accent: ${colorScheme.accent || "#e94560"}
Business brand colors: ${businessInfo.colors?.join(", ") || "N/A"}

══════ AVAILABLE IMAGES ══════
Logo: ${logo?.url || "No logo available — use a text-based logo with the business name"}
${photoLines || "No photos — use solid color backgrounds and icons instead"}

══════ PAGES TO GENERATE ══════

1. **index.html** — Homepage
   - Stunning hero section (full-width, with gradient overlay if using a photo background)
   - Business value proposition
   - Key features / highlights section with icons
   - Testimonials or review highlights
   - Strong call-to-action section
   - Must feel premium and inviting

2. **about.html** — About page
   - Business story and history
   - Values and mission
   - Team or owner section
   - Unique selling points highlighted
   - Use photos if available

3. **${pageType}.html** — ${pageTypeLabel}
   ${isRestaurant
     ? `- Display the REAL menu with actual items and prices
   - Organize by categories (starters, mains, desserts, drinks, etc.)
   - Elegant layout with prices right-aligned
   - Use food photos if available`
     : `- List all services offered
   - Each service with description and optional pricing
   - Professional layout with icons or images
   - Clear calls to action`}

4. **gallery.html** — Photo Gallery
   - Responsive grid: 1 col mobile, 2 cols tablet, 3 cols desktop
   - Use ALL available real photos with their actual URLs
   - Hover effects (scale + shadow)
   - If few photos, include a message about checking social media for more
   - Lightbox-style overlay when clicking an image (Alpine.js)

5. **contact.html** — Contact
   - Contact form (name, email, phone, message) — HTML only, no backend
   - Full address with embedded Google Maps iframe (use the real address in the src URL)
   - Clickable phone number (tel: link)
   - Business hours displayed clearly
   - Social media links with icons
   - Directions / how to find us section

══════ TECHNICAL REQUIREMENTS ══════

Each HTML file MUST be a complete standalone document with this structure:

<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{Page Title} — {Business Name}</title>
  <script src="https://cdn.tailwindcss.com"><\/script>
  <script>
    tailwind.config = {
      theme: {
        extend: {
          colors: {
            primary: '${colorScheme.primary || "#6d28d9"}',
            secondary: '${colorScheme.secondary || "#1a1a2e"}',
            accent: '${colorScheme.accent || "#e94560"}',
          },
          fontFamily: {
            sans: ['Inter', 'system-ui', 'sans-serif'],
          }
        }
      }
    }
  <\/script>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
  <script defer src="https://cdn.jsdelivr.net/npm/alpinejs@3.14.8/dist/cdn.min.js"><\/script>
  <style>
    [x-cloak] { display: none !important; }
  </style>
</head>
<body class="font-sans antialiased">
  <!-- HEADER with mobile menu (Alpine.js) -->
  <!-- PAGE CONTENT -->
  <!-- FOOTER with contact info, hours, social links, copyright -->
</body>
</html>

CRITICAL RULES:
- Every page has the SAME header (with nav links: Accueil, À propos, ${pageTypeLabel}, Galerie, Contact) and SAME footer
- Header uses Alpine.js for mobile hamburger menu: x-data="{ open: false }" with @click="open = !open" and x-show="open" x-transition
- Navigation links use relative paths: href="index.html", href="about.html", href="${pageType}.html", href="gallery.html", href="contact.html"
- The active page link should be visually highlighted
- Use <img> tags with the REAL image URLs provided above (never placeholder URLs)
- ALL content must be REAL business data — NEVER use Lorem ipsum or placeholder text
- If data is missing, write realistic content based on the business type
- Responsive: mobile-first with sm: md: lg: xl: breakpoints
- Smooth scroll behavior, transitions, hover effects
- All text content in French
- Google Maps iframe: use src="https://www.google.com/maps/embed/v1/place?key=AIzaSyBFw0Qbyq9zTFTd-tUY6dZWTgaQzuU17R8&q={business address URL encoded}" or a simple iframe with maps.google.com/maps?q={address}&output=embed
- Accessible: proper alt text on images, semantic HTML, good contrast

OUTPUT FORMAT:
Return ONLY a valid JSON array. No markdown fences, no explanation, no text before or after. Just the array:
[
  {"path": "index.html", "content": "<!DOCTYPE html>..."},
  {"path": "about.html", "content": "<!DOCTYPE html>..."},
  {"path": "${pageType}.html", "content": "<!DOCTYPE html>..."},
  {"path": "gallery.html", "content": "<!DOCTYPE html>..."},
  {"path": "contact.html", "content": "<!DOCTYPE html>..."}
]`;

  try {
    const replicate = getReplicate();

    const input: Record<string, unknown> = {
      prompt,
      max_tokens: 64000,
      system_prompt:
        "You are an expert web developer specializing in beautiful, modern static websites using Tailwind CSS. You output ONLY valid JSON — a single JSON array of objects with 'path' and 'content' keys. Never wrap in markdown code fences. Never add commentary before or after the JSON. The JSON must be parseable by JSON.parse().",
    };

    if (
      variant.image_url &&
      !variant.image_url.includes("replicate.delivery")
    ) {
      input.image = variant.image_url;
    }

    const prediction = await replicate.predictions.create({
      model: "anthropic/claude-4.5-sonnet",
      input,
    });

    return NextResponse.json({
      buildId: build.id,
      predictionId: prediction.id,
    });
  } catch (error) {
    const msg =
      error instanceof Error ? error.message : "Generation failed";
    console.error("[generate]", msg, error);

    await serviceClient
      .from("website_builds")
      .update({
        status: "failed",
        error: msg,
        updated_at: new Date().toISOString(),
      })
      .eq("id", build.id);

    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
