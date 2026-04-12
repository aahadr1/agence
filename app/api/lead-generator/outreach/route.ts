import { createClient, createServiceClient } from "@/lib/supabase/server";
import { generateOutreach } from "@/lib/lead-agent/outreach-templates";
import { NextResponse } from "next/server";
import type { Lead } from "@/lib/types";

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { leadId, language } = await request.json();
    if (!leadId) return NextResponse.json({ error: "leadId required" }, { status: 400 });

    const serviceClient = await createServiceClient();
    const { data: lead } = await serviceClient
      .from("leads")
      .select("*")
      .eq("id", leadId)
      .single();

    if (!lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });

    const template = await generateOutreach(lead as Lead, language || "fr");
    return NextResponse.json({ template });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error("Lead generator error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
