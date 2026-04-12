import { buildDriveRequestContext, getAccessibleNode } from "@/lib/drive/server";
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

  const { nodeId, favorite } = (await request.json()) as {
    nodeId?: string;
    favorite?: boolean;
  };

  if (!nodeId || typeof favorite !== "boolean") {
    return NextResponse.json(
      { error: "nodeId and favorite required" },
      { status: 400 }
    );
  }

  const ctx = await buildDriveRequestContext(supabase, user.id);
  const node = await getAccessibleNode(ctx, nodeId, { includeDeleted: true });

  if (!node) {
    return NextResponse.json({ error: "Node not found" }, { status: 404 });
  }

  if (favorite) {
    await supabase
      .from("drive_stars")
      .upsert({ user_id: user.id, node_id: nodeId }, { onConflict: "user_id,node_id" });
  } else {
    await supabase
      .from("drive_stars")
      .delete()
      .eq("user_id", user.id)
      .eq("node_id", nodeId);
  }

  return NextResponse.json({ success: true });
}
