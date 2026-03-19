import { createClient, createServiceClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export const maxDuration = 30;

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
    const jsonMatch = rawOutput.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("Failed to parse AI response");
    }

    // Sanitize control characters inside JSON string values
    // Replace unescaped newlines/tabs/etc inside strings with their escaped versions
    const sanitized = jsonMatch[0]
      .replace(/[\x00-\x1F\x7F]/g, (ch: string) => {
        if (ch === "\n") return "\\n";
        if (ch === "\r") return "\\r";
        if (ch === "\t") return "\\t";
        return "";
      });

    let businessInfo;
    try {
      businessInfo = JSON.parse(sanitized);
    } catch (e) {
      // If still fails, try a more aggressive cleanup
      const aggressive = sanitized
        .replace(/,\s*([}\]])/g, "$1") // trailing commas
        .replace(/\\'/g, "'"); // escaped single quotes
      businessInfo = JSON.parse(aggressive);
    }

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
