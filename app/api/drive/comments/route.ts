import {
  buildDriveRequestContext,
  fetchDriveComments,
  getAccessibleNode,
} from "@/lib/drive/server";
import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const nodeId = searchParams.get("nodeId");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!nodeId) {
    return NextResponse.json({ error: "nodeId required" }, { status: 400 });
  }

  const ctx = await buildDriveRequestContext(supabase, user.id);
  const node = await getAccessibleNode(ctx, nodeId);
  if (!node) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }

  return NextResponse.json({ threads: await fetchDriveComments(ctx, nodeId) });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { nodeId, body, parentCommentId } = (await request.json()) as {
    nodeId?: string;
    body?: string;
    parentCommentId?: string | null;
  };

  if (!nodeId || !body?.trim()) {
    return NextResponse.json(
      { error: "nodeId and body required" },
      { status: 400 }
    );
  }

  const ctx = await buildDriveRequestContext(supabase, user.id);
  const node = await getAccessibleNode(ctx, nodeId);
  if (!node) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }

  const payload: Record<string, unknown> = {
    node_id: nodeId,
    author_id: user.id,
    body: body.trim(),
  };
  if (parentCommentId) {
    payload.parent_comment_id = parentCommentId;
  }

  const { error } = await supabase.from("drive_comments").insert(payload);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ threads: await fetchDriveComments(ctx, nodeId) });
}
