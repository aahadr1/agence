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
      let imageUrl: string | null = null;

      if (Array.isArray(prediction.output)) {
        imageUrl = prediction.output[0];
      } else if (typeof prediction.output === "string") {
        imageUrl = prediction.output;
      }

      // Try to update the variant with this image URL
      // We find it by matching the prompt (since we stored the enhanced prompt)
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
      });
    }

    return NextResponse.json({
      status: prediction.status,
      imageUrl: null,
    });
  } catch (error) {
    console.error("Prediction poll error:", error);
    return NextResponse.json(
      { error: "Failed to check prediction status" },
      { status: 500 }
    );
  }
}
