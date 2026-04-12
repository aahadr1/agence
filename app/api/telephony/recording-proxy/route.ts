import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Proxy pour streamer un enregistrement Twilio (auth required).
 * GET /api/telephony/recording-proxy?url=https://api.twilio.com/...
 */
export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const urlParam = new URL(request.url).searchParams.get("url");
  if (!urlParam) {
    return NextResponse.json({ error: "url param required" }, { status: 400 });
  }

  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) {
    return NextResponse.json({ error: "Twilio not configured" }, { status: 503 });
  }

  // Ensure the URL points to Twilio (prevent SSRF)
  const parsed = new URL(urlParam);
  if (!parsed.hostname.endsWith("twilio.com")) {
    return NextResponse.json({ error: "Invalid recording URL" }, { status: 400 });
  }

  // Append .mp3 if needed
  const mediaUrl = parsed.pathname.endsWith(".mp3") || parsed.pathname.endsWith(".wav")
    ? urlParam
    : `${urlParam}.mp3`;

  const auth = Buffer.from(`${sid}:${token}`).toString("base64");
  const upstream = await fetch(mediaUrl, {
    headers: { Authorization: `Basic ${auth}` },
  });

  if (!upstream.ok) {
    return NextResponse.json(
      { error: `Twilio returned ${upstream.status}` },
      { status: upstream.status }
    );
  }

  const contentType = upstream.headers.get("content-type") || "audio/mpeg";
  const body = upstream.body;

  return new NextResponse(body, {
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "private, max-age=3600",
    },
  });
}
