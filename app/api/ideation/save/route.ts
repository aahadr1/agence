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
    const jsonMatch = rawOutput.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      throw new Error("Failed to parse AI concepts — no JSON array found");
    }

    // Sanitize control characters inside JSON string values
    const sanitized = jsonMatch[0]
      .replace(/[\x00-\x1F\x7F]/g, (ch: string) => {
        if (ch === "\n") return "\\n";
        if (ch === "\r") return "\\r";
        if (ch === "\t") return "\\t";
        return "";
      });

    let concepts;
    try {
      concepts = JSON.parse(sanitized);
    } catch {
      const aggressive = sanitized
        .replace(/,\s*([}\]])/g, "$1")
        .replace(/\\'/g, "'");
      concepts = JSON.parse(aggressive);
    }

    if (!Array.isArray(concepts) || concepts.length !== 3) {
      throw new Error(`Expected exactly 3 concepts, got ${Array.isArray(concepts) ? concepts.length : "non-array"}`);
    }

    // Insert variants with full design metadata
    const variants = [];
    for (const concept of concepts) {
      const { data: variant, error: insertError } = await supabase
        .from("variants")
        .insert({
          project_id: projectId,
          prompt: concept.image_prompt,
          theme_name: concept.theme_name,
          color_scheme: {
            ...concept.color_scheme,
            image_usage: concept.image_usage,
            typography: concept.typography,
            layout_concept: concept.layout_concept,
            design_rationale: concept.design_rationale,
          },
          selected: false,
        })
        .select()
        .single();

      if (insertError) throw insertError;
      variants.push(variant);
    }

    // Update project status
    await supabase
      .from("projects")
      .update({ status: "selection", updated_at: new Date().toISOString() })
      .eq("id", projectId);

    return NextResponse.json({ variants });
  } catch (error) {
    console.error("Ideation save error:", error);
    const msg = error instanceof Error ? error.message : "Failed to save concepts";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
