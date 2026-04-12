import { createClient } from "@/lib/supabase/server";
import { resolveCrmOrgId } from "./service";
import { NextResponse } from "next/server";

function getBearerToken(request?: Request) {
  const value = request?.headers.get("authorization");
  if (!value) return null;
  const match = /^bearer\s+(.+)$/i.exec(value.trim());
  return match?.[1] ?? null;
}

export async function requireCrmContext(request?: Request) {
  const supabase = await createClient();
  const token = getBearerToken(request);
  const {
    data: { user },
  } = token
    ? await supabase.auth.getUser(token)
    : await supabase.auth.getUser();

  if (!user) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  const orgId = await resolveCrmOrgId(supabase, user.id);
  return {
    ok: true as const,
    supabase,
    userId: user.id,
    orgId,
  };
}
