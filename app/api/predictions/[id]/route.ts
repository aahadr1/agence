import { createClient, createServiceClient } from "@/lib/supabase/server";
import { getReplicate } from "@/lib/replicate";
import { NextResponse } from "next/server";

async function persistImage(
  imageUrl: string,
  predictionId: string
): Promise<string | null> {
  try {
    const serviceClient = await createServiceClient();

    // Download the image from Replicate
    const res = await fetch(imageUrl);
    if (!res.ok) return null;

    const buffer = Buffer.from(await res.arrayBuffer());
    const contentType = res.headers.get("content-type") || "image/jpeg";
    const ext = contentType.includes("png")
      ? "png"
      : contentType.includes("webp")
      ? "webp"
      : "jpg";

    const storagePath = `variants/${predictionId}.${ext}`;

    const { error: uploadError } = await serviceClient.storage
      .from("project-images")
      .upload(storagePath, buffer, {
        contentType,
        upsert: true,
      });

    if (uploadError) {
      console.error("Failed to persist image:", uploadError.message);
      return null;
    }

    // Return the permanent Supabase public URL
    const {
      data: { publicUrl },
    } = serviceClient.storage
      .from("project-images")
      .getPublicUrl(storagePath);

    return publicUrl;
  } catch (err) {
    console.error("persistImage error:", err);
    return null;
  }
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const replicate = getReplicate();
    const prediction = await replicate.predictions.get(id);

    if (prediction.status === "succeeded") {
      // Determine output type: image URL or text (Claude)
      let imageUrl: string | null = null;
      let rawOutput: string | null = null;

      if (Array.isArray(prediction.output)) {
        const joined = prediction.output.join("");
        if (joined.startsWith("http") && !joined.includes("{")) {
          imageUrl = prediction.output[0];
        } else {
          rawOutput = joined;
        }
      } else if (typeof prediction.output === "string") {
        if (
          prediction.output.startsWith("http") &&
          !prediction.output.includes("{")
        ) {
          imageUrl = prediction.output;
        } else {
          rawOutput = prediction.output;
        }
      }

      // If it's an image, persist it to Supabase Storage so the URL never expires
      if (imageUrl) {
        const permanentUrl = await persistImage(imageUrl, id);
        if (permanentUrl) {
          imageUrl = permanentUrl;
        }
      }

      // Update the variant with the permanent image URL
      if (
        imageUrl &&
        prediction.input &&
        typeof prediction.input === "object" &&
        "prompt" in prediction.input
      ) {
        const promptText = (prediction.input as Record<string, unknown>)
          .prompt as string;
        await supabase
          .from("variants")
          .update({ image_url: imageUrl })
          .eq("prompt", promptText)
          .is("image_url", null);
      }

      return NextResponse.json({
        status: "succeeded",
        imageUrl,
        rawOutput,
      });
    }

    return NextResponse.json({
      status: prediction.status,
      imageUrl: null,
      error: prediction.error ? String(prediction.error) : null,
    });
  } catch (error) {
    console.error("Prediction poll error:", error);
    return NextResponse.json(
      { error: "Failed to check prediction status" },
      { status: 500 }
    );
  }
}
