import { randomUUID } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveOrgIdForUser } from "@/lib/org/resolve-org";
import {
  DEFAULT_DRIVE_TEMPLATES,
} from "@/lib/drive/default-templates";
import type {
  DriveBreadcrumb,
  DriveComment,
  DriveCommentThread,
  DriveFolderTreeNode,
  DriveHomePayload,
  DriveNodeDetail,
  DriveNodeSummary,
  DriveSpace,
  DriveTemplate,
  DriveVisibility,
} from "@/lib/drive/types";

type DriveNodeRow = {
  id: string;
  org_id: string;
  space_id: string;
  parent_id: string | null;
  type: string;
  title: string;
  content: Record<string, unknown> | null;
  visibility?: DriveVisibility | null;
  deleted_at: string | null;
  created_by: string | null;
  updated_at: string;
  created_at: string;
};

type DriveSpaceRow = {
  id: string;
  org_id: string;
  kind: "personal" | "shared";
  name: string;
  owner_user_id: string | null;
};

type DriveCommentRow = {
  id: string;
  node_id: string;
  parent_comment_id: string | null;
  author_id: string;
  body: string;
  resolved: boolean;
  resolved_at: string | null;
  created_at: string;
};

type DriveTemplateRow = {
  id: string;
  name: string;
  description: string | null;
  content: Record<string, unknown> | null;
};

type ProfileRow = {
  user_id: string;
  display_name: string | null;
};

export type DriveRequestContext = {
  admin: SupabaseClient;
  orgId: string;
  userId: string;
  spaces: {
    personal: DriveSpaceRow;
    shared: DriveSpaceRow;
  };
};

export async function buildDriveRequestContext(
  admin: SupabaseClient,
  userId: string
): Promise<DriveRequestContext> {
  const orgId = await resolveOrgIdForUser(admin, userId);
  const spaces = await ensureDriveSpaces(admin, orgId, userId);

  return {
    admin,
    orgId,
    userId,
    spaces,
  };
}

export async function ensureDriveSpaces(
  admin: SupabaseClient,
  orgId: string,
  userId: string
) {
  const personalQuery = await admin
    .from("drive_spaces")
    .select("id, org_id, kind, name, owner_user_id")
    .eq("org_id", orgId)
    .eq("kind", "personal")
    .eq("owner_user_id", userId)
    .maybeSingle();
  let personal = (personalQuery.data as DriveSpaceRow | null) ?? null;

  if (!personal) {
    const created = await admin
      .from("drive_spaces")
      .insert({
        org_id: orgId,
        kind: "personal",
        name: "My Drive",
        owner_user_id: userId,
      })
      .select("id, org_id, kind, name, owner_user_id")
      .single();
    personal = (created.data as DriveSpaceRow | null) ?? null;
  }

  const sharedQuery = await admin
    .from("drive_spaces")
    .select("id, org_id, kind, name, owner_user_id")
    .eq("org_id", orgId)
    .eq("kind", "shared")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  let shared = (sharedQuery.data as DriveSpaceRow | null) ?? null;

  if (!shared) {
    const created = await admin
      .from("drive_spaces")
      .insert({
        org_id: orgId,
        kind: "shared",
        name: "Shared",
      })
      .select("id, org_id, kind, name, owner_user_id")
      .single();
    shared = (created.data as DriveSpaceRow | null) ?? null;
  }

  if (!personal || !shared) {
    throw new Error("Unable to prepare Drive spaces");
  }

  return { personal, shared };
}

export function isAccessibleSpace(space: DriveSpaceRow, userId: string) {
  return space.kind === "shared" || space.owner_user_id === userId;
}

export function resolveNodeVisibility(spaceKind: "personal" | "shared") {
  return (spaceKind === "shared" ? "organization" : "private") as DriveVisibility;
}

export async function getAccessibleNode(
  ctx: DriveRequestContext,
  nodeId: string,
  options?: { includeDeleted?: boolean }
) {
  const query = await ctx.admin
    .from("drive_nodes")
    .select(
      "id, org_id, space_id, parent_id, type, title, content, deleted_at, created_by, updated_at, created_at"
    )
    .eq("id", nodeId)
    .eq("org_id", ctx.orgId)
    .maybeSingle();
  const node = (query.data as DriveNodeRow | null) ?? null;

  if (!node) return null;
  if (!options?.includeDeleted && node.deleted_at) return null;

  const space = await getSpaceById(ctx.admin, node.space_id);
  if (!space || !isAccessibleSpace(space, ctx.userId)) return null;

  return { node, space };
}

export async function getSpaceById(admin: SupabaseClient, spaceId: string) {
  const { data } = await admin
    .from("drive_spaces")
    .select("id, org_id, kind, name, owner_user_id")
    .eq("id", spaceId)
    .maybeSingle();
  return (data as DriveSpaceRow | null) ?? null;
}

export async function fetchProfiles(
  admin: SupabaseClient,
  userIds: Array<string | null | undefined>
) {
  const ids = [...new Set(userIds.filter(Boolean))] as string[];
  if (!ids.length) return new Map<string, string>();

  const { data } = await admin
    .from("profiles")
    .select("user_id, display_name")
    .in("user_id", ids)
    .returns<ProfileRow[]>();

  return new Map(
    (data ?? []).map((row) => [row.user_id, row.display_name?.trim() || "Member"])
  );
}

export async function fetchFavoriteSet(
  admin: SupabaseClient,
  userId: string,
  nodeIds: string[]
) {
  if (!nodeIds.length) return new Set<string>();
  const { data } = await admin
    .from("drive_stars")
    .select("node_id")
    .eq("user_id", userId)
    .in("node_id", nodeIds);

  return new Set((data ?? []).map((row) => String(row.node_id)));
}

export async function mapNodeSummaries(
  ctx: DriveRequestContext,
  nodes: DriveNodeRow[]
) {
  const names = await fetchProfiles(ctx.admin, nodes.map((node) => node.created_by));
  const favorites = await fetchFavoriteSet(
    ctx.admin,
    ctx.userId,
    nodes.map((node) => node.id)
  );

  return nodes.map((node) =>
    toNodeSummary(node, names, favorites, ctx.spaces.shared.id)
  );
}

export function toNodeSummary(
  node: DriveNodeRow,
  names: Map<string, string>,
  favorites: Set<string>,
  sharedSpaceId: string
): DriveNodeSummary {
  return {
    id: node.id,
    title: node.title,
    type: node.type === "folder" ? "folder" : "page",
    parentId: node.parent_id,
    spaceId: node.space_id,
    visibility:
      node.visibility ??
      (node.space_id === sharedSpaceId ? "organization" : "private"),
    isFavorite: favorites.has(node.id),
    updatedAt: node.updated_at,
    deletedAt: node.deleted_at,
    owner: {
      id: node.created_by,
      name: node.created_by ? names.get(node.created_by) ?? "Member" : "Team",
    },
  };
}

export async function buildNodeDetail(
  ctx: DriveRequestContext,
  node: DriveNodeRow
): Promise<DriveNodeDetail> {
  const names = await fetchProfiles(ctx.admin, [node.created_by]);
  const favorites = await fetchFavoriteSet(ctx.admin, ctx.userId, [node.id]);
  const breadcrumbs = await getBreadcrumbs(ctx.admin, node);

  const summary = toNodeSummary(node, names, favorites, ctx.spaces.shared.id);
  return {
    ...summary,
    content: node.content,
    breadcrumbs,
    lastEditedBy: summary.owner.name,
  };
}

export async function getBreadcrumbs(
  admin: SupabaseClient,
  node: Pick<DriveNodeRow, "parent_id" | "space_id">
) {
  const breadcrumbs: DriveBreadcrumb[] = [];
  let parentId = node.parent_id;

  while (parentId) {
    const query = await admin
      .from("drive_nodes")
      .select("id, title, parent_id, space_id")
      .eq("id", parentId)
      .maybeSingle();
    const parent = (query.data as {
      id: string;
      title: string;
      parent_id: string | null;
      space_id: string;
    } | null) ?? null;

    if (!parent) break;
    breadcrumbs.unshift({ id: parent.id, title: parent.title });
    parentId = parent.parent_id;
  }

  return breadcrumbs;
}

export async function buildLocationLabels(
  admin: SupabaseClient,
  nodes: Array<Pick<DriveNodeRow, "id" | "parent_id" | "space_id">>
) {
  const pending = new Set(
    nodes
      .map((node) => node.parent_id)
      .filter((value): value is string => Boolean(value))
  );
  const ancestors = new Map<
    string,
    {
      id: string;
      title: string;
      parent_id: string | null;
      space_id: string;
    }
  >();

  while (pending.size) {
    const batch = [...pending].filter((id) => !ancestors.has(id)).slice(0, 100);
    if (!batch.length) break;

    batch.forEach((id) => pending.delete(id));

    const { data } = await admin
      .from("drive_nodes")
      .select("id, title, parent_id, space_id")
      .in("id", batch);

    for (const row of (data ?? []) as Array<{
      id: string;
      title: string;
      parent_id: string | null;
      space_id: string;
    }>) {
      ancestors.set(row.id, row);
      if (row.parent_id && !ancestors.has(row.parent_id)) {
        pending.add(row.parent_id);
      }
    }
  }

  const labels = new Map<string, string>();
  for (const node of nodes) {
    const breadcrumbs: DriveBreadcrumb[] = [];
    const seen = new Set<string>();
    let parentId = node.parent_id;

    while (parentId && !seen.has(parentId)) {
      seen.add(parentId);
      const parent = ancestors.get(parentId);
      if (!parent) break;
      breadcrumbs.unshift({ id: parent.id, title: parent.title });
      parentId = parent.parent_id;
    }

    labels.set(node.id, buildLocationLabel(breadcrumbs));
  }

  return labels;
}

export function collectSubtree<T extends { id: string; parent_id: string | null }>(
  allNodes: T[],
  rootId: string
) {
  const byParent = new Map<string | null, T[]>();
  for (const node of allNodes) {
    const list = byParent.get(node.parent_id) ?? [];
    list.push(node);
    byParent.set(node.parent_id, list);
  }

  const results: T[] = [];
  const queue = [rootId];
  while (queue.length) {
    const current = queue.shift();
    if (!current) continue;
    const children = byParent.get(current) ?? [];
    for (const child of children) {
      results.push(child);
      queue.push(child.id);
    }
  }

  return results;
}

export async function fetchSpaceNodes(
  admin: SupabaseClient,
  spaceId: string,
  options?: { includeDeleted?: boolean }
) {
  let query = admin
    .from("drive_nodes")
    .select(
      "id, org_id, space_id, parent_id, type, title, content, deleted_at, created_by, updated_at, created_at"
    )
    .eq("space_id", spaceId);

  if (!options?.includeDeleted) {
    query = query.is("deleted_at", null);
  }

  const { data } = await query.order("updated_at", { ascending: false }).returns<DriveNodeRow[]>();
  return data ?? [];
}

export async function fetchDriveComments(
  ctx: DriveRequestContext,
  nodeId: string
): Promise<DriveCommentThread[]> {
  const queryWithReplies = await ctx.admin
    .from("drive_comments")
    .select(
      "id, node_id, parent_comment_id, author_id, body, resolved, resolved_at, created_at"
    )
    .eq("node_id", nodeId)
    .order("created_at", { ascending: true });

  let rows: DriveCommentRow[] = [];

  if (!queryWithReplies.error) {
    rows = (queryWithReplies.data ?? []) as DriveCommentRow[];
  } else {
    const legacyQuery = await ctx.admin
      .from("drive_comments")
      .select("id, node_id, author_id, body, resolved, created_at")
      .eq("node_id", nodeId)
      .order("created_at", { ascending: true });

    rows = ((legacyQuery.data ?? []) as Array<{
      id: string;
      node_id: string;
      author_id: string;
      body: string;
      resolved: boolean;
      created_at: string;
    }>).map((row) => ({
      ...row,
      parent_comment_id: null,
      resolved_at: null,
    }));
  }

  const names = await fetchProfiles(ctx.admin, rows.map((row) => row.author_id));
  const comments = rows.map((row) => toComment(row, names));
  const repliesByParent = new Map<string, DriveComment[]>();

  for (const comment of comments) {
    if (!comment.parentCommentId) continue;
    const replies = repliesByParent.get(comment.parentCommentId) ?? [];
    replies.push(comment);
    repliesByParent.set(comment.parentCommentId, replies);
  }

  return comments
    .filter((comment) => !comment.parentCommentId)
    .map((comment) => ({
      id: comment.id,
      body: comment.body,
      author: comment.author,
      createdAt: comment.createdAt,
      resolved: comment.resolved,
      resolvedAt: comment.resolvedAt,
      replies: repliesByParent.get(comment.id) ?? [],
    }));
}

function toComment(row: DriveCommentRow, names: Map<string, string>): DriveComment {
  return {
    id: row.id,
    nodeId: row.node_id,
    parentCommentId: row.parent_comment_id,
    author: {
      id: row.author_id,
      name: names.get(row.author_id) ?? "Member",
    },
    body: row.body,
    resolved: row.resolved,
    resolvedAt: row.resolved_at,
    createdAt: row.created_at,
  };
}

export async function fetchDriveTemplates(
  ctx: DriveRequestContext
): Promise<DriveTemplate[]> {
  const queryWithContent = await ctx.admin
    .from("drive_templates")
    .select("id, name, description, content, source_node_id")
    .eq("org_id", ctx.orgId)
    .order("created_at", { ascending: true });

  let savedTemplates: DriveTemplate[] = [];

  if (!queryWithContent.error) {
    const rows = (queryWithContent.data ?? []) as Array<
      DriveTemplateRow & { source_node_id?: string | null }
    >;
    savedTemplates = rows
      .filter((row) => row.content)
      .map((row) => ({
        id: row.id,
        kind: "saved" as const,
        name: row.name,
        description: row.description ?? "Saved template",
        content: row.content ?? { type: "doc", content: [{ type: "paragraph" }] },
      }));
  } else {
    const legacyQuery = await ctx.admin
      .from("drive_templates")
      .select("id, name, description, source_node_id")
      .eq("org_id", ctx.orgId)
      .order("created_at", { ascending: true });

    const rows = (legacyQuery.data ?? []) as Array<{
      id: string;
      name: string;
      description: string | null;
      source_node_id: string | null;
    }>;
    const sourceIds = rows
      .map((row) => row.source_node_id)
      .filter(Boolean) as string[];
    const nodeContentById = new Map<string, Record<string, unknown> | null>();

    if (sourceIds.length) {
      const { data: sourceNodes } = await ctx.admin
        .from("drive_nodes")
        .select("id, content")
        .in("id", sourceIds);

      for (const node of sourceNodes ?? []) {
        nodeContentById.set(String(node.id), (node.content as Record<string, unknown> | null) ?? null);
      }
    }

    savedTemplates = rows
      .map((row) => ({
        id: row.id,
        kind: "saved" as const,
        name: row.name,
        description: row.description ?? "Saved template",
        content:
          nodeContentById.get(row.source_node_id ?? "") ??
          { type: "doc", content: [{ type: "paragraph" }] },
      }))
      .filter(Boolean);
  }

  return [...DEFAULT_DRIVE_TEMPLATES, ...savedTemplates];
}

export async function buildDriveHome(
  ctx: DriveRequestContext,
  options?: { includeTemplates?: boolean }
): Promise<DriveHomePayload> {
  const allNodes = await ctx.admin
    .from("drive_nodes")
    .select(
      "id, org_id, space_id, parent_id, type, title, content, deleted_at, created_by, updated_at, created_at"
    )
    .eq("org_id", ctx.orgId)
    .is("deleted_at", null)
    .in("space_id", [ctx.spaces.personal.id, ctx.spaces.shared.id])
    .order("updated_at", { ascending: false })
    .returns<DriveNodeRow[]>();

  const nodes = (allNodes.data ?? []).filter(
    (node) => node.type === "page" || node.type === "folder"
  );
  const summaries = await mapNodeSummaries(ctx, nodes);
  const templates = options?.includeTemplates === false
    ? []
    : await fetchDriveTemplates(ctx);

  return {
    recent: summaries.slice(0, 8),
    favorites: summaries.filter((node) => node.isFavorite).slice(0, 6),
    drafts: summaries
      .filter(
        (node) =>
          node.type === "page" &&
          node.visibility === "private" &&
          /^untitled|sans titre/i.test(node.title)
      )
      .slice(0, 6),
    shared: summaries
      .filter((node) => node.visibility === "organization")
      .slice(0, 6),
    templates: templates.slice(0, 8),
  };
}

export async function buildDriveTree(ctx: DriveRequestContext): Promise<{
  personal: DriveFolderTreeNode[];
  shared: DriveFolderTreeNode[];
}> {
  const { data } = await ctx.admin
    .from("drive_nodes")
    .select("id, title, parent_id, space_id")
    .eq("org_id", ctx.orgId)
    .eq("type", "folder")
    .is("deleted_at", null)
    .in("space_id", [ctx.spaces.personal.id, ctx.spaces.shared.id]);

  const rows = (data ?? []) as Array<{
    id: string;
    title: string;
    parent_id: string | null;
    space_id: string;
  }>;

  const byParent = new Map<string | null, typeof rows>();
  for (const row of rows) {
    const list = byParent.get(row.parent_id) ?? [];
    list.push(row);
    byParent.set(row.parent_id, list);
  }

  function build(spaceId: string, parentId: string | null): DriveFolderTreeNode[] {
    return (byParent.get(parentId) ?? [])
      .filter((row) => row.space_id === spaceId)
      .sort((a, b) => a.title.localeCompare(b.title))
      .map((row) => ({
        id: row.id,
        title: row.title,
        spaceId: row.space_id,
        children: build(spaceId, row.id),
      }));
  }

  return {
    personal: build(ctx.spaces.personal.id, null),
    shared: build(ctx.spaces.shared.id, null),
  };
}

export async function duplicateNodeSubtree(
  ctx: DriveRequestContext,
  root: DriveNodeRow
) {
  const allNodes = await fetchSpaceNodes(ctx.admin, root.space_id, {
    includeDeleted: true,
  });
  const descendants = collectSubtree(allNodes, root.id);
  const tree = [root, ...descendants];
  const idMap = new Map<string, string>();

  for (const node of tree) {
    idMap.set(node.id, randomUUID());
  }

  const payload = tree.map((node, index) => ({
    id: idMap.get(node.id),
    org_id: node.org_id,
    space_id: node.space_id,
    parent_id:
      index === 0
        ? node.parent_id
        : node.parent_id
          ? idMap.get(node.parent_id) ?? node.parent_id
          : null,
    type: node.type,
    title: index === 0 ? `Copy of ${node.title}` : node.title,
    content: node.content,
    created_by: ctx.userId,
    updated_at: new Date().toISOString(),
  }));

  const { data } = await ctx.admin
    .from("drive_nodes")
    .insert(payload)
    .select(
      "id, org_id, space_id, parent_id, type, title, content, deleted_at, created_by, updated_at, created_at"
    )
    .returns<DriveNodeRow[]>();

  const created = data ?? [];
  return created.find((node) => node.id === idMap.get(root.id)) ?? null;
}

export async function syncSubtreeVisibilityAndSpace(
  ctx: DriveRequestContext,
  root: DriveNodeRow,
  targetVisibility: DriveVisibility
) {
  const targetSpaceId =
    targetVisibility === "organization"
      ? ctx.spaces.shared.id
      : ctx.spaces.personal.id;

  const allNodes = await fetchSpaceNodes(ctx.admin, root.space_id, {
    includeDeleted: true,
  });
  const descendants = collectSubtree(allNodes, root.id);
  const ids = [root.id, ...descendants.map((node) => node.id)];

  const now = new Date().toISOString();
  await ctx.admin
    .from("drive_nodes")
    .update({
      space_id: targetSpaceId,
      updated_at: now,
    })
    .in("id", ids);
}

export async function softDeleteSubtree(
  ctx: DriveRequestContext,
  root: DriveNodeRow
) {
  const allNodes = await fetchSpaceNodes(ctx.admin, root.space_id, {
    includeDeleted: true,
  });
  const descendants = collectSubtree(allNodes, root.id);
  const ids = [root.id, ...descendants.map((node) => node.id)];

  await ctx.admin
    .from("drive_nodes")
    .update({
      deleted_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .in("id", ids);
}

export async function restoreSubtree(
  ctx: DriveRequestContext,
  root: DriveNodeRow
) {
  const allNodes = await fetchSpaceNodes(ctx.admin, root.space_id, {
    includeDeleted: true,
  });
  const descendants = collectSubtree(allNodes, root.id);
  const ids = [root.id, ...descendants.map((node) => node.id)];

  await ctx.admin
    .from("drive_nodes")
    .update({
      deleted_at: null,
      updated_at: new Date().toISOString(),
    })
    .in("id", ids);
}

export function buildLocationLabel(breadcrumbs: DriveBreadcrumb[]) {
  if (!breadcrumbs.length) return "Root";
  return breadcrumbs.map((crumb) => crumb.title).join(" / ");
}

export function toDriveSpaceSummaries(spaces: {
  personal: DriveSpaceRow;
  shared: DriveSpaceRow;
}): DriveSpace[] {
  return [spaces.personal, spaces.shared].map((space) => ({
    id: space.id,
    kind: space.kind,
    name: space.name,
    owner_user_id: space.owner_user_id,
  }));
}
