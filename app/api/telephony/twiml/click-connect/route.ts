import { createServiceClient } from "@/lib/supabase/server";
import {
  recordingCallbackUrl,
  validateTwilioWebhook,
} from "@/lib/telephony/twilio-server";
import { NextResponse } from "next/server";
import twilio from "twilio";

export const dynamic = "force-dynamic";

/**
 * TwiML pour le 1er jambe du click-to-call : l’employé décroche, on compose le client.
 * URL appelée par Twilio avec ?To=E164&UserId=uuid
 */
export async function POST(request: Request) {
  const text = await request.text();
  const params = new URLSearchParams(text);
  const body: Record<string, string> = {};
  params.forEach((v, k) => {
    body[k] = v;
  });

  if (!validateTwilioWebhook(request, body)) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const urlObj = new URL(request.url);
  const to = urlObj.searchParams.get("To")?.trim();
  const userId = urlObj.searchParams.get("UserId");

  const VoiceResponse = twilio.twiml.VoiceResponse;
  const twiml = new VoiceResponse();
  const callerId = process.env.TWILIO_PHONE_NUMBER;

  if (!callerId || !to) {
    twiml.say(
      { voice: "Polly.Celine", language: "fr-FR" },
      "Impossible de joindre ce numéro."
    );
    return xml(twiml);
  }

  const callSid = body.CallSid;
  if (callSid && userId) {
    try {
      const supabase = await createServiceClient();
      await supabase.from("telephony_calls").upsert(
        {
          call_sid: callSid,
          initiated_by: userId,
          from_number: body.From || null,
          to_number: to,
          direction: body.Direction || "outbound-api",
          status: body.CallStatus || "in-progress",
          metadata: { channel: "click-to-call" },
          updated_at: new Date().toISOString(),
        },
        { onConflict: "call_sid" }
      );
    } catch (e) {
      console.error("[telephony/click-connect] log", e);
    }
  }

  twiml.say(
    { voice: "Polly.Celine", language: "fr-FR" },
    "Connexion au client."
  );

  const dial = twiml.dial({
    callerId,
    answerOnBridge: true,
    timeout: 60,
    record: "record-from-answer",
    recordingStatusCallback: recordingCallbackUrl(),
    recordingStatusCallbackEvent: ["completed"],
  });
  dial.number(to);

  return xml(twiml);
}

function xml(vr: InstanceType<typeof twilio.twiml.VoiceResponse>) {
  return new NextResponse(vr.toString(), {
    headers: { "Content-Type": "text/xml; charset=utf-8" },
  });
}
