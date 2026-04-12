import { buildDriveHome, buildDriveRequestContext } from "@/lib/drive/server";
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

  const ctx = await buildDriveRequestContext(supabase, user.id);
  const home = await buildDriveHome(ctx);
  return NextResponse.json(home);
}
