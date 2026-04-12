import { resolveOrgIdForUser } from "@/lib/org/resolve-org";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ searchId: string }> }
) {
  try {
    const { searchId } = await params;
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const serviceClient = await createServiceClient();
    const orgId = await resolveOrgIdForUser(serviceClient, user.id);

    const { data, error } = await serviceClient
      .from("leads")
      .select("*")
      .eq("org_id", orgId)
      .eq("search_id", searchId)
      .order("has_website", { ascending: true });

    if (error) {
      return NextResponse.json(
        { error: error.message || "Failed to load leads" },
        { status: 500 }
      );
    }

    return NextResponse.json({ leads: data || [] });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error("Lead generator leads error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
