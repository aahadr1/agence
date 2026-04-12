import { buildDriveRequestContext } from "@/lib/drive/server";
import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

type FolderNode = {
  id: string;
  title: string;
  spaceId: string;
  children: FolderNode[];
};

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const ctx = await buildDriveRequestContext(supabase, user.id);
  const { data } = await supabase
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

  function build(spaceId: string, parentId: string | null): FolderNode[] {
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

  return NextResponse.json({
    personal: build(ctx.spaces.personal.id, null),
    shared: build(ctx.spaces.shared.id, null),
  });
}
