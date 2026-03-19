import { createClient, createServiceClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export const maxDuration = 30;

/**
 * Parse JSON from AI output with multi-tier fallback:
 * 1. Try raw parse
 * 2. Sanitize control chars inside string values only (state machine)
 * 3. Aggressive cleanup (trailing commas, escaped quotes)
 */
function robustJsonParse(input: string): unknown {
  // Tier 1: Try raw parse
  try {
    return JSON.parse(input);
  } catch (e1) {
    console.log("[robustJsonParse] Raw parse failed:", (e1 as Error).message);
  }

  // Tier 2: State-machine sanitize control chars inside string values only
  let sanitized = "";
  let inString = false;
  let escaped = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (escaped) { sanitized += ch; escaped = false; continue; }
    if (ch === "\\" && inString) { sanitized += ch; escaped = true; continue; }
    if (ch === '"') { inString = !inString; sanitized += ch; continue; }
    if (inString && ch.charCodeAt(0) < 0x20) {
      if (ch === "\n") { sanitized += "\\n"; continue; }
      if (ch === "\r") { sanitized += "\\r"; continue; }
      if (ch === "\t") { sanitized += "\\t"; continue; }
      continue;
    }
    sanitized += ch;
  }

  try {
    return JSON.parse(sanitized);
  } catch (e2) {
    console.log("[robustJsonParse] Sanitized parse failed:", (e2 as Error).message);
  }

  // Tier 3: Aggressive cleanup
  const aggressive = sanitized
    .replace(/,\s*([}\]])/g, "$1")
    .replace(/\\'/g, "'");
  return JSON.parse(aggressive);
}

async function downloadAndPersistImage(
  imageUrl: string,
  projectId: string,
  index: number
): Promise<string | null> {
  try {
    const serviceClient = await createServiceClient();

    // Download the image
    const res = await fetch(imageUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; WebsiteBuilder/1.0; +https://aalh.business)",
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) return null;

    const contentType = res.headers.get("content-type") || "";
    if (!contentType.includes("image")) return null;

    const buffer = Buffer.from(await res.arrayBuffer());

    // Skip tiny images (likely icons/trackers)
    if (buffer.length < 5000) return null;

    const ext = contentType.includes("png")
      ? "png"
      : contentType.includes("webp")
      ? "webp"
      : "jpg";

    const storagePath = `web-photos/${projectId}/${index}.${ext}`;

    const { error: uploadError } = await serviceClient.storage
      .from("project-images")
      .upload(storagePath, buffer, {
        contentType: contentType.split(";")[0],
        upsert: true,
      });

    if (uploadError) {
      console.warn(`Failed to upload web image ${index}:`, uploadError.message);
      return null;
    }

    const {
      data: { publicUrl },
    } = serviceClient.storage
      .from("project-images")
      .getPublicUrl(storagePath);

    return publicUrl;
  } catch (err) {
    console.warn(
      `Failed to download web image ${index}:`,
      err instanceof Error ? err.message : err
    );
    return null;
  }
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { projectId, rawOutput } = await request.json();

  if (!projectId || !rawOutput) {
    return NextResponse.json(
      { error: "Missing projectId or rawOutput" },
      { status: 400 }
    );
  }

  try {
    // Strip markdown fences and thinking tags (both <think> and <thinking> variants)
    const stripped = rawOutput
      .replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, "")
      .replace(/```(?:json)?\s*/g, "")
      .replace(/```\s*/g, "")
      .trim();

    const jsonMatch = stripped.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error("[research/save] No JSON found in output. First 500 chars:", stripped.slice(0, 500));
      throw new Error("Failed to parse AI response — no JSON object found");
    }

    console.log("[research/save] Extracted JSON, length:", jsonMatch[0].length, "first 100 chars:", jsonMatch[0].slice(0, 100));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const businessInfo = robustJsonParse(jsonMatch[0]) as any;

    // Get user-chosen colors
    const { data: project } = await supabase
      .from("projects")
      .select("user_colors, user_instructions")
      .eq("id", projectId)
      .single();

    if (project?.user_colors && project.user_colors.length > 0) {
      businessInfo.colors = project.user_colors;
    }

    // Download and persist found web images to Supabase Storage
    if (businessInfo.foundImages && businessInfo.foundImages.length > 0) {
      const foundImgs = businessInfo.foundImages as {
        url: string;
        analysis: string;
        quality: string;
        suggestedPlacement: string;
      }[];

      console.log(
        `[research/save] Downloading ${foundImgs.length} web images for project ${projectId}`
      );

      // Download images in parallel (max 10 at a time)
      const downloadResults = await Promise.all(
        foundImgs.slice(0, 15).map(async (img, i) => {
          const persistedUrl = await downloadAndPersistImage(
            img.url,
            projectId,
            i
          );
          return { ...img, persistedUrl };
        })
      );

      // Only save images that were successfully downloaded
      const successfulImages = downloadResults.filter(
        (r) => r.persistedUrl !== null
      );

      console.log(
        `[research/save] Successfully persisted ${successfulImages.length}/${foundImgs.length} web images`
      );

      if (successfulImages.length > 0) {
        const inserts = successfulImages.map((img) => ({
          project_id: projectId,
          storage_path: `web-photos/${projectId}/${downloadResults.indexOf(img)}`,
          url: img.persistedUrl!,
          type: "photo" as const,
          analysis: {
            description: img.analysis || "Web-found image",
            quality: (img.quality || "medium").toLowerCase().trim(),
            suggestedPlacement: img.suggestedPlacement || "gallery",
            dominantColors: [],
            mood: "",
            websiteRelevance: img.analysis || "",
            source: "web",
            originalUrl: img.url,
          },
        }));

        await supabase.from("project_images").insert(inserts);

        businessInfo.photos = successfulImages.map((img) => img.persistedUrl);
      }
    }

    // Save research results to project
    await supabase
      .from("projects")
      .update({
        business_info: businessInfo,
        status: "info_gathering",
        updated_at: new Date().toISOString(),
      })
      .eq("id", projectId);

    return NextResponse.json({ businessInfo });
  } catch (error) {
    const msg =
      error instanceof Error ? error.message : "Save failed";
    console.error("Research save error:", msg, error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
