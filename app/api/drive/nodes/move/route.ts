import {
  buildDriveRequestContext,
  collectSubtree,
  fetchSpaceNodes,
  getAccessibleNode,
} from "@/lib/drive/server";
import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { nodeId, parentId, targetSpaceId } = (await request.json()) as {
    nodeId?: string;
    parentId?: string | null;
    targetSpaceId?: string | null;
  };

  if (!nodeId) {
    return NextResponse.json({ error: "nodeId required" }, { status: 400 });
  }

  const ctx = await buildDriveRequestContext(supabase, user.id);
  const current = await getAccessibleNode(ctx, nodeId, { includeDeleted: true });

  if (!current) {
    return NextResponse.json({ error: "Node not found" }, { status: 404 });
  }

  let targetParent = null;
  if (parentId) {
    targetParent = await getAccessibleNode(ctx, parentId, { includeDeleted: true });
    if (!targetParent || targetParent.node.type !== "folder") {
      return NextResponse.json({ error: "Target folder not found" }, { status: 404 });
    }

    const allNodes = await fetchSpaceNodes(supabase, current.node.space_id, {
      includeDeleted: true,
    });
    const descendants = collectSubtree(allNodes, current.node.id).map((node) => node.id);
    if (descendants.includes(targetParent.node.id)) {
      return NextResponse.json(
        { error: "Cannot move a folder into its own descendant" },
        { status: 400 }
      );
    }
  }

  const allNodes = await fetchSpaceNodes(supabase, current.node.space_id, {
    includeDeleted: true,
  });
  const descendants = collectSubtree(allNodes, current.node.id).map((node) => node.id);
  const nextSpaceId =
    targetParent?.node.space_id ?? targetSpaceId ?? current.node.space_id;
  const now = new Date().toISOString();

  await supabase
    .from("drive_nodes")
    .update({
      space_id: nextSpaceId,
      updated_at: now,
    })
    .in("id", [current.node.id, ...descendants]);

  await supabase
    .from("drive_nodes")
    .update({
      parent_id: parentId ?? null,
      updated_at: now,
    })
    .eq("id", current.node.id);

  return NextResponse.json({ success: true });
}
