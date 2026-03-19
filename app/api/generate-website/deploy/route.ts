import { createClient } from "@/lib/supabase/server";
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

  const { buildId, pageFiles } = await request.json();

  if (!buildId) {
    return NextResponse.json({ error: "Missing buildId" }, { status: 400 });
  }

  const vercelToken = process.env.VERCEL_TOKEN;
  if (!vercelToken) {
    return NextResponse.json(
      { error: "VERCEL_TOKEN not configured" },
      { status: 500 }
    );
  }

  // Fetch build
  const { data: build } = await supabase
    .from("website_builds")
    .select("*, projects(business_info)")
    .eq("id", buildId)
    .single();

  if (!build) {
    return NextResponse.json({ error: "Build not found" }, { status: 404 });
  }

  try {
    // Merge foundation files with page files
    const foundationFiles: { path: string; content: string }[] = build.files || [];
    const parsedPageFiles: { path: string; content: string }[] =
      typeof pageFiles === "string" ? JSON.parse(pageFiles) : pageFiles || [];

    const allFiles = [...foundationFiles, ...parsedPageFiles];

    // Save all files to build
    await supabase
      .from("website_builds")
      .update({
        files: allFiles,
        status: "deploying",
        updated_at: new Date().toISOString(),
      })
      .eq("id", buildId);

    // Prepare files for Vercel API (base64 encoded)
    const vercelFiles = allFiles.map((file) => ({
      file: file.path,
      data: Buffer.from(file.content, "utf-8").toString("base64"),
    }));

    // Create Vercel deployment
    const businessName = build.projects?.business_info?.name || "website";
    const safeName = businessName
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "-")
      .replace(/-+/g, "-")
      .slice(0, 40);

    const teamId = process.env.VERCEL_TEAM_ID;
    const deployUrl = `https://api.vercel.com/v13/deployments${teamId ? `?teamId=${teamId}` : ""}`;

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
          framework: "nextjs",
          installCommand: "npm install",
          buildCommand: "next build",
        },
      }),
    });

    if (!deployResponse.ok) {
      const errText = await deployResponse.text();
      console.error("Vercel deploy error:", errText);
      throw new Error(`Vercel API error: ${deployResponse.status}`);
    }

    const deployData = await deployResponse.json();

    // Save deployment info
    await supabase
      .from("website_builds")
      .update({
        vercel_deployment_id: deployData.id,
        vercel_url: `https://${deployData.url}`,
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

    await supabase
      .from("website_builds")
      .update({ status: "failed", error: msg, updated_at: new Date().toISOString() })
      .eq("id", buildId);

    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
