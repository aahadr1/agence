import {
  buildDriveRequestContext,
  fetchDriveComments,
  getAccessibleNode,
} from "@/lib/drive/server";
import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { resolved } = (await request.json()) as {
    resolved?: boolean;
  };

  if (typeof resolved !== "boolean") {
    return NextResponse.json({ error: "resolved required" }, { status: 400 });
  }

  const ctx = await buildDriveRequestContext(supabase, user.id);
  const { data: comment } = await supabase
    .from("drive_comments")
    .select("id, node_id")
    .eq("id", id)
    .maybeSingle();

  if (!comment) {
    return NextResponse.json({ error: "Comment not found" }, { status: 404 });
  }
  const node = await getAccessibleNode(ctx, comment.node_id);
  if (!node) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }

  let updateResult = await supabase
    .from("drive_comments")
    .update({
      resolved,
      resolved_at: resolved ? new Date().toISOString() : null,
      resolved_by: resolved ? user.id : null,
    })
    .eq("id", id);

  if (updateResult.error) {
    updateResult = await supabase
      .from("drive_comments")
      .update({ resolved })
      .eq("id", id);
  }

  return NextResponse.json({ threads: await fetchDriveComments(ctx, comment.node_id) });
}
