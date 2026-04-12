import {
  buildDriveRequestContext,
  buildNodeDetail,
  getAccessibleNode,
  softDeleteSubtree,
} from "@/lib/drive/server";
import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function GET(
  _request: Request,
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

  const ctx = await buildDriveRequestContext(supabase, user.id);
  const result = await getAccessibleNode(ctx, id);

  if (!result) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ node: await buildNodeDetail(ctx, result.node) });
}

export async function PATCH(
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

  const ctx = await buildDriveRequestContext(supabase, user.id);
  const result = await getAccessibleNode(ctx, id, { includeDeleted: true });
  if (!result) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const patch = await request.json() as {
    title?: string;
    content?: unknown;
  };

  const updates: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (patch.title !== undefined) updates.title = patch.title;
  if (patch.content !== undefined) updates.content = patch.content;

  const { data: node, error } = await supabase
    .from("drive_nodes")
    .update(updates)
    .eq("id", id)
    .select(
      "id, org_id, space_id, parent_id, type, title, content, deleted_at, created_by, updated_at, created_at"
    )
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (patch.content !== undefined && node?.type === "page") {
    await supabase.from("drive_page_revisions").insert({
      node_id: id,
      content: patch.content,
      created_by: user.id,
    });
  }

  return NextResponse.json({ node: await buildNodeDetail(ctx, node) });
}

export async function DELETE(
  _request: Request,
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

  const ctx = await buildDriveRequestContext(supabase, user.id);
  const result = await getAccessibleNode(ctx, id, { includeDeleted: true });
  if (!result) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await softDeleteSubtree(ctx, result.node);
  return NextResponse.json({ success: true });
}
