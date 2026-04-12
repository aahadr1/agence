import { createClient, createServiceClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const projectId = searchParams.get("projectId");

  if (!projectId) {
    return NextResponse.json({ error: "Missing projectId" }, { status: 400 });
  }

  const serviceClient = await createServiceClient();

  // Prefer a deployed build with files — don't let stale generating builds hide it
  const { data: deployedBuilds } = await serviceClient
    .from("website_builds")
    .select("*")
    .eq("project_id", projectId)
    .in("status", ["deployed", "deploying"])
    .order("created_at", { ascending: false })
    .limit(1);

  if (deployedBuilds && deployedBuilds.length > 0) {
    const b = deployedBuilds[0];
    const hasFiles = Array.isArray(b.files) && b.files.length > 0;
    if (hasFiles) {
      return NextResponse.json({ build: b });
    }
  }

  // Fallback: return latest build of any status
  const { data: builds } = await serviceClient
    .from("website_builds")
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(1);

  if (!builds || builds.length === 0) {
    return NextResponse.json({ build: null });
  }

  return NextResponse.json({ build: builds[0] });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { buildId, files } = await request.json();

  if (!buildId || !files || !Array.isArray(files)) {
    return NextResponse.json(
      { error: "Missing buildId or files" },
      { status: 400 }
    );
  }

  const serviceClient = await createServiceClient();

  const { data: build } = await serviceClient
    .from("website_builds")
    .select("project_id")
    .eq("id", buildId)
    .single();

  if (!build) {
    return NextResponse.json({ error: "Build not found" }, { status: 404 });
  }

  const { error: updateError } = await serviceClient
    .from("website_builds")
    .update({
      files,
      status: "deployed",
      updated_at: new Date().toISOString(),
    })
    .eq("id", buildId);

  if (updateError) {
    return NextResponse.json(
      { error: updateError.message },
      { status: 500 }
    );
  }

  await serviceClient
    .from("projects")
    .update({ status: "deployed", updated_at: new Date().toISOString() })
    .eq("id", build.project_id);

  return NextResponse.json({
    ok: true,
    previewUrl: `/api/sites/${buildId}/`,
  });
}

export async function DELETE(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const buildId = searchParams.get("buildId");

  if (!buildId) {
    return NextResponse.json({ error: "Missing buildId" }, { status: 400 });
  }

  const serviceClient = await createServiceClient();

  await serviceClient.from("website_builds").delete().eq("id", buildId);

  return NextResponse.json({ ok: true });
}
