import { createClient, createServiceClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ listId: string }> }
) {
  const { listId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { leadIds } = await request.json();
  if (!leadIds || !leadIds.length) {
    return NextResponse.json({ error: "leadIds required" }, { status: 400 });
  }

  const serviceClient = await createServiceClient();

  // Verify list ownership
  const { data: list } = await serviceClient
    .from("lead_lists")
    .select("excluded_business_names")
    .eq("id", listId)
    .eq("user_id", user.id)
    .single();
  if (!list) return NextResponse.json({ error: "List not found" }, { status: 404 });

  // Insert items (ignore duplicates)
  const items = leadIds.map((leadId: string) => ({
    list_id: listId,
    lead_id: leadId,
    status: "new",
  }));

  await serviceClient
    .from("lead_list_items")
    .upsert(items, { onConflict: "list_id,lead_id", ignoreDuplicates: true });

  // Update excluded_business_names
  const { data: leads } = await serviceClient
    .from("leads")
    .select("business_name")
    .in("id", leadIds);

  if (leads) {
    const newNames = leads.map((l: { business_name: string }) => l.business_name);
    const existing = list.excluded_business_names || [];
    const merged = [...new Set([...existing, ...newNames])];
    await serviceClient
      .from("lead_lists")
      .update({ excluded_business_names: merged, updated_at: new Date().toISOString() })
      .eq("id", listId);
  }

  return NextResponse.json({ success: true, added: leadIds.length });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ listId: string }> }
) {
  const { listId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { itemId, status, notes, outreach_template } = await request.json();
  if (!itemId) return NextResponse.json({ error: "itemId required" }, { status: 400 });

  const serviceClient = await createServiceClient();

  const updateData: Record<string, unknown> = {};
  if (status) {
    updateData.status = status;
    if (status === "contacted") updateData.contacted_at = new Date().toISOString();
  }
  if (notes !== undefined) updateData.notes = notes;
  if (outreach_template !== undefined) updateData.outreach_template = outreach_template;

  await serviceClient
    .from("lead_list_items")
    .update(updateData)
    .eq("id", itemId)
    .eq("list_id", listId);

  return NextResponse.json({ success: true });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ listId: string }> }
) {
  const { listId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { leadIds } = await request.json();
  if (!leadIds?.length) return NextResponse.json({ error: "leadIds required" }, { status: 400 });

  const serviceClient = await createServiceClient();
  await serviceClient
    .from("lead_list_items")
    .delete()
    .eq("list_id", listId)
    .in("lead_id", leadIds);

  return NextResponse.json({ success: true });
}
