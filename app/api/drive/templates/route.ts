import { DEFAULT_DRIVE_TEMPLATES } from "@/lib/drive/default-templates";
import {
  buildDriveRequestContext,
  fetchDriveTemplates,
  getAccessibleNode,
  mapNodeSummaries,
} from "@/lib/drive/server";
import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const ctx = await buildDriveRequestContext(supabase, user.id);
    return NextResponse.json({ templates: await fetchDriveTemplates(ctx) });
  } catch (error) {
    console.error("[drive/templates] falling back to built-in templates", error);
    return NextResponse.json({ templates: DEFAULT_DRIVE_TEMPLATES });
  }
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as
    | {
        templateId: string;
        title?: string;
        spaceId?: string;
        parentId?: string | null;
      }
    | {
        sourceNodeId: string;
        name: string;
        description?: string;
      };

  const ctx = await buildDriveRequestContext(supabase, user.id);

  if ("sourceNodeId" in body) {
    const source = await getAccessibleNode(ctx, body.sourceNodeId);
    if (!source || source.node.type !== "page") {
      return NextResponse.json({ error: "Source document not found" }, { status: 404 });
    }

    let insertResult = await supabase
      .from("drive_templates")
      .insert({
        org_id: ctx.orgId,
        name: body.name.trim() || source.node.title,
        description: body.description?.trim() || "Saved template",
        source_node_id: source.node.id,
        content: source.node.content,
      })
      .select("id, name")
      .single();

    if (insertResult.error) {
      insertResult = await supabase
        .from("drive_templates")
        .insert({
          org_id: ctx.orgId,
          name: body.name.trim() || source.node.title,
          description: body.description?.trim() || "Saved template",
          source_node_id: source.node.id,
        })
        .select("id, name")
        .single();
    }

    const { data, error } = insertResult;

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ template: data });
  }

  const templates = await fetchDriveTemplates(ctx);
  const template = templates.find((item) => item.id === body.templateId);
  if (!template) {
    return NextResponse.json({ error: "Template not found" }, { status: 404 });
  }

  const targetSpaceId = body.spaceId ?? ctx.spaces.personal.id;
  const { data: space } = await supabase
    .from("drive_spaces")
    .select("id, org_id, kind, owner_user_id")
    .eq("id", targetSpaceId)
    .maybeSingle();

  if (!space || space.org_id !== ctx.orgId) {
    return NextResponse.json({ error: "Space not found" }, { status: 404 });
  }

  const { data: node, error } = await supabase
    .from("drive_nodes")
    .insert({
      org_id: ctx.orgId,
      space_id: targetSpaceId,
      parent_id: body.parentId ?? null,
      type: "page",
      title: body.title?.trim() || template.name,
      content: template.content,
      created_by: user.id,
    })
    .select(
      "id, org_id, space_id, parent_id, type, title, content, deleted_at, created_by, updated_at, created_at"
    )
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    node: await mapNodeSummaries(ctx, [node]).then((rows) => rows[0]),
  });
}
