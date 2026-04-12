import { requireCrmContext } from "@/lib/crm/api";
import { parseTaskPriority, parseTaskStatus } from "@/lib/crm/service";
import { NextResponse } from "next/server";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const ctx = await requireCrmContext(request);
  if (!ctx.ok) return ctx.response;
  const { id } = await context.params;
  const body = (await request.json()) as {
    title?: string;
    description?: string | null;
    status?: string;
    priority?: string;
    due_at?: string | null;
    reminder_at?: string | null;
    assigned_to?: string | null;
  };

  const patch: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (body.title !== undefined) patch.title = body.title;
  if (body.description !== undefined) patch.description = body.description;
  if (body.due_at !== undefined) patch.due_at = body.due_at;
  if (body.reminder_at !== undefined) patch.reminder_at = body.reminder_at;
  if (body.assigned_to !== undefined) patch.assigned_to = body.assigned_to;
  if (body.status !== undefined) {
    const status = parseTaskStatus(body.status);
    if (!status) return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    patch.status = status;
    patch.completed_at = status === "done" ? new Date().toISOString() : null;
  }
  if (body.priority !== undefined) {
    const priority = parseTaskPriority(body.priority);
    if (!priority) return NextResponse.json({ error: "Invalid priority" }, { status: 400 });
    patch.priority = priority;
  }

  const { data, error } = await ctx.supabase
    .from("crm_tasks")
    .update(patch)
    .eq("id", id)
    .eq("org_id", ctx.orgId)
    .select("*")
    .single();

  if (error || !data) {
    return NextResponse.json({ error: error?.message || "Update failed" }, { status: 500 });
  }
  return NextResponse.json({ task: data });
}
