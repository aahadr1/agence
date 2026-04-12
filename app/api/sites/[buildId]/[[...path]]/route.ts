import { createServiceClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
};

function getContentType(filePath: string): string {
  const ext = filePath.substring(filePath.lastIndexOf("."));
  return CONTENT_TYPES[ext] || "text/html; charset=utf-8";
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ buildId: string; path?: string[] }> }
) {
  const { buildId, path } = await params;
  const requestedPath = path?.join("/") || "index.html";

  const serviceClient = await createServiceClient();

  const { data: build } = await serviceClient
    .from("website_builds")
    .select("files")
    .eq("id", buildId)
    .single();

  if (!build?.files) {
    return new NextResponse("<!DOCTYPE html><html><body><h1>Build not found</h1></body></html>", {
      status: 404,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  const files = build.files as { path: string; content: string }[];

  let file = files.find((f) => f.path === requestedPath);

  if (!file) {
    file = files.find((f) => f.path === requestedPath + ".html");
  }

  if (!file && requestedPath === "index.html") {
    file = files[0];
  }

  if (!file) {
    return new NextResponse(
      `<!DOCTYPE html><html><body><h1>Page not found: ${requestedPath}</h1><a href="index.html">Back to home</a></body></html>`,
      {
        status: 404,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      }
    );
  }

  return new NextResponse(file.content, {
    headers: {
      "Content-Type": getContentType(file.path),
      "Cache-Control": "public, max-age=60",
      "X-Frame-Options": "SAMEORIGIN",
    },
  });
}
