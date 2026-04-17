/**
 * POST /api/agent/tools/[id]/approve
 *
 * Approve a custom tool that the agent defined via `tool_create`. Only an
 * authenticated user who is a member of the tool's org can approve.
 *
 * body: { approve: boolean, disable?: boolean }
 */

import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as {
    approve?: boolean;
    disable?: boolean;
  };

  const service = await createServiceClient();
  const { data: tool } = await service
    .from("agent_custom_tools")
    .select("id, org_id, name")
    .eq("id", id)
    .maybeSingle();

  if (!tool)
    return NextResponse.json({ error: "not found" }, { status: 404 });

  const { data: mem } = await service
    .from("organization_members")
    .select("user_id")
    .eq("user_id", user.id)
    .eq("org_id", tool.org_id)
    .maybeSingle();
  if (!mem)
    return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const update: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (typeof body.approve === "boolean") {
    update.is_approved = body.approve;
    update.approved_by = body.approve ? user.id : null;
    update.approved_at = body.approve ? new Date().toISOString() : null;
  }
  if (typeof body.disable === "boolean") {
    update.is_disabled = body.disable;
  }

  const { error } = await service
    .from("agent_custom_tools")
    .update(update)
    .eq("id", id);
  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, tool });
}
