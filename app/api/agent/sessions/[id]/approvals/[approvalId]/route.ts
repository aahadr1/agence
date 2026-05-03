import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { scheduleNextTick } from "@/lib/agent/runtime/schedule";

export const runtime = "nodejs";
export const maxDuration = 60;

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

  // Fetch the approval row so we can branch on the approval `kind` below.
  const { data: approvalRow } = await service
    .from("agent_approvals")
    .select("id, action, metadata")
    .eq("id", approvalId)
    .eq("session_id", id)
    .maybeSingle();

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

  // If this approval is for a self-coding proposal, actually push the branch
  // and open the PR now that we have a green light.
  let sideEffectNote = "";
  const approvalKind = (approvalRow?.metadata as { kind?: string })?.kind;
  if (body.decision === "approve" && approvalKind === "repo_push_pr") {
    const commitId = (approvalRow?.metadata as { commit_id?: string })?.commit_id;
    if (commitId) {
      try {
        const { applyApprovedProposal } = await import(
          "@/lib/agent/tools/repo"
        );
        const pr = await applyApprovedProposal(commitId);
        sideEffectNote = ` A PR was opened: #${pr.pr_number} (${pr.pr_url}).`;
      } catch (e) {
        sideEffectNote = ` WARNING: I tried to open the PR but it failed: ${
          e instanceof Error ? e.message : String(e)
        }`;
      }
    }
  }

  const decisionPrompt = `The user ${
    body.decision === "approve" ? "APPROVED" : "REJECTED"
  } the pending action${body.comment ? ` with comment: ${body.comment}` : ""}. ${
    body.decision === "approve"
      ? "Proceed."
      : "Do NOT execute that action. Acknowledge and continue with alternatives."
  }${sideEffectNote}`;

  await service.from("agent_messages").insert([
    {
      session_id: id,
      role: "approval_response",
      content: status,
      metadata: { approval_id: approvalId, comment: body.comment || null },
    },
    {
      session_id: id,
      role: "user",
      content: decisionPrompt,
    },
  ]);

  // Move session back to running so the ticker picks it up
  await service
    .from("agent_sessions")
    .update({ status: "running", updated_at: new Date().toISOString() })
    .eq("id", id);

  await scheduleNextTick(id, { delayMs: 0 });
  return NextResponse.json({ ok: true });
}
