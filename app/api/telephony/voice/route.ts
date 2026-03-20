import {
  getCallerId,
  recordingCallbackUrl,
  validateTwilioWebhook,
} from "@/lib/telephony/twilio-server";
import { NextResponse } from "next/server";
import twilio from "twilio";

export const dynamic = "force-dynamic";

function twimlResponse(vr: InstanceType<typeof twilio.twiml.VoiceResponse>) {
  return new NextResponse(vr.toString(), {
    headers: { "Content-Type": "text/xml; charset=utf-8" },
  });
}

/**
 * TwiML App (sortants navigateur / Voice SDK).
 * Console Twilio → TwiML App → Voice URL = POST https://…/api/telephony/voice
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

  const To = body.To?.trim();
  const VoiceResponse = twilio.twiml.VoiceResponse;
  const twiml = new VoiceResponse();
  const callerId = getCallerId();

  if (!callerId) {
    twiml.say(
      { voice: "Polly.Celine", language: "fr-FR" },
      "Configuration téléphonie incomplète."
    );
    return twimlResponse(twiml);
  }

  if (!To) {
    twiml.say(
      { voice: "Polly.Celine", language: "fr-FR" },
      "Numéro de destination manquant."
    );
    return twimlResponse(twiml);
  }

  const dial = twiml.dial({
    callerId,
    answerOnBridge: true,
    timeout: 60,
    record: "record-from-answer",
    recordingStatusCallback: recordingCallbackUrl(),
    recordingStatusCallbackEvent: ["completed"],
  });
  dial.number(To);

  return twimlResponse(twiml);
}
