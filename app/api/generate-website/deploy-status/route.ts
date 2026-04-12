import { createClient, createServiceClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export const maxDuration = 10;

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const deploymentId = searchParams.get("deploymentId");
  const buildId = searchParams.get("buildId");

  if (!deploymentId) {
    return NextResponse.json(
      { error: "Missing deploymentId" },
      { status: 400 }
    );
  }

  const vercelToken = process.env.VERCEL_TOKEN;
  if (!vercelToken) {
    return NextResponse.json(
      { error: "VERCEL_TOKEN not configured" },
      { status: 500 }
    );
  }

  try {
    const teamId = process.env.VERCEL_TEAM_ID;
    const statusUrl = `https://api.vercel.com/v13/deployments/${deploymentId}${teamId ? `?teamId=${teamId}` : ""}`;

    const res = await fetch(statusUrl, {
      headers: { Authorization: `Bearer ${vercelToken}` },
    });

    if (!res.ok) {
      throw new Error(`Vercel API error: ${res.status}`);
    }

    const data = await res.json();

    // Update build status when deployment is ready or errored
    if (buildId && (data.readyState === "READY" || data.readyState === "ERROR")) {
      const sc = await createServiceClient();
      const newStatus = data.readyState === "READY" ? "deployed" : "failed";

      await sc
        .from("website_builds")
        .update({
          status: newStatus,
          error: data.readyState === "ERROR" ? "Vercel build failed" : null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", buildId);

      if (data.readyState === "READY") {
        const { data: build } = await sc
          .from("website_builds")
          .select("project_id")
          .eq("id", buildId)
          .single();

        if (build) {
          await sc
            .from("projects")
            .update({ status: "deployed", updated_at: new Date().toISOString() })
            .eq("id", build.project_id);
        }
      }
    }

    return NextResponse.json({
      status: data.readyState, // QUEUED, BUILDING, INITIALIZING, READY, ERROR, CANCELED
      url: data.url ? `https://${data.url}` : null,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Status check failed";
    console.error("Deploy status error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
