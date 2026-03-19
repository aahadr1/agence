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

  // Clean up old failed/pending builds for this project
  await serviceClient
    .from("website_builds")
    .delete()
    .eq("project_id", projectId)
    .in("status", [
      "failed",
      "pending",
      "generating_foundation",
      "generating_pages",
    ]);

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

  // Update project status (non-blocking)
  serviceClient
    .from("projects")
    .update({ status: "building", updated_at: new Date().toISOString() })
    .eq("id", projectId)
    .then(() => {});

  const isRestaurant = !!(
    businessInfo.cuisine
      ?.toLowerCase()
      ?.match(
        /restaurant|cafe|café|bistrot|brasserie|pizza|sushi|burger|trattoria|ramen|bar|pub|grill/
      ) || businessInfo.menu
  );

  const pageType = isRestaurant ? "menu" : "services";
  const pageTypeLabel = isRestaurant ? "Menu / Carte" : "Services";

  const photoLines = photos
    .map(
      (
        p: { url: string; analysis?: { suggestedPlacement?: string } },
        i: number
      ) =>
        `  Photo ${i + 1}: ${p.url} (suggested placement: ${p.analysis?.suggestedPlacement || "gallery"})`
    )
    .join("\n");

  // Extract rich design metadata from the variant
  const designRationale = colorScheme.design_rationale || "";
  const typography = colorScheme.typography || "";
  const layoutConcept = colorScheme.layout_concept || "";
  const imageUsage = colorScheme.image_usage || {};

  const prompt = `You are a world-class front-end developer and designer. Your specialty is building stunning, award-winning websites that are visually breathtaking and technically flawless.

A client has chosen a specific design direction for their website. You must build it with absolute precision and creative excellence.

=== THE BUSINESS ===
Name: "${businessInfo.name}"
Address: "${businessInfo.address || ""}"
Phone: ${businessInfo.phone || "N/A"}
Hours: ${businessInfo.hours || "N/A"}
Type: ${businessInfo.cuisine || "Business"}
Price range: ${businessInfo.priceRange || "N/A"}
Rating: ${businessInfo.rating || "N/A"}

Description:
${businessInfo.description || "A local business."}

Atmosphere:
${businessInfo.vibe || "Professional and welcoming"}

What makes them unique:
${businessInfo.uniqueSellingPoints?.join("\n") || "N/A"}

Customer reviews:
${businessInfo.customerSentiment || "N/A"}

Review highlights:
${businessInfo.reviewHighlights?.join("\n") || "N/A"}

${isRestaurant ? `Menu:\n${businessInfo.menu || "Not available"}` : `Services: ${businessInfo.description || "Professional services"}`}

Social media:
  Instagram: ${businessInfo.socialMedia?.instagram || ""}
  Facebook: ${businessInfo.socialMedia?.facebook || ""}
  Website: ${businessInfo.socialMedia?.website || ""}

=== SELECTED DESIGN DIRECTION ===
Theme: "${variant.theme_name}"
Design rationale: ${designRationale}
Typography concept: ${typography}
Layout architecture: ${layoutConcept}

Color palette:
  Primary: ${colorScheme.primary || "#6d28d9"}
  Secondary: ${colorScheme.secondary || "#1a1a2e"}
  Accent: ${colorScheme.accent || "#e94560"}
  Business brand colors: ${businessInfo.colors?.join(", ") || "N/A"}

Image usage plan:
  Logo: ${imageUsage.logo || "Display in header"}
  Hero: ${imageUsage.hero_image || "Use strongest photo as hero"}
  Sections: ${JSON.stringify(imageUsage.section_images || [])}

=== AVAILABLE IMAGES ===
Logo: ${logo?.url || "No logo — create a text logo with the business name using the primary color"}
${photoLines || "No photos — use solid color sections, gradients, and SVG icons instead"}

=== PAGES TO BUILD ===

1. **index.html** — Homepage
   The homepage is the most important page. It must be visually stunning and immediately communicate who this business is.
   - Hero section: dramatic, full-impact, with smooth CSS entrance animations (fade-in, slide-up for text, scale for images). The hero must convey the atmosphere of the business in an instant.
   - Highlight sections showcasing what makes this business special (use their unique selling points and real customer quotes)
   - Smooth scroll transitions between sections
   - Clear call-to-action sections with hover animations
   - Every section should feel intentional and designed, never like a template

2. **about.html** — About
   - Tell the story of this business with genuine warmth and specificity
   - Values, mission, what drives the team
   - Use photos naturally within the narrative
   - Parallax or scroll-triggered fade effects for visual interest

3. **${pageType}.html** — ${pageTypeLabel}
   ${isRestaurant
     ? `- Display the REAL menu with actual items and real prices
   - Organize by categories (starters, mains, desserts, drinks, etc.)
   - Elegant layout: category headers with decorative elements, prices right-aligned with dot leaders
   - Subtle hover effects on menu items
   - Use food photos if available, integrated naturally`
     : `- Showcase all services with descriptions
   - Professional layout with icons or images
   - Pricing if available
   - Clear calls to action for each service`}

4. **gallery.html** — Gallery
   - Responsive masonry-style grid: 1 col mobile, 2 cols tablet, 3-4 cols desktop
   - Use ALL available real photos with their actual URLs
   - Smooth hover effects (subtle scale + shadow + slight brightness)
   - Lightbox overlay on click using Alpine.js (x-data, x-show, x-transition)
   - Staggered entrance animations when scrolling into view
   - If few photos, graceful messaging about social media

5. **contact.html** — Contact
   - Elegant contact form (name, email, phone, message) with focus animations on inputs
   - Full address with embedded Google Maps iframe
   - Clickable phone number (tel:) with hover effect
   - Business hours in a clean, readable layout
   - Social media links with icon hover animations

=== TECHNICAL SPECIFICATIONS ===

Each HTML file must be a complete standalone document:

<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{Page Title} - ${businessInfo.name}</title>
  <script src="https://cdn.tailwindcss.com"><\/script>
  <script>
    tailwind.config = {
      theme: {
        extend: {
          colors: {
            primary: '${colorScheme.primary || "#6d28d9"}',
            'primary-light': '${colorScheme.primary || "#6d28d9"}20',
            secondary: '${colorScheme.secondary || "#1a1a2e"}',
            accent: '${colorScheme.accent || "#e94560"}',
          }
        }
      }
    }
  <\/script>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&family=Playfair+Display:wght@400;500;600;700&display=swap" rel="stylesheet">
  <script defer src="https://cdn.jsdelivr.net/npm/alpinejs@3.14.8/dist/cdn.min.js"><\/script>
  <style>
    [x-cloak] { display: none !important; }
    html { scroll-behavior: smooth; }

    /* Entrance animations */
    @keyframes fadeInUp {
      from { opacity: 0; transform: translateY(30px); }
      to { opacity: 1; transform: translateY(0); }
    }
    @keyframes fadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }
    @keyframes slideInLeft {
      from { opacity: 0; transform: translateX(-40px); }
      to { opacity: 1; transform: translateX(0); }
    }
    @keyframes slideInRight {
      from { opacity: 0; transform: translateX(40px); }
      to { opacity: 1; transform: translateX(0); }
    }
    @keyframes scaleIn {
      from { opacity: 0; transform: scale(0.9); }
      to { opacity: 1; transform: scale(1); }
    }
    .animate-fade-in-up { animation: fadeInUp 0.8s ease-out forwards; }
    .animate-fade-in { animation: fadeIn 0.6s ease-out forwards; }
    .animate-slide-left { animation: slideInLeft 0.8s ease-out forwards; }
    .animate-slide-right { animation: slideInRight 0.8s ease-out forwards; }
    .animate-scale-in { animation: scaleIn 0.6s ease-out forwards; }

    /* Stagger children */
    .stagger > * { opacity: 0; animation: fadeInUp 0.6s ease-out forwards; }
    .stagger > *:nth-child(1) { animation-delay: 0.1s; }
    .stagger > *:nth-child(2) { animation-delay: 0.2s; }
    .stagger > *:nth-child(3) { animation-delay: 0.3s; }
    .stagger > *:nth-child(4) { animation-delay: 0.4s; }
    .stagger > *:nth-child(5) { animation-delay: 0.5s; }
    .stagger > *:nth-child(6) { animation-delay: 0.6s; }

    /* Smooth transitions on interactive elements */
    a, button { transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1); }
    img { transition: transform 0.5s cubic-bezier(0.4, 0, 0.2, 1), box-shadow 0.3s ease; }
  </style>
</head>
<body class="font-['Inter'] antialiased text-gray-800 bg-white overflow-x-hidden">
  <!-- Header + navigation with Alpine.js mobile menu -->
  <!-- Page content with animations -->
  <!-- Footer -->
</body>
</html>

=== DESIGN RULES ===

DO:
- Use the exact color palette from the selected design direction
- Create smooth CSS animations: fade-in-up for sections as they appear, hover scale on images, color transitions on buttons and links
- Use Playfair Display for headings (elegant serif) and Inter for body text (clean sans-serif) — or adapt the typography if the design concept specifies otherwise
- Build with generous whitespace — let the design breathe
- Use subtle gradients, shadows (shadow-lg, shadow-xl), and depth to create visual hierarchy
- Make every hover state feel polished (scale, shadow, color shift, underline animation)
- Use decorative elements sparingly: thin lines, dots, subtle patterns — NOT emojis
- Every image must use a real URL from the available images list (never placeholders)
- All text content must be the REAL business data — never Lorem ipsum
- Responsive: mobile-first with sm: md: lg: xl: breakpoints
- Header: fixed/sticky with backdrop blur, mobile hamburger menu via Alpine.js
- Footer: comprehensive with business info, hours, navigation links, social icons, copyright
- Navigation links: Accueil, A propos, ${pageTypeLabel}, Galerie, Contact — using relative paths (index.html, about.html, etc.)
- Active page link visually highlighted
- Google Maps: use src="https://www.google.com/maps?q=${encodeURIComponent(businessInfo.address || businessInfo.name)}&output=embed"
- All text in French

DO NOT:
- Use any emojis anywhere in the website
- Use generic placeholder text or stock photo URLs
- Create a flat, template-looking design — this must feel custom-designed
- Use inline JavaScript except for Alpine.js directives and Tailwind config
- Over-complicate — elegance is simplicity done right

=== OUTPUT FORMAT ===
Return ONLY a valid JSON array. No markdown fences. No text before or after. Just parseable JSON:
[
  {"path": "index.html", "content": "<!DOCTYPE html>...complete page..."},
  {"path": "about.html", "content": "<!DOCTYPE html>...complete page..."},
  {"path": "${pageType}.html", "content": "<!DOCTYPE html>...complete page..."},
  {"path": "gallery.html", "content": "<!DOCTYPE html>...complete page..."},
  {"path": "contact.html", "content": "<!DOCTYPE html>...complete page..."}
]`;

  try {
    const replicate = getReplicate();

    const prediction = await replicate.predictions.create({
      model: "moonshotai/kimi-k2-thinking",
      input: {
        prompt,
        max_tokens: 64000,
        temperature: 0.7,
        top_p: 0.95,
        presence_penalty: 0,
        frequency_penalty: 0,
      },
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
