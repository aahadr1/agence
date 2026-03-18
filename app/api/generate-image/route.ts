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

  const { variantId, prompt, projectId } = await request.json();

  if (!variantId || !prompt) {
    return NextResponse.json(
      { error: "Variant ID and prompt are required" },
      { status: 400 }
    );
  }

  try {
    const replicate = getReplicate();

    // Fetch project images, prioritized: logo first, then user photos, then best web photos
    let imageInputs: string[] = [];
    if (projectId) {
      const { data: images } = await supabase
        .from("project_images")
        .select("url, type, storage_path, analysis")
        .eq("project_id", projectId);

      if (images && images.length > 0) {
        // 1. Logo first (always)
        const logo = images.find((img) => img.type === "logo");
        if (logo) {
          imageInputs.push(logo.url);
        }

        // 2. User-uploaded photos (always include)
        const userPhotos = images.filter(
          (img) =>
            img.type === "photo" &&
            img.storage_path &&
            !img.storage_path.startsWith("http")
        );
        for (const photo of userPhotos) {
          imageInputs.push(photo.url);
        }

        // 3. Web-found photos — only high/excellent quality
        const webPhotos = images.filter(
          (img) =>
            img.type === "photo" &&
            img.storage_path &&
            img.storage_path.startsWith("http") &&
            img.analysis &&
            (img.analysis.quality === "high" ||
              img.analysis.quality === "excellent")
        );
        for (const photo of webPhotos) {
          imageInputs.push(photo.url);
        }

        // Cap at 14 (Nano Banana 2 limit)
        imageInputs = imageInputs.slice(0, 14);
      }
    }

    // Build image reference instructions for the prompt
    const imageRefInstructions =
      imageInputs.length > 0
        ? `This website mockup must INCORPORATE the ${imageInputs.length} provided reference images as actual visual content within the website layout. Reference image 1 is the business logo — display it in the website header/navigation. ${
            imageInputs.length > 1
              ? `Reference images 2-${imageInputs.length} are real business photos (food, interior, exterior) — display them naturally as the hero background image, in a photo gallery section, or as section backgrounds. These are REAL photos of this business — they must appear visibly embedded in the website design, not replaced or recreated.`
              : ""
          }`
        : "";

    const enhancedPrompt = `Professional high-fidelity website landing page screenshot, UI/UX design mockup displayed in a browser. ${prompt}. ${imageRefInstructions} The design must look like a real production website with crisp typography, proper spacing, professional layout, and real photographic content embedded in the sections. 4K quality, sharp details, modern web design.`;

    const input: Record<string, unknown> = {
      prompt: enhancedPrompt,
      aspect_ratio: "4:3",
      output_format: "jpg",
    };

    if (imageInputs.length > 0) {
      input.image_input = imageInputs;
    }

    const prediction = await replicate.predictions.create({
      model: "google/nano-banana-2",
      input,
    });

    // Save the enhanced prompt to the variant
    await supabase
      .from("variants")
      .update({ prompt: enhancedPrompt })
      .eq("id", variantId);

    return NextResponse.json({ predictionId: prediction.id });
  } catch (error) {
    console.error("Image generation error:", error);
    return NextResponse.json(
      { error: "Failed to start image generation" },
      { status: 500 }
    );
  }
}
