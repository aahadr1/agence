import { createClient, createServiceClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ listId: string }> }
) {
  try {
    const { listId } = await params;
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const serviceClient = await createServiceClient();

    const { data: list } = await serviceClient
      .from("lead_lists")
      .select("*")
      .eq("id", listId)
      .eq("user_id", user.id)
      .single();

    if (!list) return NextResponse.json({ error: "List not found" }, { status: 404 });

    const { data: items } = await serviceClient
      .from("lead_list_items")
      .select("*, lead:leads(*)")
      .eq("list_id", listId)
      .order("added_at", { ascending: false });

    return NextResponse.json({ list, items: items || [] });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error("Lead generator error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ listId: string }> }
) {
  try {
    const { listId } = await params;
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await request.json();
    const serviceClient = await createServiceClient();

    const { error } = await serviceClient
      .from("lead_lists")
      .update({ ...body, updated_at: new Date().toISOString() })
      .eq("id", listId)
      .eq("user_id", user.id);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error("Lead generator error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ listId: string }> }
) {
  try {
    const { listId } = await params;
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const serviceClient = await createServiceClient();
    await serviceClient
      .from("lead_lists")
      .delete()
      .eq("id", listId)
      .eq("user_id", user.id);

    return NextResponse.json({ success: true });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error("Lead generator error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
