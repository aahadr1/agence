import {
  buildDriveRequestContext,
  getAccessibleNode,
  getBreadcrumbs,
  mapNodeSummaries,
  resolveNodeVisibility,
} from "@/lib/drive/server";
import type { DriveSection } from "@/lib/drive/types";
import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const spaceId = searchParams.get("spaceId");
  const parentId = searchParams.get("parentId");
  const section = (searchParams.get("section") as DriveSection | null) ?? "my-drive";
  const foldersOnly = searchParams.get("foldersOnly") === "1";
  const includeDeleted = searchParams.get("includeDeleted") === "1";

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const ctx = await buildDriveRequestContext(supabase, user.id);
  const targetSpaceId =
    section === "shared"
      ? ctx.spaces.shared.id
      : section === "my-drive"
        ? ctx.spaces.personal.id
        : spaceId;

  let folder = null;
  let breadcrumbs: { id: string; title: string }[] = [];
  if (parentId && parentId !== "root") {
    const parent = await getAccessibleNode(ctx, parentId, { includeDeleted });
    if (!parent || parent.node.type !== "folder") {
      return NextResponse.json({ error: "Folder not found" }, { status: 404 });
    }
    folder = parent.node;
    breadcrumbs = await getBreadcrumbs(supabase, parent.node);
  }

  if (section === "favorites") {
    const { data: starRows } = await supabase
      .from("drive_stars")
      .select("node_id")
      .eq("user_id", user.id);

    const ids = (starRows ?? []).map((row) => String(row.node_id));
    if (!ids.length) {
      return NextResponse.json({ folder: null, breadcrumbs: [], items: [] });
    }

    let query = supabase
      .from("drive_nodes")
      .select(
        "id, org_id, space_id, parent_id, type, title, content, deleted_at, created_by, updated_at, created_at"
      )
      .eq("org_id", ctx.orgId)
      .in("id", ids)
      .is("deleted_at", null);

    if (foldersOnly) query = query.eq("type", "folder");

    const { data } = await query.order("updated_at", { ascending: false });
    const items = await mapNodeSummaries(ctx, data ?? []);
    return NextResponse.json({ folder: null, breadcrumbs: [], items });
  }

  if (section === "trash") {
    let query = supabase
      .from("drive_nodes")
      .select(
        "id, org_id, space_id, parent_id, type, title, content, deleted_at, created_by, updated_at, created_at"
      )
      .eq("org_id", ctx.orgId)
      .not("deleted_at", "is", null)
      .in("space_id", [ctx.spaces.personal.id, ctx.spaces.shared.id]);

    if (foldersOnly) query = query.eq("type", "folder");

    const { data } = await query.order("updated_at", { ascending: false });
    const items = await mapNodeSummaries(ctx, data ?? []);
    return NextResponse.json({ folder: null, breadcrumbs: [], items });
  }

  if (!targetSpaceId) {
    return NextResponse.json({ error: "spaceId or section required" }, { status: 400 });
  }

  let q = supabase
    .from("drive_nodes")
    .select(
      "id, org_id, space_id, parent_id, type, title, content, deleted_at, created_by, updated_at, created_at"
    )
    .eq("space_id", targetSpaceId)
    .eq("org_id", ctx.orgId)
    .order("sort_order");

  if (includeDeleted) {
    q = q.not("deleted_at", "is", null);
  } else {
    q = q.is("deleted_at", null);
  }

  if (foldersOnly) {
    q = q.eq("type", "folder");
  }

  if (!parentId || parentId === "root") {
    q = q.is("parent_id", null);
  } else {
    q = q.eq("parent_id", parentId);
  }

  const { data, error } = await q;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const items = await mapNodeSummaries(ctx, data ?? []);
  return NextResponse.json({
    folder: folder
      ? {
          id: folder.id,
          title: folder.title,
          visibility:
            folder.visibility ??
            resolveNodeVisibility(folder.space_id === ctx.spaces.shared.id ? "shared" : "personal"),
        }
      : null,
    breadcrumbs,
    items,
  });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const ctx = await buildDriveRequestContext(supabase, user.id);
  const { space_id, parent_id, type, title, content } = await request.json() as {
    space_id: string;
    parent_id?: string | null;
    type: "folder" | "page" | "file";
    title?: string;
    content?: Record<string, unknown> | null;
  };

  if (!space_id || !type) {
    return NextResponse.json({ error: "space_id and type required" }, { status: 400 });
  }

  const { data: space } = await supabase
    .from("drive_spaces")
    .select("id, org_id, kind, owner_user_id")
    .eq("id", space_id)
    .maybeSingle();

  if (!space || space.org_id !== ctx.orgId) {
    return NextResponse.json({ error: "Space not found" }, { status: 404 });
  }
  if (space.kind === "personal" && space.owner_user_id !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const insertType = type === "file" ? "file" : type === "page" ? "page" : "folder";

  const payload = {
    org_id: space.org_id,
    space_id,
    parent_id: parent_id || null,
    type: insertType,
    title: title || (insertType === "page" ? "Untitled" : "New Folder"),
    content:
      insertType === "page"
        ? (content ?? {
            type: "doc",
            content: [{ type: "paragraph" }],
          })
        : null,
    created_by: user.id,
  };

  const { data: node, error } = await supabase
    .from("drive_nodes")
    .insert(payload)
    .select(
      "id, org_id, space_id, parent_id, type, title, content, deleted_at, created_by, updated_at, created_at"
    )
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ node: await mapNodeSummaries(ctx, [node]).then((rows) => rows[0]) });
}
