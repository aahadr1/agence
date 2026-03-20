import { createClient, createServiceClient } from "@/lib/supabase/server";
import { getReplicate } from "@/lib/replicate";
import { NextResponse } from "next/server";

function serializeOutput(output: unknown): string {
  if (typeof output === "string") {
    return output;
  }
  if (output === null || typeof output === "undefined") {
    return "";
  }
  try {
    return JSON.stringify(output);
  } catch {
    return String(output);
  }
}

function parseJsonIfPossible(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function extractImageUrl(output: unknown): string | null {
  const queue: unknown[] = [output];
  const visited = new Set<object>();
  const candidates: string[] = [];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;

    if (typeof current === "string") {
      const trimmed = current.trim();
      if (!trimmed) continue;
      candidates.push(trimmed);
      const parsed = parseJsonIfPossible(trimmed);
      if (parsed && typeof parsed === "object") {
        queue.push(parsed);
      }
      continue;
    }

    if (Array.isArray(current)) {
      for (const item of current) {
        queue.push(item);
      }
      continue;
    }

    if (typeof current === "object") {
      if (visited.has(current)) continue;
      visited.add(current);
      for (const value of Object.values(current)) {
        queue.push(value);
      }
    }
  }

  for (const candidate of candidates) {
    const withoutThinking = candidate
      .replace(/<think>[\s\S]*?<\/think>/g, "")
      .trim();
    if (!withoutThinking) continue;
    if (
      withoutThinking.startsWith("http://") ||
      withoutThinking.startsWith("https://") ||
      withoutThinking.startsWith("data:image/")
    ) {
      return withoutThinking;
    }
  }

  for (const candidate of candidates) {
    const match = candidate.match(/https?:\/\/[^\s"'<>]+/);
    if (match?.[0]) {
      return match[0];
    }
  }

  return null;
}

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
      const outputStr = serializeOutput(prediction.output);
      let imageUrl: string | null = extractImageUrl(prediction.output);
      let rawOutput: string | null = imageUrl ? null : outputStr;

      console.log(
        `[predictions/${id}] output type: ${typeof prediction.output}, isArray: ${Array.isArray(prediction.output)}, extractedImage=${Boolean(imageUrl)}, length: ${outputStr.length}`
      );

      // If it's an image, persist it to Supabase Storage so the URL never expires
      if (imageUrl) {
        const permanentUrl = await persistImage(imageUrl, id);
        if (permanentUrl) {
          imageUrl = permanentUrl;
          rawOutput = null;
        } else if (!rawOutput) {
          rawOutput = outputStr;
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
