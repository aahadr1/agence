import { createClient, createServiceClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { runWebsiteResearch } from "@/lib/website-research/index";

export const maxDuration = 300;

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { projectId, businessName, businessAddress } = await request.json();

  if (!projectId || !businessName || !businessAddress) {
    return NextResponse.json(
      { error: "Missing required fields" },
      { status: 400 }
    );
  }

  const serviceClient = await createServiceClient();
  const logs: string[] = [];
  const log = (msg: string) => {
    console.log(msg);
    logs.push(msg);
  };

  try {
    // Run the full browser-based research pipeline
    const result = await runWebsiteResearch(businessName, businessAddress, log);

    // Download and persist images to Supabase Storage
    log("Downloading and persisting images...");
    let savedImageCount = 0;

    for (let i = 0; i < result.images.length; i++) {
      const img = result.images[i];
      try {
        const imgRes = await fetch(img.url, {
          signal: AbortSignal.timeout(10000),
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
          },
        });
        if (!imgRes.ok) continue;

        const contentType = imgRes.headers.get("content-type") || "";
        if (!contentType.startsWith("image/")) continue;

        const buffer = Buffer.from(await imgRes.arrayBuffer());
        if (buffer.length < 5000) continue; // skip tiny images

        const ext = contentType.includes("png")
          ? "png"
          : contentType.includes("webp")
            ? "webp"
            : "jpg";

        const storagePath = `web-photos/${projectId}/${img.source}-${i}.${ext}`;

        const { error: uploadError } = await serviceClient.storage
          .from("project-images")
          .upload(storagePath, buffer, {
            contentType,
            upsert: true,
          });

        if (uploadError) {
          log(`Upload failed for image ${i}: ${uploadError.message}`);
          continue;
        }

        const { data: urlData } = serviceClient.storage
          .from("project-images")
          .getPublicUrl(storagePath);

        await serviceClient.from("project_images").insert({
          project_id: projectId,
          type: "photo",
          storage_path: storagePath,
          url: urlData.publicUrl,
          analysis: {
            description: img.description,
            source: "web",
            quality: "medium",
            suggestedPlacement: img.suggestedPlacement,
            originalSource: img.source,
          },
        });

        savedImageCount++;
      } catch (e) {
        log(`Image ${i} failed: ${e instanceof Error ? e.message : e}`);
      }
    }

    log(`Saved ${savedImageCount} images to storage`);

    // Update the project with business info
    const { error: updateError } = await supabase
      .from("projects")
      .update({
        business_info: result.businessInfo,
        status: "ideation",
        updated_at: new Date().toISOString(),
      })
      .eq("id", projectId);

    if (updateError) {
      throw new Error(`Failed to update project: ${updateError.message}`);
    }

    return NextResponse.json({
      ok: true,
      imageCount: savedImageCount,
      businessInfo: result.businessInfo,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Research failed";
    console.error("[browse] Error:", msg, error);
    return NextResponse.json({ error: msg, logs }, { status: 500 });
  }
}
