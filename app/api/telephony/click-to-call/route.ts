import { createClient } from "@/lib/supabase/server";
import { getPublicAppUrl, telephonyEnvReady } from "@/lib/telephony/config";
import { normalizeToE164 } from "@/lib/telephony/phone";
import { getTwilioNumber, getTwilioRestClient, statusCallbackUrl } from "@/lib/telephony/twilio-server";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!telephonyEnvReady()) {
    return NextResponse.json(
      { error: "Twilio n’est pas configuré." },
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

  const { to } = await request.json();
  if (!to || typeof to !== "string") {
    return NextResponse.json({ error: "Numéro destination requis" }, { status: 400 });
  }

  const destination = normalizeToE164(to.trim());

  const { data: agent } = await supabase
    .from("telephony_agents")
    .select("phone_e164")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!agent?.phone_e164) {
    return NextResponse.json(
      {
        error:
          "Enregistrez d’abord votre numéro mobile (section « Votre numéro ») pour le click-to-call.",
      },
      { status: 400 }
    );
  }

  const fromNum = getTwilioNumber();
  if (!fromNum) {
    return NextResponse.json(
      {
        error:
          "TWILIO_PHONE_NUMBER (numéro Twilio E.164) est requis pour lancer un appel.",
      },
      { status: 503 }
    );
  }
  const base = getPublicAppUrl();
  const connectUrl = new URL(
    `${base}/api/telephony/twiml/click-connect`
  );
  connectUrl.searchParams.set("To", destination);
  connectUrl.searchParams.set("UserId", user.id);

  try {
    const client = getTwilioRestClient();
    const created = await client.calls.create({
      from: fromNum,
      to: agent.phone_e164,
      url: connectUrl.toString(),
      method: "POST",
      statusCallback: statusCallbackUrl(),
      statusCallbackEvent: ["initiated", "ringing", "answered", "completed"],
      statusCallbackMethod: "POST",
    });
    return NextResponse.json({ ok: true, callSid: created.sid });
  } catch (e) {
    console.error("[telephony/click-to-call]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Twilio error" },
      { status: 502 }
    );
  }
}
