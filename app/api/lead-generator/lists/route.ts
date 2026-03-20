import { createClient, createServiceClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const serviceClient = await createServiceClient();
    const { data: lists } = await serviceClient
      .from("lead_lists")
      .select("*, lead_list_items(count)")
      .eq("user_id", user.id)
      .order("updated_at", { ascending: false });

    return NextResponse.json({ lists: lists || [] });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error("Lead generator error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { name, keywords, leadIds } = await request.json();
    if (!name) return NextResponse.json({ error: "Name is required" }, { status: 400 });

    const serviceClient = await createServiceClient();

    // Create the list
    const { data: list, error } = await serviceClient
      .from("lead_lists")
      .insert({
        user_id: user.id,
        name,
        keywords: keywords || [],
      })
      .select()
      .single();

    if (error || !list) {
      return NextResponse.json({ error: error?.message || "Failed to create list" }, { status: 500 });
    }

    // Add initial leads if provided
    if (leadIds && leadIds.length > 0) {
      const items = leadIds.map((leadId: string) => ({
        list_id: list.id,
        lead_id: leadId,
        status: "new",
      }));
      await serviceClient.from("lead_list_items").insert(items);

      // Update excluded_business_names for future expansion
      const { data: leads } = await serviceClient
        .from("leads")
        .select("business_name")
        .in("id", leadIds);
      if (leads) {
        await serviceClient
          .from("lead_lists")
          .update({
            excluded_business_names: leads.map((l: { business_name: string }) => l.business_name),
          })
          .eq("id", list.id);
      }
    }

    return NextResponse.json({ list });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error("Lead generator error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
