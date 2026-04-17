import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  exchangeCode,
  upsertGoogleConnection,
} from "@/lib/integrations/google-oauth";
import { google } from "googleapis";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const error = req.nextUrl.searchParams.get("error");

  if (error) {
    return NextResponse.redirect(
      new URL(`/settings/connections?google_error=${error}`, req.url),
    );
  }
  if (!code || !state) {
    return NextResponse.json({ error: "missing code/state" }, { status: 400 });
  }

  // Verify state cookie
  const cookieState = req.cookies.get("google_oauth_state")?.value;
  if (!cookieState || cookieState !== state) {
    return NextResponse.json({ error: "invalid state" }, { status: 400 });
  }

  let parsed: { u: string; o: string | null; r: string } | null = null;
  try {
    parsed = JSON.parse(Buffer.from(state, "base64url").toString("utf8"));
  } catch {
    return NextResponse.json({ error: "bad state" }, { status: 400 });
  }
  if (!parsed) {
    return NextResponse.json({ error: "bad state" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || user.id !== parsed.u) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const tokens = await exchangeCode(code);
    if (!tokens.access_token) throw new Error("no access_token");

    // Fetch the user's email to key the connection
    const oauth2 = new google.auth.OAuth2();
    oauth2.setCredentials(tokens);
    const me = await google.oauth2({ version: "v2", auth: oauth2 }).userinfo.get();
    const accountEmail = me.data.email || "unknown";

    // Resolve orgId: prefer state, else fallback to user's primary org
    let orgId = parsed.o;
    if (!orgId) {
      const { data: membership } = await supabase
        .from("organization_members")
        .select("organization_id")
        .eq("user_id", user.id)
        .limit(1)
        .maybeSingle();
      orgId = membership?.organization_id || null;
    }
    if (!orgId) {
      return NextResponse.json(
        { error: "no organization found for user" },
        { status: 400 },
      );
    }

    await upsertGoogleConnection({
      userId: user.id,
      orgId,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token || undefined,
      expiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
      scopes: (tokens.scope || "").split(/\s+/).filter(Boolean),
      accountEmail,
    });

    const res = NextResponse.redirect(
      new URL(`${parsed.r}?google_connected=1`, req.url),
    );
    res.cookies.set("google_oauth_state", "", { maxAge: 0, path: "/" });
    return res;
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "exchange failed" },
      { status: 500 },
    );
  }
}
