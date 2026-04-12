import {
  buildLocationLabels,
  buildDriveHome,
  buildDriveRequestContext,
  buildDriveTree,
  buildNodeDetail,
  getAccessibleNode,
  getBreadcrumbs,
  mapNodeSummaries,
  toDriveSpaceSummaries,
} from "@/lib/drive/server";
import type {
  DriveBootstrapPayload,
  DriveFolderPayload,
  DriveSearchResult,
  DriveSection,
} from "@/lib/drive/types";
import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

const NODE_SELECT =
  "id, org_id, space_id, parent_id, type, title, content, deleted_at, created_by, updated_at, created_at";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const section = (searchParams.get("section") as DriveSection | null) ?? "home";
  const folderId = searchParams.get("folderId");
  const docId = searchParams.get("docId");
  const query = searchParams.get("q")?.trim() ?? "";

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const ctx = await buildDriveRequestContext(supabase, user.id);
  const [tree, spaces] = await Promise.all([
    buildDriveTree(ctx),
    toDriveSpaceSummaries(ctx.spaces),
  ]);

  const payload: DriveBootstrapPayload = {
    spaces,
    tree,
    home: null,
    folderPayload: null,
    searchResults: [],
    selectedDoc: null,
  };

  if (docId) {
    const result = await getAccessibleNode(ctx, docId);
    if (result) {
      payload.selectedDoc = await buildNodeDetail(ctx, result.node);
    }
    return NextResponse.json(payload);
  }

  if (query) {
    const { data, error } = await supabase
      .from("drive_nodes")
      .select(NODE_SELECT)
      .eq("org_id", ctx.orgId)
      .is("deleted_at", null)
      .in("space_id", [ctx.spaces.personal.id, ctx.spaces.shared.id])
      .ilike("title", `%${query}%`)
      .order("updated_at", { ascending: false })
      .limit(25);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const summaries = await mapNodeSummaries(ctx, data ?? []);
    const locationLabels = await buildLocationLabels(supabase, data ?? []);
    payload.searchResults = summaries.map(
      (summary): DriveSearchResult => ({
        ...summary,
        location: locationLabels.get(summary.id) ?? "",
      })
    );

    return NextResponse.json(payload);
  }

  if (section === "home") {
    payload.home = await buildDriveHome(ctx, { includeTemplates: false });
    return NextResponse.json(payload);
  }

  if (section === "favorites") {
    const { data: stars } = await supabase
      .from("drive_stars")
      .select("node_id")
      .eq("user_id", user.id);

    const ids = (stars ?? []).map((row) => String(row.node_id));
    if (!ids.length) {
      payload.folderPayload = {
        folder: null,
        breadcrumbs: [],
        items: [],
      };
      return NextResponse.json(payload);
    }

    const { data, error } = await supabase
      .from("drive_nodes")
      .select(NODE_SELECT)
      .eq("org_id", ctx.orgId)
      .is("deleted_at", null)
      .in("id", ids)
      .order("updated_at", { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    payload.folderPayload = {
      folder: null,
      breadcrumbs: [],
      items: await mapNodeSummaries(ctx, data ?? []),
    };
    return NextResponse.json(payload);
  }

  if (section === "trash") {
    const { data, error } = await supabase
      .from("drive_nodes")
      .select(NODE_SELECT)
      .eq("org_id", ctx.orgId)
      .not("deleted_at", "is", null)
      .in("space_id", [ctx.spaces.personal.id, ctx.spaces.shared.id])
      .order("updated_at", { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    payload.folderPayload = {
      folder: null,
      breadcrumbs: [],
      items: await mapNodeSummaries(ctx, data ?? []),
    };
    return NextResponse.json(payload);
  }

  const targetSpaceId =
    section === "shared" ? ctx.spaces.shared.id : ctx.spaces.personal.id;

  let folderPayload: DriveFolderPayload = {
    folder: null,
    breadcrumbs: [],
    items: [],
  };

  if (folderId && folderId !== "root") {
    const folder = await getAccessibleNode(ctx, folderId);
    if (!folder || folder.node.type !== "folder") {
      return NextResponse.json({ error: "Folder not found" }, { status: 404 });
    }

    const itemsQuery = await supabase
      .from("drive_nodes")
      .select(NODE_SELECT)
      .eq("org_id", ctx.orgId)
      .eq("space_id", folder.node.space_id)
      .eq("parent_id", folderId)
      .is("deleted_at", null)
      .order("sort_order");

    if (itemsQuery.error) {
      return NextResponse.json({ error: itemsQuery.error.message }, { status: 500 });
    }

    folderPayload = {
      folder: await mapNodeSummaries(ctx, [folder.node]).then((rows) => rows[0] ?? null),
      breadcrumbs: await getBreadcrumbs(supabase, folder.node),
      items: await mapNodeSummaries(ctx, itemsQuery.data ?? []),
    };
  } else {
    const itemsQuery = await supabase
      .from("drive_nodes")
      .select(NODE_SELECT)
      .eq("org_id", ctx.orgId)
      .eq("space_id", targetSpaceId)
      .is("parent_id", null)
      .is("deleted_at", null)
      .order("sort_order");

    if (itemsQuery.error) {
      return NextResponse.json({ error: itemsQuery.error.message }, { status: 500 });
    }

    folderPayload = {
      folder: null,
      breadcrumbs: [],
      items: await mapNodeSummaries(ctx, itemsQuery.data ?? []),
    };
  }

  payload.folderPayload = folderPayload;
  return NextResponse.json(payload);
}
