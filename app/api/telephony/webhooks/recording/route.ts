import { createServiceClient } from "@/lib/supabase/server";
import { validateTwilioWebhook } from "@/lib/telephony/twilio-server";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

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

  const callSid = body.CallSid;
  const recordingUrl = body.RecordingUrl;
  const recordingSid = body.RecordingSid;
  const duration = body.RecordingDuration;

  if (!callSid) {
    return NextResponse.json({ ok: true });
  }

  try {
    const supabase = await createServiceClient();
    const patch = {
      recording_url: recordingUrl || null,
      recording_sid: recordingSid || null,
      recording_duration_sec: duration ? parseInt(duration, 10) : null,
      updated_at: new Date().toISOString(),
    };
    const { data: row } = await supabase
      .from("telephony_calls")
      .select("id")
      .eq("call_sid", callSid)
      .maybeSingle();
    if (row) {
      await supabase.from("telephony_calls").update(patch).eq("call_sid", callSid);
    } else {
      await supabase.from("telephony_calls").insert({
        call_sid: callSid,
        ...patch,
        metadata: {},
      });
    }
  } catch (e) {
    console.error("[telephony/recording]", e);
  }

  return NextResponse.json({ ok: true });
}
