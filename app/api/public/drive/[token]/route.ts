import { createServiceClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const supabase = await createServiceClient();

  const { data: link } = await supabase
    .from("drive_share_links")
    .select("node_id, expires_at")
    .eq("token", token)
    .maybeSingle();

  if (!link) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (link.expires_at && new Date(link.expires_at) < new Date()) {
    return NextResponse.json({ error: "Expired" }, { status: 410 });
  }

  const { data: node } = await supabase
    .from("drive_nodes")
    .select("id, title, type, content")
    .eq("id", link.node_id)
    .is("deleted_at", null)
    .maybeSingle();

  if (!node) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ node });
}
