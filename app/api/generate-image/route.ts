import { createClient } from "@/lib/supabase/server";
import { getReplicate } from "@/lib/replicate";
import { NextResponse } from "next/server";

export const maxDuration = 60;

type ModelAttempt = {
  model: string;
  label: string;
  input: Record<string, unknown>;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function createPredictionWithRetry(
  replicate: ReturnType<typeof getReplicate>,
  attempt: ModelAttempt,
  maxAttempts = 2
) {
  let lastError: unknown = null;

  for (let currentAttempt = 1; currentAttempt <= maxAttempts; currentAttempt++) {
    try {
      return await replicate.predictions.create({
        model: attempt.model,
        input: attempt.input,
      });
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      console.warn(
        `[generate-image] ${attempt.label} attempt ${currentAttempt}/${maxAttempts} failed: ${message}`
      );
      if (currentAttempt < maxAttempts) {
        await sleep(700 * currentAttempt);
      }
    }
  }

  throw lastError ?? new Error(`${attempt.label} failed`);
}

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

    // Fetch project images in priority order
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
            img.type === "photo" && img.analysis?.source !== "web"
        );
        for (const photo of userPhotos) {
          imageInputs.push(photo.url);
        }

        // 3. Web-found photos (now persisted to Supabase) — exclude low quality
        const webPhotos = images.filter(
          (img) =>
            img.type === "photo" &&
            img.analysis?.source === "web" &&
            img.analysis?.quality !== "low"
        );
        for (const photo of webPhotos) {
          imageInputs.push(photo.url);
        }

        // Cap at 14
        imageInputs = imageInputs.slice(0, 14);
      }
    }

    console.log(
      `[generate-image] variantId=${variantId}, images=${imageInputs.length}`
    );

    // The prompt from ideation is already hyper-detailed and references images.
    // We just frame it for the image model.
    const finalPrompt = `${prompt}

The website must look like a real, live, professional website screenshot at 4K resolution. Crisp text rendering, proper antialiasing, realistic browser chrome, natural shadows and depth. This is not a wireframe or mockup — it should be indistinguishable from a screenshot of a real premium website. The reference images provided must be visibly embedded as actual content within the website layout (as hero photos, gallery images, logo, etc.) — not recreated or replaced with AI-generated alternatives.`;

    // Save the final prompt to the variant
    await supabase
      .from("variants")
      .update({ prompt: finalPrompt })
      .eq("id", variantId);

    const gptInput: Record<string, unknown> = {
      prompt: finalPrompt,
      quality: "high",
      aspect_ratio: "4:3",
      output_format: "webp",
      output_compression: 90,
      number_of_images: 1,
      moderation: "auto",
      background: "auto",
    };
    if (imageInputs.length > 0) {
      gptInput.input_images = imageInputs;
      gptInput.input_fidelity = "high";
    }

    const nanoBananaInput: Record<string, unknown> = {
      prompt: finalPrompt,
      aspect_ratio: "4:3",
      output_format: "jpg",
    };
    if (imageInputs.length > 0) {
      nanoBananaInput.image_input = imageInputs;
    }

    const configuredPrimary =
      process.env.REPLICATE_IMAGE_PRIMARY_MODEL?.trim() || "openai/gpt-image-1.5";
    const configuredSecondary =
      process.env.REPLICATE_IMAGE_SECONDARY_MODEL?.trim() || "openai/gpt-image-1";
    const configuredFallback =
      process.env.REPLICATE_IMAGE_FALLBACK_MODEL?.trim() || "google/nano-banana-2";

    const modelAttempts: ModelAttempt[] = [
      {
        model: configuredPrimary,
        label: "Primary image model",
        input: gptInput,
      },
      {
        model: configuredSecondary,
        label: "Secondary image model",
        input: gptInput,
      },
      {
        model: configuredFallback,
        label: "Fallback image model",
        input: nanoBananaInput,
      },
    ];

    let prediction = null;
    let lastError: unknown = null;

    for (const attempt of modelAttempts) {
      try {
        prediction = await createPredictionWithRetry(replicate, attempt, 2);
        console.log(
          `[generate-image] using ${attempt.label}: ${attempt.model} (prediction ${prediction.id})`
        );
        break;
      } catch (error) {
        lastError = error;
      }
    }

    if (!prediction) {
      throw lastError instanceof Error
        ? lastError
        : new Error("All image generation models failed");
    }

    return NextResponse.json({ predictionId: prediction.id });
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : String(error);
    console.error("Image generation error:", errorMessage, error);
    return NextResponse.json(
      { error: `Image generation failed: ${errorMessage}` },
      { status: 500 }
    );
  }
}
