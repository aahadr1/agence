import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { authenticateLocalWorker } from "@/lib/agent/local-browser-worker";
import { askGemini, askGeminiText } from "@/lib/lead-agent/browser";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(req: Request) {
  const service = await createServiceClient();
  const worker = await authenticateLocalWorker(
    service,
    req.headers.get("authorization"),
  );
  if (!worker) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as {
    mode?: "json" | "text";
    prompt?: string;
    imageBase64?: string;
  };
  if (!body.prompt?.trim()) {
    return NextResponse.json({ error: "prompt required" }, { status: 400 });
  }

  if (body.mode === "text") {
    const text = await askGeminiText(body.prompt);
    return NextResponse.json({ text });
  }

  const json = await askGemini<unknown>(body.prompt, body.imageBase64);
  return NextResponse.json({ json });
}
