import { createClient } from "@/lib/supabase/server";
import { telephonyEnvReady } from "@/lib/telephony/config";
import { getTwilioRestClient } from "@/lib/telephony/twilio-server";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Termine un appel Twilio en cours (ex. jambe click-to-call sans WebRTC).
 */
export async function POST(request: Request) {
  if (!telephonyEnvReady()) {
    return NextResponse.json({ error: "Twilio n’est pas configuré." }, { status: 503 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { callSid } = await request.json();
  if (!callSid || typeof callSid !== "string") {
    return NextResponse.json({ error: "callSid requis" }, { status: 400 });
  }

  try {
    const client = getTwilioRestClient();
    await client.calls(callSid).update({ status: "completed" });
  } catch (e) {
    console.error("[telephony/hangup]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Twilio error" },
      { status: 502 }
    );
  }

  return NextResponse.json({ ok: true });
}
