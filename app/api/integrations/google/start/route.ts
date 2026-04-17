import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { buildAuthUrl } from "@/lib/integrations/google-oauth";
import crypto from "node:crypto";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const returnTo = req.nextUrl.searchParams.get("returnTo") || "/settings/connections";
  const orgId = req.nextUrl.searchParams.get("orgId");
  const state = crypto
    .createHmac("sha256", process.env.SUPABASE_SERVICE_ROLE_KEY || "dev")
    .update(
      JSON.stringify({
        u: user.id,
        o: orgId,
        r: returnTo,
        t: Date.now(),
      }),
    )
    .digest("hex");

  // Store the pending state server-side so we can verify on callback.
  // Using a signed cookie keeps it simple and stateless.
  const payload = Buffer.from(
    JSON.stringify({ u: user.id, o: orgId, r: returnTo, t: Date.now(), s: state }),
  ).toString("base64url");

  try {
    const url = buildAuthUrl(payload);
    const res = NextResponse.redirect(url);
    res.cookies.set("google_oauth_state", payload, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 600,
      path: "/",
    });
    return res;
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "oauth init failed" },
      { status: 500 },
    );
  }
}
