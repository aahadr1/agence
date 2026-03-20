import { createClient, createServiceClient } from "@/lib/supabase/server";
import { getReplicate } from "@/lib/replicate";
import { NextResponse } from "next/server";

export const maxDuration = 60;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Img = { url: string; type: string; analysis?: any };

function buildImageTable(images: Img[]) {
  const logo = images.find((i) => i.type === "logo");
  const allPhotos = images.filter((i) => i.type === "photo");
  const uploaded = allPhotos.filter((i) => i.analysis?.source !== "web");
  const web = allPhotos.filter(
    (i) => i.analysis?.source === "web" && i.analysis?.quality !== "low"
  );

  const map: { alias: string; url: string; desc: string; kind: string }[] = [];
  let idx = 1;

  if (logo) {
    map.push({
      alias: `@@IMG${idx}@@`,
      url: logo.url,
      desc: logo.analysis?.mood || "Business logo",
      kind: "LOGO",
    });
    idx++;
  }
  for (const p of uploaded) {
    map.push({
      alias: `@@IMG${idx}@@`,
      url: p.url,
      desc: p.analysis?.description || "Business photo",
      kind: "PHOTO",
    });
    idx++;
  }
  for (const p of web) {
    map.push({
      alias: `@@IMG${idx}@@`,
      url: p.url,
      desc: p.analysis?.description || "Web photo",
      kind: "PHOTO",
    });
    idx++;
  }

  return map;
}

/** Replace @@IMGN@@ aliases with real URLs in generated HTML */
function resolveAliases(
  files: { path: string; content: string }[],
  imgMap: { alias: string; url: string }[]
): { path: string; content: string }[] {
  return files.map((f) => {
    let content = f.content;
    for (const img of imgMap) {
      content = content.replaceAll(img.alias, img.url);
    }
    return { path: f.path, content };
  });
}

/** Detect language from address */
function detectLanguage(address: string): string {
  const lower = (address || "").toLowerCase();
  if (
    /france|paris|lyon|marseille|toulouse|nice|bordeaux|lille|strasbourg|nantes|montpellier|rennes|grenoble/i.test(
      lower
    )
  )
    return "French";
  if (/españa|spain|madrid|barcelona/i.test(lower)) return "Spanish";
  if (/italia|italy|roma|milano/i.test(lower)) return "Italian";
  if (/deutschland|germany|berlin|münchen/i.test(lower)) return "German";
  if (/nederland|netherlands|amsterdam/i.test(lower)) return "Dutch";
  if (/portugal|lisboa/i.test(lower)) return "Portuguese";
  return "English";
}

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
  const businessInfo = project.business_info;
  const colorScheme = variant.color_scheme || {};
  const imgMap = buildImageTable(images);
  const lang = detectLanguage(businessInfo.address || "");

  // Clean up old builds
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

  serviceClient
    .from("projects")
    .update({ status: "building", updated_at: new Date().toISOString() })
    .eq("id", projectId)
    .then(() => {});

  // ── Build the image alias table (placed FIRST so the AI sees it early) ──
  const imageTable = imgMap
    .map(
      (img) =>
        `  ${img.alias}  →  ${img.kind}: ${img.desc}`
    )
    .join("\n");

  // Design metadata
  const designRationale = colorScheme.design_rationale || "";
  const typography = colorScheme.typography || "";
  const layoutConcept = colorScheme.layout_concept || "";

  // Resolve image_usage from ideation
  const imageUsageRaw = colorScheme.image_usage || {};
  const resolvedUsage: string[] = [];
  for (const [key, val] of Object.entries(imageUsageRaw)) {
    let resolved = String(val || "");
    // Replace IMG-X references with aliases
    for (let i = 0; i < imgMap.length; i++) {
      const pattern = new RegExp(`\\[?IMG-${i + 1}\\]?`, "gi");
      resolved = resolved.replace(pattern, imgMap[i].alias);
    }
    resolvedUsage.push(`${key}: ${resolved}`);
  }

  const prompt = `You are a senior front-end developer and creative director at the world's best digital agency. You build award-winning, production-ready websites.

╔══════════════════════════════════════════════════════╗
║  MANDATORY IMAGE ALIASES — USE THESE IN YOUR HTML   ║
╠══════════════════════════════════════════════════════╣
${imageTable || "  (No images — use solid colors, gradients, SVG icons)"}
╚══════════════════════════════════════════════════════╝

When you write <img> tags, use the alias as the src attribute.
Example: <img src="@@IMG1@@" alt="..." class="...">
We will automatically replace @@IMGN@@ with real URLs after generation.
You MUST use EVERY image alias at least once across the website.
${imgMap.length > 0 ? `You have ${imgMap.length} images. Distribute them across pages — hero sections, about sections, gallery grids, backgrounds, etc.` : ""}

Image placement plan from the selected design concept:
${resolvedUsage.length > 0 ? resolvedUsage.join("\n") : "Distribute images naturally across pages."}

═══════════════════════════════════════════════════════
THE BUSINESS
═══════════════════════════════════════════════════════
Name: "${businessInfo.name}"
Address: ${businessInfo.address || "N/A"}
Phone: ${businessInfo.phone || "N/A"}
Hours: ${businessInfo.hours || "N/A"}
Type: ${businessInfo.cuisine || "Business"}
Price range: ${businessInfo.priceRange || "N/A"}
Rating: ${businessInfo.rating || "N/A"}

${businessInfo.description || ""}

Atmosphere: ${businessInfo.vibe || "Professional"}

Unique selling points:
${businessInfo.uniqueSellingPoints?.join("\n") || "N/A"}

Customer sentiment: ${businessInfo.customerSentiment || "N/A"}

Review quotes:
${businessInfo.reviewHighlights?.join("\n") || "N/A"}

${businessInfo.menu ? `Menu / Services:\n${businessInfo.menu}` : ""}

Social: Instagram ${businessInfo.socialMedia?.instagram || "—"} | Facebook ${businessInfo.socialMedia?.facebook || "—"}

═══════════════════════════════════════════════════════
DESIGN DIRECTION (selected by the client)
═══════════════════════════════════════════════════════
Theme: "${variant.theme_name}"
Rationale: ${designRationale}
Typography: ${typography}
Layout: ${layoutConcept}
Colors: primary ${colorScheme.primary || "#6d28d9"} · secondary ${colorScheme.secondary || "#1a1a2e"} · accent ${colorScheme.accent || "#e94560"}
${businessInfo.colors?.length ? `Brand colors: ${businessInfo.colors.join(", ")}` : ""}

═══════════════════════════════════════════════════════
YOUR TASK
═══════════════════════════════════════════════════════
Build a COMPLETE, PRODUCTION-READY website for this business.

YOU decide what pages this business needs. Think about it:
- What pages would a visitor expect?
- What pages would help this specific business convert visitors?
- What content is available from the research?

Requirements:
- Build AT LEAST 5 pages, up to 8-10 if the content supports it
- One page MUST be index.html (homepage)
- One page MUST be a contact page
- Every other page is YOUR choice based on what makes sense
- Examples: about, menu, services, gallery, team, testimonials, reservations, pricing, events, FAQ, blog, portfolio, locations...

COPYWRITING:
- Write ALL text in ${lang}. Professional, warm, specific to this business.
- Never use generic filler text. Every sentence must feel written by a human who KNOWS this business.
- Use the real business data (reviews, menu items, descriptions, selling points).
- Write compelling headlines, not generic ones. Not "Welcome" but something that captures the essence.
- Vary sentence length. Mix short punchy lines with flowing descriptions.

═══════════════════════════════════════════════════════
TECHNICAL STACK
═══════════════════════════════════════════════════════
Each HTML file: standalone, complete <!DOCTYPE html> document.

<head> must include:
- <meta charset="UTF-8"> + viewport meta
- <title>{Page} — ${businessInfo.name}</title>
- <script src="https://cdn.tailwindcss.com"><\/script> with config:
  tailwind.config = { theme: { extend: { colors: {
    primary: '${colorScheme.primary || "#6d28d9"}',
    'primary-light': '${colorScheme.primary || "#6d28d9"}20',
    secondary: '${colorScheme.secondary || "#1a1a2e"}',
    accent: '${colorScheme.accent || "#e94560"}'
  }}}}
- Google Fonts (pick fonts that match the typography concept)
- Alpine.js CDN (for mobile menu, lightbox, tabs, accordions)
- <style> block with CSS animations (fadeInUp, slideIn, scaleIn, stagger, parallax)

Design rules:
- Responsive: mobile-first (sm: md: lg: xl:)
- Fixed header with backdrop-blur, mobile hamburger via Alpine.js
- Generous whitespace, depth via shadows and subtle gradients
- Smooth hover states on everything interactive
- CSS entrance animations on scroll (IntersectionObserver or Alpine.js x-intersect)
- Comprehensive footer (info, hours, nav, social, copyright)
- Navigation links use relative paths (index.html, about.html, etc.)
- Active page highlighted in nav
- Google Maps embed: src="https://www.google.com/maps?q=${encodeURIComponent(businessInfo.address || businessInfo.name)}&output=embed"
- NO emojis anywhere
- NO placeholder images — only @@IMGN@@ aliases or solid-color/gradient/SVG fallbacks

═══════════════════════════════════════════════════════
OUTPUT FORMAT
═══════════════════════════════════════════════════════
Return ONLY a valid JSON array. No markdown. No explanation. No thinking.
[
  {"path": "index.html", "content": "<!DOCTYPE html>..."},
  {"path": "about.html", "content": "<!DOCTYPE html>..."},
  ...
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
      imgMap: imgMap.map((i) => ({ alias: i.alias, url: i.url })),
      businessInfo,
      colorScheme,
      lang,
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

// Export for use in review route
export { buildImageTable, resolveAliases, detectLanguage };
