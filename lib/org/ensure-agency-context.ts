import { createServiceClient } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { FALLBACK_ORG_ID } from "./resolve-org";

export type AgencyContextResult =
  | { ok: true; orgId: string; admin: SupabaseClient }
  | { ok: false; error: string; status: number };

async function ensureDefaultOrgRow(
  admin: SupabaseClient
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data: existing } = await admin
    .from("organizations")
    .select("id")
    .eq("id", FALLBACK_ORG_ID)
    .maybeSingle();

  if (existing) return { ok: true };

  const { error } = await admin.from("organizations").insert({
    id: FALLBACK_ORG_ID,
    name: "Agency",
    slug: "agency",
    settings: {},
  });

  if (!error) return { ok: true };

  const code = (error as { code?: string }).code;
  if (code === "23505") {
    const { data: again } = await admin
      .from("organizations")
      .select("id")
      .eq("id", FALLBACK_ORG_ID)
      .maybeSingle();
    if (again) return { ok: true };
  }

  console.error("[ensureDefaultOrgRow]", error);
  return { ok: false, error: error.message };
}

/**
 * Ensures the default agency org exists, the user is in organization_members,
 * and a minimal profile row exists. Returns a service-role client for follow-up
 * queries that would otherwise fail RLS (e.g. full org directory).
 */
export async function ensureAgencyOrgContext(
  userId: string
): Promise<AgencyContextResult> {
  let admin: SupabaseClient;
  try {
    admin = await createServiceClient();
  } catch {
    return {
      ok: false,
      error:
        "Server misconfiguration: SUPABASE_SERVICE_ROLE_KEY is required for org and messaging APIs.",
      status: 503,
    };
  }

  const orgStep = await ensureDefaultOrgRow(admin);
  if (!orgStep.ok) {
    return { ok: false, error: orgStep.error, status: 500 };
  }

  const { data: membership } = await admin
    .from("organization_members")
    .select("org_id")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();

  let orgId = membership?.org_id;

  if (!orgId) {
    const { error: memErr } = await admin.from("organization_members").insert({
      org_id: FALLBACK_ORG_ID,
      user_id: userId,
      role: "member",
    });

    if (memErr) {
      const code = (memErr as { code?: string }).code;
      if (code !== "23505") {
        console.error("[ensureAgencyOrgContext] organization_members", memErr);
        return { ok: false, error: memErr.message, status: 500 };
      }
    }

    const { data: again } = await admin
      .from("organization_members")
      .select("org_id")
      .eq("user_id", userId)
      .limit(1)
      .maybeSingle();

    orgId = again?.org_id ?? FALLBACK_ORG_ID;
  }

  const { data: hasProfile } = await admin
    .from("profiles")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();

  if (!hasProfile) {
    const { error: pErr } = await admin.from("profiles").insert({
      user_id: userId,
      display_name: "Member",
    });
    if (pErr) {
      const code = (pErr as { code?: string }).code;
      if (code !== "23505") {
        console.error("[ensureAgencyOrgContext] profiles", pErr);
        return { ok: false, error: pErr.message, status: 500 };
      }
    }
  }

  return { ok: true, orgId, admin };
}
