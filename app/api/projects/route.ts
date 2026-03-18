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

  const { data: projects, error } = await supabase
    .from("projects")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ projects });
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    console.log("=== PROJECT CREATE REQUEST ===", JSON.stringify(body, null, 2));

    const { businessInfo, userColors, userInstructions } = body;

    if (!businessInfo) {
      return NextResponse.json(
        { error: "Business info is required" },
        { status: 400 }
      );
    }

    const insertData = {
      user_id: user.id,
      business_info: businessInfo,
      user_colors: userColors || [],
      user_instructions: userInstructions || "",
      status: "info_gathering" as const,
    };

    console.log("=== INSERTING ===", JSON.stringify(insertData, null, 2));

    const { data: project, error } = await supabase
      .from("projects")
      .insert(insertData)
      .select()
      .single();

    if (error) {
      console.error("=== SUPABASE ERROR ===", JSON.stringify(error, null, 2));
      return NextResponse.json(
        { error: error.message, code: error.code, details: error.details },
        { status: 500 }
      );
    }

    console.log("=== PROJECT CREATED ===", project.id);
    return NextResponse.json({ project });
  } catch (err) {
    console.error("=== UNEXPECTED ERROR ===", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
