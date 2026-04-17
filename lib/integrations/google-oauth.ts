/**
 * Google OAuth helpers for connecting a user's Gmail / Calendar to the agent.
 *
 * Flow:
 *  1. User clicks "Connect Google" → /api/integrations/google/start redirects
 *     to Google consent.
 *  2. Google redirects back to /api/integrations/google/callback with ?code.
 *  3. We exchange code for tokens, encrypt them, upsert into user_connections.
 *  4. Tools read the refresh token, mint an access token on demand.
 */

import { google } from "googleapis";
import { createClient } from "@supabase/supabase-js";
import { encryptSecret, decryptSecret } from "./crypto";

export const GOOGLE_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/calendar.events",
];

export function getGoogleOAuthClient(redirectUrl?: string) {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const redirect =
    redirectUrl ||
    process.env.GOOGLE_OAUTH_REDIRECT_URL ||
    `${process.env.NEXT_PUBLIC_APP_URL || ""}/api/integrations/google/callback`;
  if (!clientId || !clientSecret) {
    throw new Error(
      "GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET not set",
    );
  }
  return new google.auth.OAuth2(clientId, clientSecret, redirect);
}

export function buildAuthUrl(state: string, scopes: string[] = GOOGLE_SCOPES) {
  const oauth = getGoogleOAuthClient();
  return oauth.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: scopes,
    state,
    include_granted_scopes: true,
  });
}

export async function exchangeCode(code: string) {
  const oauth = getGoogleOAuthClient();
  const { tokens } = await oauth.getToken(code);
  return tokens;
}

function serviceDb() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}

export async function upsertGoogleConnection(params: {
  userId: string;
  orgId: string;
  accessToken: string;
  refreshToken?: string;
  expiresAt?: Date | null;
  scopes: string[];
  accountEmail: string;
}) {
  const db = serviceDb();
  const { error } = await db.from("user_connections").upsert(
    {
      user_id: params.userId,
      org_id: params.orgId,
      provider: "google",
      account_email: params.accountEmail,
      access_token: encryptSecret(params.accessToken),
      refresh_token: params.refreshToken
        ? encryptSecret(params.refreshToken)
        : null,
      expires_at: params.expiresAt ? params.expiresAt.toISOString() : null,
      scopes: params.scopes,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,provider,account_email" },
  );
  if (error) throw new Error(`connection upsert failed: ${error.message}`);
}

export async function getGoogleAuthForUser(userId: string) {
  const db = serviceDb();
  const { data, error } = await db
    .from("user_connections")
    .select("access_token, refresh_token, expires_at, scopes, account_email")
    .eq("user_id", userId)
    .eq("provider", "google")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;

  const oauth = getGoogleOAuthClient();
  const accessToken = decryptSecret(data.access_token);
  const refreshToken = data.refresh_token
    ? decryptSecret(data.refresh_token)
    : undefined;
  oauth.setCredentials({
    access_token: accessToken,
    refresh_token: refreshToken,
    expiry_date: data.expires_at ? new Date(data.expires_at).getTime() : undefined,
  });

  // Refresh if expired or about to
  const now = Date.now();
  const expiry = data.expires_at
    ? new Date(data.expires_at).getTime()
    : 0;
  if (refreshToken && (expiry === 0 || expiry - now < 60_000)) {
    try {
      const { credentials } = await oauth.refreshAccessToken();
      oauth.setCredentials(credentials);
      if (credentials.access_token) {
        await db
          .from("user_connections")
          .update({
            access_token: encryptSecret(credentials.access_token),
            expires_at: credentials.expiry_date
              ? new Date(credentials.expiry_date).toISOString()
              : null,
            updated_at: new Date().toISOString(),
          })
          .eq("user_id", userId)
          .eq("provider", "google")
          .eq("account_email", data.account_email);
      }
    } catch (e) {
      console.warn("[google-oauth] refresh failed", e);
    }
  }

  return { oauth, accountEmail: data.account_email, scopes: data.scopes };
}
