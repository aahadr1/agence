import { ensureAgencyOrgContext } from "@/lib/org/ensure-agency-context";
import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function GET() {
  try {
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

    const { data: rows, error } = await ctx.admin
      .from("user_presence")
      .select("user_id, state")
      .eq("org_id", ctx.orgId);

    if (error) {
      console.error("[presence GET]", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const presence: Record<string, string> = {};
    for (const row of rows || []) {
      presence[row.user_id] = row.state;
    }

    return NextResponse.json({ presence });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unexpected error";
    console.error("[presence GET] unhandled", e);
    return NextResponse.json({ error: message }, { status: 500 });
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

  const ctx = await ensureAgencyOrgContext(user.id);
  if (!ctx.ok) {
    return NextResponse.json({ error: ctx.error }, { status: ctx.status });
  }

  let state = "online";
  let custom_status: string | null = null;
  try {
    const text = await request.text();
    if (text) {
      const parsed = JSON.parse(text) as {
        state?: string;
        custom_status?: string | null;
      };
      if (typeof parsed.state === "string") state = parsed.state;
      if (parsed.custom_status !== undefined) {
        custom_status =
          typeof parsed.custom_status === "string"
            ? parsed.custom_status
            : null;
      }
    }
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { error } = await ctx.admin.from("user_presence").upsert(
    {
      user_id: user.id,
      org_id: ctx.orgId,
      state: state || "online",
      custom_status,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" }
  );

  if (error) {
    console.error("[presence POST]", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
