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

  const { buildId, files, businessInfo, colorScheme, imgAliases, lang } =
    await request.json();

  if (!buildId || !files || !Array.isArray(files)) {
    return NextResponse.json(
      { error: "Missing buildId or files" },
      { status: 400 }
    );
  }

  // Build a summary of current pages (full content would exceed limits)
  const pageSummary = files
    .map(
      (f: { path: string; content: string }) =>
        `--- ${f.path} (${f.content.length} chars) ---`
    )
    .join("\n");

  // Build alias usage report
  const aliasCount: Record<string, number> = {};
  for (const alias of imgAliases || []) {
    let count = 0;
    for (const f of files) {
      const matches = f.content.match(
        new RegExp(alias.alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")
      );
      count += matches ? matches.length : 0;
    }
    aliasCount[alias.alias] = count;
  }

  const unusedImages = Object.entries(aliasCount)
    .filter(([, count]) => count === 0)
    .map(([alias]) => alias);

  // Send ALL files to the AI for review + improvement
  const fileContents = files
    .map(
      (f: { path: string; content: string }) =>
        `\n===== FILE: ${f.path} =====\n${f.content}\n===== END: ${f.path} =====`
    )
    .join("\n");

  const prompt = `You are a senior creative director reviewing a website that was just built. Your job is to IMPROVE it significantly and ADD new pages.

CURRENT WEBSITE (${files.length} pages):
${pageSummary}

${unusedImages.length > 0 ? `\n⚠️  UNUSED IMAGES — these aliases are NOT used anywhere:\n${unusedImages.join(", ")}\nYou MUST incorporate ALL of them in the improved version.\n` : ""}

IMAGE ALIASES AVAILABLE:
${(imgAliases || []).map((a: { alias: string }) => a.alias).join(", ")}
Remember: use @@IMGN@@ as <img src="@@IMGN@@"> — they get replaced with real URLs.

BUSINESS: "${businessInfo?.name || "Business"}"
DESIGN COLORS: primary ${colorScheme?.primary || "#6d28d9"} · secondary ${colorScheme?.secondary || "#1a1a2e"} · accent ${colorScheme?.accent || "#e94560"}
LANGUAGE: ${lang || "French"}

HERE IS THE FULL CURRENT CODE:
${fileContents}

═══════════════════════════════════════════════════════
YOUR REVIEW CHECKLIST
═══════════════════════════════════════════════════════
For EACH existing page, check and fix:
□ Are ALL image aliases used? Add unused ones to appropriate sections.
□ Is the copywriting specific and compelling, or generic and flat? Rewrite flat copy.
□ Are CSS animations smooth and professional? Add scroll-triggered animations if missing.
□ Is the design consistent across pages (same header, footer, colors, fonts)?
□ Are hover states polished on every interactive element?
□ Is the page responsive and mobile-friendly?
□ Does the footer have: business info, hours, navigation, social links, copyright?
□ Is the navigation working with correct relative paths and active page highlighting?

THEN ADD 3-5 NEW PAGES that would make this website more complete:
- Think about what's MISSING for this type of business
- Examples: testimonials, reservations, events, team, FAQ, blog, pricing, story, concept, partners, press...
- Each new page must be as polished as the existing ones
- New pages must share the same header/footer/navigation as existing pages
- Update the navigation in ALL pages (new and existing) to include the new pages

═══════════════════════════════════════════════════════
OUTPUT FORMAT
═══════════════════════════════════════════════════════
Return the COMPLETE set of pages — ALL improved existing pages + ALL new pages.
Return ONLY a valid JSON array. No markdown. No explanation.
[
  {"path": "index.html", "content": "<!DOCTYPE html>...improved..."},
  {"path": "about.html", "content": "<!DOCTYPE html>...improved..."},
  ... existing pages improved ...
  {"path": "testimonials.html", "content": "<!DOCTYPE html>...NEW..."},
  ... new pages ...
]`;

  try {
    const replicate = getReplicate();

    const prediction = await replicate.predictions.create({
      model: "moonshotai/kimi-k2-thinking",
      input: {
        prompt,
        max_tokens: 64000,
        temperature: 0.6,
        top_p: 0.95,
        presence_penalty: 0,
        frequency_penalty: 0,
      },
    });

    return NextResponse.json({ predictionId: prediction.id });
  } catch (error) {
    const msg =
      error instanceof Error ? error.message : "Review failed";
    console.error("[review]", msg, error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
