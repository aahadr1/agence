import { createServiceClient } from "@/lib/supabase/server";
import { validateTwilioWebhook } from "@/lib/telephony/twilio-server";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function clientIdentityToUserId(from: string | undefined): string | null {
  if (!from) return null;
  const m = /^client:user_(.+)$/.exec(from);
  return m ? m[1] : null;
}

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
  const status = body.CallStatus;
  const from = body.From;
  const to = body.To;
  const direction = body.Direction;
  const parentCallSid = body.ParentCallSid;

  if (!callSid) {
    return NextResponse.json({ ok: true });
  }

  const initiatedBy = clientIdentityToUserId(from);

  try {
    const supabase = await createServiceClient();

    const { data: existing } = await supabase
      .from("telephony_calls")
      .select("id, initiated_by")
      .eq("call_sid", callSid)
      .maybeSingle();

    const payload = {
      call_sid: callSid,
      parent_call_sid: parentCallSid || null,
      direction: direction || null,
      from_number: from || null,
      to_number: to || null,
      status: status || null,
      initiated_by: initiatedBy || existing?.initiated_by || null,
      updated_at: new Date().toISOString(),
    };

    if (existing?.id) {
      await supabase
        .from("telephony_calls")
        .update(payload)
        .eq("id", existing.id);
    } else {
      await supabase.from("telephony_calls").insert({
        ...payload,
        metadata: {},
      });
    }
  } catch (e) {
    console.error("[telephony/status]", e);
  }

  return NextResponse.json({ ok: true });
}
