import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: analysis, error } = await supabase
      .from("business_analyses")
      .select("*")
      .eq("id", id)
      .single();

    if (error || !analysis) {
      return NextResponse.json({ error: "Analysis not found" }, { status: 404 });
    }

    return NextResponse.json({ analysis });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Failed to fetch analysis";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
