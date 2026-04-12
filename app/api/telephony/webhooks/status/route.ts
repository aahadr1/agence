import { resolveOrgIdForUser } from "@/lib/org/resolve-org";
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
      .select("id, initiated_by, org_id, deal_id, metadata")
      .eq("call_sid", callSid)
      .maybeSingle();

    const orgId =
      existing?.org_id ??
      (await resolveOrgIdForUser(
        supabase,
        initiatedBy || existing?.initiated_by || null
      ));

    const payload = {
      call_sid: callSid,
      org_id: orgId,
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

    if ((status || "").toLowerCase() === "completed") {
      const { data: callRow } = await supabase
        .from("telephony_calls")
        .select("id, deal_id, org_id, initiated_by, metadata")
        .eq("call_sid", callSid)
        .maybeSingle();

      const meta = (callRow?.metadata as Record<string, unknown> | null) || {};
      const nextMeta = { ...meta };

      if (callRow?.deal_id && !meta.crm_call_logged_legacy) {
        await supabase.from("deal_activities").insert({
          org_id: callRow.org_id,
          deal_id: callRow.deal_id,
          type: "call",
          payload: {
            call_sid: callSid,
            status,
            to_number: to || null,
            from_number: from || null,
          },
          created_by: callRow.initiated_by,
        });
        nextMeta.crm_call_logged_legacy = true;
      }

      let opportunityId =
        typeof meta.opportunity_id === "string" ? meta.opportunity_id : null;
      if (!opportunityId && callRow?.deal_id) {
        const { data: mappedOpportunity } = await supabase
          .from("crm_opportunities")
          .select("id")
          .eq("legacy_deal_id", callRow.deal_id)
          .limit(1)
          .maybeSingle();
        opportunityId = mappedOpportunity?.id || null;
      }

      if (callRow?.id && opportunityId && !meta.crm_call_logged_v2) {
        const { data: opportunity } = await supabase
          .from("crm_opportunities")
          .select("id, account_id, primary_contact_id")
          .eq("id", opportunityId)
          .limit(1)
          .maybeSingle();

        if (opportunity) {
          const { data: activity } = await supabase
            .from("crm_activities")
            .insert({
              org_id: callRow.org_id,
              opportunity_id: opportunity.id,
              account_id: opportunity.account_id,
              contact_id: opportunity.primary_contact_id,
              type: "call",
              body: "Call completed",
              metadata: {
                call_sid: callSid,
                status,
                to_number: to || null,
                from_number: from || null,
                direction: direction || null,
                channel:
                  typeof meta.channel === "string" ? meta.channel : null,
              },
              created_by: callRow.initiated_by,
            })
            .select("id")
            .single();

          if (activity?.id) {
            await supabase.from("crm_activity_links").insert({
              org_id: callRow.org_id,
              activity_id: activity.id,
              linked_type: "telephony_call",
              linked_id: callRow.id,
              label: "Phone call",
            });

            nextMeta.crm_call_logged_v2 = true;
            nextMeta.crm_activity_id = activity.id;
            nextMeta.opportunity_id = opportunity.id;
          }
        }
      }

      if (callRow?.id && JSON.stringify(nextMeta) !== JSON.stringify(meta)) {
        await supabase
          .from("telephony_calls")
          .update({
            metadata: nextMeta,
            updated_at: new Date().toISOString(),
          })
          .eq("call_sid", callSid);
      }
    }
  } catch (e) {
    console.error("[telephony/status]", e);
  }

  return NextResponse.json({ ok: true });
}
