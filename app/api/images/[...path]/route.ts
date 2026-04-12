import { createServiceClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  const storagePath = path.join("/");

  try {
    const serviceClient = await createServiceClient();

    const { data, error } = await serviceClient.storage
      .from("project-images")
      .download(storagePath);

    if (error || !data) {
      return NextResponse.json({ error: "Image not found" }, { status: 404 });
    }

    const arrayBuffer = await data.arrayBuffer();
    const ext = storagePath.split(".").pop()?.toLowerCase() || "jpg";
    const contentType =
      ext === "png"
        ? "image/png"
        : ext === "webp"
        ? "image/webp"
        : ext === "svg"
        ? "image/svg+xml"
        : ext === "gif"
        ? "image/gif"
        : "image/jpeg";

    return new NextResponse(arrayBuffer, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return NextResponse.json(
      { error: "Failed to serve image" },
      { status: 500 }
    );
  }
}
