import { createClient, createServiceClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export const maxDuration = 30;

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { buildId } = await request.json();

  if (!buildId) {
    return NextResponse.json({ error: "Missing buildId" }, { status: 400 });
  }

  const vercelToken = process.env.VERCEL_TOKEN;
  if (!vercelToken) {
    return NextResponse.json(
      { error: "VERCEL_TOKEN not configured. Add it to your .env.local to enable deployment." },
      { status: 500 }
    );
  }

  const serviceClient = await createServiceClient();

  const { data: build, error: buildErr } = await serviceClient
    .from("website_builds")
    .select("*")
    .eq("id", buildId)
    .single();

  if (buildErr || !build) {
    return NextResponse.json(
      { error: `Build not found: ${buildErr?.message || "no data"}` },
      { status: 404 }
    );
  }

  const files = (build.files || []) as { path: string; content: string }[];

  if (files.length === 0) {
    return NextResponse.json(
      { error: "No files to deploy" },
      { status: 400 }
    );
  }

  const { data: projectData } = await serviceClient
    .from("projects")
    .select("business_info")
    .eq("id", build.project_id)
    .single();

  try {
    await serviceClient
      .from("website_builds")
      .update({
        status: "deploying",
        updated_at: new Date().toISOString(),
      })
      .eq("id", buildId);

    const vercelFiles = files.map((file) => ({
      file: file.path,
      data: Buffer.from(file.content, "utf-8").toString("base64"),
    }));

    const businessName =
      projectData?.business_info?.name || "website";
    const safeName = businessName
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "-")
      .replace(/-+/g, "-")
      .slice(0, 40);

    const teamId = process.env.VERCEL_TEAM_ID;
    const deployUrl = `https://api.vercel.com/v13/deployments${
      teamId ? `?teamId=${teamId}` : ""
    }`;

    const deployResponse = await fetch(deployUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${vercelToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: `site-${safeName}`,
        files: vercelFiles,
        projectSettings: {
          framework: null,
        },
      }),
    });

    if (!deployResponse.ok) {
      const errText = await deployResponse.text();
      console.error("Vercel deploy error:", errText);
      throw new Error(`Vercel API error: ${deployResponse.status}`);
    }

    const deployData = await deployResponse.json();

    await serviceClient
      .from("website_builds")
      .update({
        vercel_deployment_id: deployData.id,
        vercel_url: `https://${deployData.url}`,
        status: "deployed",
        updated_at: new Date().toISOString(),
      })
      .eq("id", buildId);

    return NextResponse.json({
      deploymentId: deployData.id,
      url: `https://${deployData.url}`,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Deploy failed";
    console.error("Deploy error:", msg, error);

    await serviceClient
      .from("website_builds")
      .update({
        status: "deployed",
        error: msg,
        updated_at: new Date().toISOString(),
      })
      .eq("id", buildId);

    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
