import { createClient } from "@/lib/supabase/server";
import { getReplicate } from "@/lib/replicate";
import { NextResponse } from "next/server";

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
        // If it looks like a URL, it's an image; otherwise it's text (Claude)
        if (joined.startsWith("http") && !joined.includes("{")) {
          imageUrl = prediction.output[0];
        } else {
          rawOutput = joined;
        }
      } else if (typeof prediction.output === "string") {
        if (prediction.output.startsWith("http") && !prediction.output.includes("{")) {
          imageUrl = prediction.output;
        } else {
          rawOutput = prediction.output;
        }
      }

      // Try to update the variant with image URL (for image predictions)
      if (imageUrl && prediction.input && typeof prediction.input === "object" && "prompt" in prediction.input) {
        const promptText = (prediction.input as Record<string, unknown>).prompt as string;
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
