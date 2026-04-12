import {
  buildDriveRequestContext,
  getAccessibleNode,
  restoreSubtree,
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

  const { nodeId } = (await request.json()) as {
    nodeId?: string;
  };

  if (!nodeId) {
    return NextResponse.json({ error: "nodeId required" }, { status: 400 });
  }

  const ctx = await buildDriveRequestContext(supabase, user.id);
  const current = await getAccessibleNode(ctx, nodeId, { includeDeleted: true });

  if (!current || !current.node.deleted_at) {
    return NextResponse.json({ error: "Node not found" }, { status: 404 });
  }

  await restoreSubtree(ctx, current.node);
  return NextResponse.json({ success: true });
}
