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

    // Fetch uploaded images to use as references
    let imageInputs: string[] = [];
    if (projectId) {
      const { data: images } = await supabase
        .from("project_images")
        .select("url, type")
        .eq("project_id", projectId)
        .order("type", { ascending: true }); // logo first, then photos

      if (images && images.length > 0) {
        // Pass up to 14 images (Nano Banana 2 limit)
        imageInputs = images.slice(0, 14).map((img) => img.url);
      }
    }

    // Build the enhanced prompt
    const enhancedPrompt = `Professional high-fidelity website landing page screenshot, UI/UX design mockup. ${prompt}. Use the provided reference images: the first image is the business logo — place it in the website header/navigation. Any additional images are business photos — incorporate them naturally into the website sections (hero, gallery, about). The design should look like a real production website screenshot with crisp typography, proper spacing, and professional layout. 4K quality, sharp details, modern web design.`;

    // Build input with or without image references
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

    // Update variant with the enhanced prompt
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
