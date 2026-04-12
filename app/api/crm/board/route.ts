import { resolveOrgIdForUser } from "@/lib/org/resolve-org";
import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const orgId = await resolveOrgIdForUser(supabase, user.id);

  const { data: pipeline } = await supabase
    .from("crm_pipelines")
    .select("id")
    .eq("org_id", orgId)
    .eq("is_default", true)
    .maybeSingle();

  let pipelineId = pipeline?.id as string | undefined;
  if (!pipelineId) {
    const { data: anyPipe } = await supabase
      .from("crm_pipelines")
      .select("id")
      .eq("org_id", orgId)
      .limit(1)
      .maybeSingle();
    pipelineId = anyPipe?.id;
  }

  if (!pipelineId) {
    return NextResponse.json({ stages: [], deals: [], pipelineId: null });
  }

  const { data: stages, error: se } = await supabase
    .from("crm_stages")
    .select("*")
    .eq("pipeline_id", pipelineId)
    .order("sort_order", { ascending: true });

  if (se) {
    return NextResponse.json({ error: se.message }, { status: 500 });
  }

  const { data: deals, error: de } = await supabase
    .from("deals")
    .select("*")
    .eq("org_id", orgId)
    .eq("pipeline_id", pipelineId)
    .order("sort_order", { ascending: true });

  if (de) {
    return NextResponse.json({ error: de.message }, { status: 500 });
  }

  return NextResponse.json({
    pipelineId,
    stages: stages ?? [],
    deals: deals ?? [],
  });
}
