import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { stage_id, sort_order, title, value_cents } = body as {
    stage_id?: string;
    sort_order?: number;
    title?: string;
    value_cents?: number | null;
  };

  const updates: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (stage_id !== undefined) updates.stage_id = stage_id;
  if (sort_order !== undefined) updates.sort_order = sort_order;
  if (title !== undefined) updates.title = title;
  if (value_cents !== undefined) updates.value_cents = value_cents;

  const { data: prev } = await supabase
    .from("deals")
    .select("stage_id")
    .eq("id", id)
    .single();

  const { data: deal, error } = await supabase
    .from("deals")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (stage_id && prev?.stage_id !== stage_id) {
    await supabase.from("deal_activities").insert({
      org_id: deal.org_id,
      deal_id: id,
      type: "stage_change",
      payload: { from: prev?.stage_id, to: stage_id },
      created_by: user.id,
    });
  }

  return NextResponse.json({ deal });
}
