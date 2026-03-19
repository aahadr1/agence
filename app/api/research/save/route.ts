import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export const maxDuration = 15;

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { projectId, rawOutput } = await request.json();

  if (!projectId || !rawOutput) {
    return NextResponse.json(
      { error: "Missing projectId or rawOutput" },
      { status: 400 }
    );
  }

  try {
    const jsonMatch = rawOutput.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("Failed to parse AI response");
    }

    const businessInfo = JSON.parse(jsonMatch[0]);

    // Get user-chosen colors
    const { data: project } = await supabase
      .from("projects")
      .select("user_colors, user_instructions")
      .eq("id", projectId)
      .single();

    if (project?.user_colors && project.user_colors.length > 0) {
      businessInfo.colors = project.user_colors;
    }

    // Save found images to project_images table
    if (businessInfo.foundImages && businessInfo.foundImages.length > 0) {
      const inserts = businessInfo.foundImages.map(
        (img: {
          url: string;
          analysis: string;
          quality: string;
          suggestedPlacement: string;
        }) => ({
          project_id: projectId,
          storage_path: img.url,
          url: img.url,
          type: "photo" as const,
          analysis: {
            description: img.analysis,
            quality: (img.quality || "medium").toLowerCase().trim(),
            suggestedPlacement: img.suggestedPlacement || "gallery",
            dominantColors: [],
            mood: "",
            websiteRelevance: img.analysis,
          },
        })
      );

      await supabase.from("project_images").insert(inserts);

      businessInfo.photos = businessInfo.foundImages.map(
        (img: { url: string }) => img.url
      );
    }

    // Save research results to project
    await supabase
      .from("projects")
      .update({
        business_info: businessInfo,
        status: "info_gathering",
        updated_at: new Date().toISOString(),
      })
      .eq("id", projectId);

    return NextResponse.json({ businessInfo });
  } catch (error) {
    const msg =
      error instanceof Error ? error.message : "Save failed";
    console.error("Research save error:", msg, error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
