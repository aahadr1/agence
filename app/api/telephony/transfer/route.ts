import { createClient } from "@/lib/supabase/server";
import { telephonyEnvReady } from "@/lib/telephony/config";
import { getTwilioRestClient } from "@/lib/telephony/twilio-server";
import { NextResponse } from "next/server";
import twilio from "twilio";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!telephonyEnvReady()) {
    return NextResponse.json({ error: "Twilio n’est pas configuré." }, { status: 503 });
  }

  const boss = process.env.TWILIO_TRANSFER_TO_BOSS?.trim();
  if (!boss) {
    return NextResponse.json(
      { error: "TWILIO_TRANSFER_TO_BOSS (E.164) n’est pas défini." },
      { status: 503 }
    );
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

  const VoiceResponse = twilio.twiml.VoiceResponse;
  const twiml = new VoiceResponse();
  twiml.say(
    { voice: "Polly.Celine", language: "fr-FR" },
    "Transfert vers votre responsable."
  );
  twiml.dial(boss);

  try {
    const client = getTwilioRestClient();
    await client.calls(callSid).update({ twiml: twiml.toString() });
  } catch (e) {
    console.error("[telephony/transfer]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Twilio error" },
      { status: 502 }
    );
  }

  return NextResponse.json({ ok: true });
}
