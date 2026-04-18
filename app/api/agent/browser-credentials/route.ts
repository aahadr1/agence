import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { resolveOrgIdForUser } from "@/lib/org/resolve-org";
import { encryptSecret } from "@/lib/integrations/crypto";
import {
  listOrgBrowserCredentialsMetadata,
  parseHostname,
} from "@/lib/agent/org-browser-credentials";

export const runtime = "nodejs";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const orgId = await resolveOrgIdForUser(supabase, user.id);
  const credentials = await listOrgBrowserCredentialsMetadata(orgId);
  return NextResponse.json({ credentials });
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const orgId = await resolveOrgIdForUser(supabase, user.id);
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const label = String(body.label || "").trim().slice(0, 120);
  const hostnameRaw = String(body.hostname || "").trim();
  const kind = body.kind === "basic_auth" ? "basic_auth" : "cookies";
  const hostname = parseHostname(hostnameRaw);
  if (!label || !hostname) {
    return NextResponse.json(
      { error: "label et hostname (ou URL) sont requis" },
      { status: 400 },
    );
  }

  let plaintext: string;
  if (kind === "cookies") {
    const cookies = body.cookies;
    if (!Array.isArray(cookies)) {
      return NextResponse.json(
        {
          error:
            "Pour kind=cookies, envoyez un tableau JSON `cookies` (format Playwright Export)",
        },
        { status: 400 },
      );
    }
    plaintext = JSON.stringify({ cookies });
  } else {
    const username = String(body.username || "").trim();
    const password = String(body.password || "");
    if (!username) {
      return NextResponse.json(
        { error: "basic_auth requiert username et password" },
        { status: 400 },
      );
    }
    plaintext = JSON.stringify({ username, password });
  }

  let secret_ciphertext: string;
  try {
    secret_ciphertext = encryptSecret(plaintext);
  } catch (e) {
    return NextResponse.json(
      {
        error:
          e instanceof Error
            ? e.message
            : "Chiffrement impossible — vérifiez AGENT_ENCRYPTION_KEY en production",
      },
      { status: 500 },
    );
  }

  const { data, error } = await supabase
    .from("org_browser_credentials")
    .insert({
      org_id: orgId,
      created_by: user.id,
      label,
      hostname,
      kind,
      secret_ciphertext,
    })
    .select("id, org_id, label, hostname, kind, created_at, updated_at")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ credential: data });
}
