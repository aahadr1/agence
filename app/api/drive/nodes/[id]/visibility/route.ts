import {
  buildDriveRequestContext,
  buildNodeDetail,
  getAccessibleNode,
  syncSubtreeVisibilityAndSpace,
} from "@/lib/drive/server";
import type { DriveVisibility } from "@/lib/drive/types";
import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

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

  const { visibility } = (await request.json()) as {
    visibility?: DriveVisibility;
  };

  if (visibility !== "private" && visibility !== "organization") {
    return NextResponse.json({ error: "Invalid visibility" }, { status: 400 });
  }

  const ctx = await buildDriveRequestContext(supabase, user.id);
  const result = await getAccessibleNode(ctx, id, { includeDeleted: true });

  if (!result) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await syncSubtreeVisibilityAndSpace(ctx, result.node, visibility);
  const updated = await getAccessibleNode(ctx, id, { includeDeleted: true });
  if (!updated) {
    return NextResponse.json({ error: "Update failed" }, { status: 500 });
  }

  return NextResponse.json({ node: await buildNodeDetail(ctx, updated.node) });
}
