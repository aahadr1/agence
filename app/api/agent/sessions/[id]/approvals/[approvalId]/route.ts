import { NextResponse, after } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 300;

async function dispatchApprovalResponse(
  sessionId: string,
  approvalId: string,
  decision: "approve" | "reject",
  comment: string | null,
) {
  if (process.env.INNGEST_EVENT_KEY) {
    try {
      const { inngest } = await import("@/lib/inngest/client");
      await inngest.send({
        name: "agent/approval.responded",
        data: { sessionId, approvalId, decision, comment },
      });
      return;
    } catch (e) {
      console.warn("[agent] inngest.send failed, falling back inline:", e);
    }
  }
  const userMessage = `The user ${
    decision === "approve" ? "APPROVED" : "REJECTED"
  } the pending action${comment ? ` with comment: ${comment}` : ""}. ${
    decision === "approve"
      ? "Proceed."
      : "Do NOT execute that action. Acknowledge and continue with alternatives."
  }`;
  after(async () => {
    try {
      const { runSession } = await import(
        "@/lib/inngest/functions/session-run"
      );
      await runSession(sessionId, { userMessage });
    } catch (e) {
      console.error("[agent] inline runSession failed:", e);
    }
  });
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string; approvalId: string }> },
) {
  const { id, approvalId } = await ctx.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json()) as {
    decision: "approve" | "reject";
    comment?: string;
  };
  if (!["approve", "reject"].includes(body.decision)) {
    return NextResponse.json({ error: "invalid decision" }, { status: 400 });
  }

  const service = await createServiceClient();
  const status = body.decision === "approve" ? "approved" : "rejected";
  const { error } = await service
    .from("agent_approvals")
    .update({
      status,
      user_response: body.comment || null,
      responded_at: new Date().toISOString(),
    })
    .eq("id", approvalId)
    .eq("session_id", id);
  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  await service.from("agent_messages").insert({
    session_id: id,
    role: "approval_response",
    content: status,
    metadata: { approval_id: approvalId, comment: body.comment || null },
  });

  await dispatchApprovalResponse(
    id,
    approvalId,
    body.decision,
    body.comment || null,
  );

  return NextResponse.json({ ok: true });
}
