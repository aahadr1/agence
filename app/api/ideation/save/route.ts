import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export const maxDuration = 15;

function robustJsonParse(input: string): unknown {
  try {
    return JSON.parse(input);
  } catch (e1) {
    console.log("[robustJsonParse] Raw parse failed:", (e1 as Error).message);
  }

  let sanitized = "";
  let inString = false;
  let escaped = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (escaped) { sanitized += ch; escaped = false; continue; }
    if (ch === "\\" && inString) { sanitized += ch; escaped = true; continue; }
    if (ch === '"') { inString = !inString; sanitized += ch; continue; }
    if (inString && ch.charCodeAt(0) < 0x20) {
      if (ch === "\n") { sanitized += "\\n"; continue; }
      if (ch === "\r") { sanitized += "\\r"; continue; }
      if (ch === "\t") { sanitized += "\\t"; continue; }
      continue;
    }
    sanitized += ch;
  }

  try {
    return JSON.parse(sanitized);
  } catch (e2) {
    console.log("[robustJsonParse] Sanitized parse failed:", (e2 as Error).message);
  }

  const aggressive = sanitized
    .replace(/,\s*([}\]])/g, "$1")
    .replace(/\\'/g, "'");
  return JSON.parse(aggressive);
}

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
    // Strip markdown fences and thinking tags
    const stripped = rawOutput
      .replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, "")
      .replace(/```(?:json)?\s*/g, "")
      .replace(/```\s*/g, "")
      .trim();

    const jsonMatch = stripped.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      console.error("[ideation/save] No JSON array found. First 500 chars:", stripped.slice(0, 500));
      throw new Error("Failed to parse AI concepts — no JSON array found");
    }

    console.log("[ideation/save] Extracted JSON, length:", jsonMatch[0].length, "first 100 chars:", jsonMatch[0].slice(0, 100));

    const concepts = robustJsonParse(jsonMatch[0]);

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
