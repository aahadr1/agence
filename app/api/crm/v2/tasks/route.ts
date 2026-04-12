import { requireCrmContext } from "@/lib/crm/api";
import { parseTaskPriority, parseTaskStatus } from "@/lib/crm/service";
import { NextResponse } from "next/server";

function isSchemaDrift(error: { message?: string; details?: string; code?: string }) {
  const haystack =
    `${error.code || ""} ${error.message || ""} ${error.details || ""}`.toLowerCase();
  return (
    haystack.includes("schema cache") ||
    haystack.includes("could not find the table") ||
    error.code === "42P01"
  );
}

export async function GET(request: Request) {
  const ctx = await requireCrmContext(request);
  if (!ctx.ok) return ctx.response;
  const { searchParams } = new URL(request.url);
  const assignedTo = searchParams.get("assignedTo");
  const mode = searchParams.get("mode") || "team";

  let q = ctx.supabase
    .from("crm_tasks")
    .select("*")
    .eq("org_id", ctx.orgId)
    .order("due_at", { ascending: true, nullsFirst: false })
    .limit(300);

  if (mode === "mine") {
    q = q.eq("assigned_to", ctx.userId);
  } else if (assignedTo) {
    q = q.eq("assigned_to", assignedTo);
  }

  const { data, error } = await q;
  if (error) {
    if (isSchemaDrift(error)) {
      return NextResponse.json({ tasks: [], fallback: true, mode: "legacy" });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ tasks: data || [] });
}

export async function POST(request: Request) {
  const ctx = await requireCrmContext(request);
  if (!ctx.ok) return ctx.response;
  const body = (await request.json()) as {
    title?: string;
    description?: string | null;
    opportunity_id?: string | null;
    account_id?: string | null;
    contact_id?: string | null;
    status?: string;
    priority?: string;
    due_at?: string | null;
    reminder_at?: string | null;
    assigned_to?: string | null;
  };

  const title = body.title?.trim();
  if (!title) return NextResponse.json({ error: "title required" }, { status: 400 });
  const status = body.status ? parseTaskStatus(body.status) : "todo";
  const priority = body.priority ? parseTaskPriority(body.priority) : "medium";
  if (!status) return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  if (!priority) return NextResponse.json({ error: "Invalid priority" }, { status: 400 });

  const { data: task, error } = await ctx.supabase
    .from("crm_tasks")
    .insert({
      org_id: ctx.orgId,
      opportunity_id: body.opportunity_id || null,
      account_id: body.account_id || null,
      contact_id: body.contact_id || null,
      title,
      description: body.description || null,
      status,
      priority,
      due_at: body.due_at || null,
      reminder_at: body.reminder_at || null,
      assigned_to: body.assigned_to || ctx.userId,
      created_by: ctx.userId,
    })
    .select("*")
    .single();

  if (error || !task) {
    return NextResponse.json({ error: error?.message || "Insert failed" }, { status: 500 });
  }

  if (task.opportunity_id) {
    await ctx.supabase.from("crm_activities").insert({
      org_id: ctx.orgId,
      opportunity_id: task.opportunity_id,
      account_id: task.account_id,
      contact_id: task.contact_id,
      task_id: task.id,
      type: "system",
      body: `Task created: ${task.title}`,
      created_by: ctx.userId,
      metadata: { task_id: task.id },
    });
  }

  return NextResponse.json({ task });
}
