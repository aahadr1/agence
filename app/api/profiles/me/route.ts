import { ensureAgencyOrgContext } from "@/lib/org/ensure-agency-context";
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

  const ctx = await ensureAgencyOrgContext(user.id);
  if (!ctx.ok) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  }

  const { data: profile, error } = await ctx.admin
    .from("profiles")
    .select(
      "user_id, display_name, avatar_url, title, default_status_text, working_hours, notification_prefs"
    )
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    console.error("[profiles/me GET]", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ profile: profile ?? null });
}

export async function PATCH(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const ctx = await ensureAgencyOrgContext(user.id);
  if (!ctx.ok) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  }

  let body: {
    display_name?: string | null;
    title?: string | null;
    default_status_text?: string | null;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const patch: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  if (typeof body.display_name === "string") {
    const name = body.display_name.trim();
    if (name.length > 80) {
      return NextResponse.json(
        { error: "display_name too long" },
        { status: 400 }
      );
    }
    patch.display_name = name || null;
  }
  if (typeof body.title === "string") {
    patch.title = body.title.trim() || null;
  }
  if (typeof body.default_status_text === "string") {
    patch.default_status_text = body.default_status_text.trim() || null;
  }

  const { data: existing } = await ctx.admin
    .from("profiles")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (existing) {
    const { data: profile, error } = await ctx.admin
      .from("profiles")
      .update(patch)
      .eq("user_id", user.id)
      .select()
      .single();
    if (error) {
      console.error("[profiles/me PATCH] update", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ profile });
  }

  const displayName =
    typeof body.display_name === "string"
      ? body.display_name.trim() || "Member"
      : "Member";

  const { data: profile, error } = await ctx.admin
    .from("profiles")
    .insert({
      user_id: user.id,
      display_name: displayName,
      title:
        typeof body.title === "string" ? body.title.trim() || null : null,
      default_status_text:
        typeof body.default_status_text === "string"
          ? body.default_status_text.trim() || null
          : null,
    })
    .select()
    .single();

  if (error) {
    console.error("[profiles/me PATCH] insert", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ profile });
}
