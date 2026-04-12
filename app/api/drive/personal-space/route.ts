import { buildDriveRequestContext } from "@/lib/drive/server";
import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const context = await buildDriveRequestContext(supabase, user.id);
  return NextResponse.json({ spaceId: context.spaces.personal.id });
}
