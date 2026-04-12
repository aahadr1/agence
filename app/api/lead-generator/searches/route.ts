import { resolveOrgIdForUser } from "@/lib/org/resolve-org";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function GET() {
  try {
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
      .from("lead_searches")
      .select("*")
      .eq("org_id", orgId)
      .order("created_at", { ascending: false })
      .limit(20);

    if (error) {
      return NextResponse.json(
        { error: error.message || "Failed to load searches" },
        { status: 500 }
      );
    }

    return NextResponse.json({ searches: data || [] });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error("Lead generator searches error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
