import type { SupabaseClient } from "@supabase/supabase-js";

/** Matches seeded default org in `010_organization_foundation.sql` */
export const FALLBACK_ORG_ID = "00000000-0000-4000-8000-000000000001";

async function ensureFallbackOrgExists(client: SupabaseClient) {
  const { data: existing } = await client
    .from("organizations")
    .select("id")
    .eq("id", FALLBACK_ORG_ID)
    .maybeSingle();

  if (existing) return;

  const { error } = await client.from("organizations").insert({
    id: FALLBACK_ORG_ID,
    name: "Agency",
    slug: "agency",
    settings: {},
  });

  if (!error) return;

  const code = (error as { code?: string }).code;
  if (code !== "23505") {
    console.error("[resolveOrgIdForUser] organizations insert:", error);
  }
}

/**
 * Resolves org id and **ensures** the user has a row in `organization_members`.
 * Without that row, `is_org_member()` is false and RLS blocks calendar, CRM, presence, etc.
 * Self-insert is allowed by RLS (`org_members_insert_self_or_admin`).
 */
export async function resolveOrgIdForUser(
  client: SupabaseClient,
  userId: string | null | undefined
): Promise<string> {
  if (!userId) return FALLBACK_ORG_ID;

  await ensureFallbackOrgExists(client);

  const { data: existing } = await client
    .from("organization_members")
    .select("org_id")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();

  if (existing?.org_id) return existing.org_id;

  const { error: insertErr } = await client.from("organization_members").insert({
    org_id: FALLBACK_ORG_ID,
    user_id: userId,
    role: "member",
  });

  if (insertErr) {
    const code = (insertErr as { code?: string }).code;
    if (code !== "23505" && code !== "23503") {
      console.error("[resolveOrgIdForUser] organization_members insert:", insertErr);
    }
  }

  const { data: row } = await client
    .from("organization_members")
    .select("org_id")
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();

  if (!row?.org_id) return FALLBACK_ORG_ID;

  const { data: hasProfile } = await client
    .from("profiles")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();

  if (!hasProfile) {
    await client.from("profiles").insert({
      user_id: userId,
      display_name: "Member",
    });
  }

  return row.org_id;
}
