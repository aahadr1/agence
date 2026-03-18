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

  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  const projectId = formData.get("projectId") as string | null;
  const type = formData.get("type") as "logo" | "photo" | null;

  if (!file || !projectId || !type) {
    return NextResponse.json(
      { error: "file, projectId, and type are required" },
      { status: 400 }
    );
  }

  // Verify user owns this project
  const { data: project } = await supabase
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .eq("user_id", user.id)
    .single();

  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  try {
    // Use service role client for storage (bypasses RLS on storage)
    const serviceClient = await createServiceClient();

    const ext = file.name.split(".").pop() || "jpg";
    const storagePath = `${projectId}/${type}_${Date.now()}.${ext}`;

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const { error: uploadError } = await serviceClient.storage
      .from("project-images")
      .upload(storagePath, buffer, {
        contentType: file.type,
        upsert: true,
      });

    if (uploadError) {
      console.error("Storage upload error:", uploadError);
      return NextResponse.json(
        { error: uploadError.message },
        { status: 500 }
      );
    }

    // Build our custom URL (proxied through our API)
    const origin =
      request.headers.get("origin") ||
      request.headers.get("host") ||
      "localhost:3000";
    const protocol = origin.startsWith("localhost") ? "http" : "https";
    const customUrl = `${protocol}://${origin}/api/images/${storagePath}`;

    // Also get the direct Supabase URL as fallback
    const {
      data: { publicUrl: supabaseUrl },
    } = serviceClient.storage
      .from("project-images")
      .getPublicUrl(storagePath);

    // Save reference in DB
    const { data: imageRecord, error: dbError } = await supabase
      .from("project_images")
      .insert({
        project_id: projectId,
        storage_path: storagePath,
        url: supabaseUrl,
        type,
      })
      .select()
      .single();

    if (dbError) {
      console.error("DB insert error:", dbError);
      return NextResponse.json({ error: dbError.message }, { status: 500 });
    }

    return NextResponse.json({
      id: imageRecord.id,
      url: supabaseUrl,
      customUrl,
      storagePath,
    });
  } catch (error) {
    console.error("Upload error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Upload failed" },
      { status: 500 }
    );
  }
}
