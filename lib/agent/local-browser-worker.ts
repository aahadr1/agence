import { createHash, randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentContext } from "./types";
import { getAgentDb } from "./tools/_db";
import { persistGoogleMapsSearchResult } from "./google-maps-persistence";

export const LOCAL_BROWSER_TOOLS = new Set([
  "google_maps_search",
  "google_search",
  "web_search",
  "web_fetch",
  "website_finder",
  "website_audit",
  "contact_page_scraper",
  "pages_jaunes_search",
  "dirigeant_research",
  "linkedin_profile_search",
  "facebook_page_lookup",
  "fb_ad_library_check",
  "browser_suite",
  "research_suite",
  "agentic_browse",
  "browser_navigate",
  "browser_extract",
  "browser_click",
]);

const WORKER_ONLINE_WINDOW_MS = 75_000;
const WORKER_BUSY_WINDOW_MS = Math.max(
  300_000,
  Number(process.env.AGENT_LOCAL_WORKER_BUSY_WINDOW_MS || 900_000),
);
const JOB_WAIT_TIMEOUT_MS = Math.max(
  15_000,
  Number(process.env.AGENT_LOCAL_BROWSER_JOB_TIMEOUT_MS || 240_000),
);
const JOB_POLL_MS = Math.max(
  500,
  Number(process.env.AGENT_LOCAL_BROWSER_JOB_POLL_MS || 1250),
);

export function generateLocalWorkerToken(): string {
  return `agw_${randomBytes(32).toString("base64url")}`;
}

export function hashLocalWorkerToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export interface LocalWorkerRow {
  id: string;
  org_id: string;
  user_id: string;
  label: string;
  status: string;
  last_seen_at: string | null;
  user_agent: string | null;
  revoked_at: string | null;
}

export async function authenticateLocalWorker(
  db: SupabaseClient,
  bearer: string | null,
): Promise<LocalWorkerRow | null> {
  const token = bearer?.replace(/^Bearer\s+/i, "").trim();
  if (!token || !token.startsWith("agw_")) return null;
  const tokenHash = hashLocalWorkerToken(token);
  const { data, error } = await db
    .from("agent_local_workers")
    .select("id, org_id, user_id, label, status, last_seen_at, user_agent, revoked_at")
    .eq("token_hash", tokenHash)
    .maybeSingle<LocalWorkerRow>();
  if (error || !data || data.revoked_at || data.status === "revoked") {
    return null;
  }
  return data;
}

export function isLocalBrowserDelegationEnabled(): boolean {
  if (process.env.AGENT_LOCAL_WORKER === "1") return false;
  const mode = (process.env.AGENT_BROWSER_EXECUTION_MODE || "local_preferred")
    .trim()
    .toLowerCase();
  return mode !== "server_only";
}

function isWorkerFresh(row: Pick<LocalWorkerRow, "last_seen_at" | "status">) {
  if (row.status === "revoked") return false;
  if (!row.last_seen_at) return false;
  return Date.now() - new Date(row.last_seen_at).getTime() < WORKER_ONLINE_WINDOW_MS;
}

async function workerHasRecentClaim(workerId: string): Promise<boolean> {
  const db = getAgentDb();
  const cutoff = new Date(Date.now() - WORKER_BUSY_WINDOW_MS).toISOString();
  const { data } = await db
    .from("agent_local_browser_jobs")
    .select("id")
    .eq("worker_id", workerId)
    .eq("status", "claimed")
    .gte("claimed_at", cutoff)
    .limit(1)
    .maybeSingle();
  return Boolean(data?.id);
}

export async function findFreshLocalWorker(
  orgId: string,
  userId: string,
): Promise<LocalWorkerRow | null> {
  const db = getAgentDb();
  const { data, error } = await db
    .from("agent_local_workers")
    .select("id, org_id, user_id, label, status, last_seen_at, user_agent, revoked_at")
    .eq("org_id", orgId)
    .eq("user_id", userId)
    .neq("status", "revoked")
    .order("last_seen_at", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle<LocalWorkerRow>();
  if (error || !data) return null;
  if (isWorkerFresh(data)) return data;
  if (await workerHasRecentClaim(data.id)) return data;
  return null;
}

export async function dispatchLocalBrowserTool(
  toolName: string,
  args: Record<string, unknown>,
  context: AgentContext,
): Promise<unknown> {
  const db = getAgentDb();
  const worker = await findFreshLocalWorker(context.orgId, context.userId);
  if (!worker) {
    throw new Error(
      "Aucun worker local connecté pour exécuter cet outil navigateur. " +
        "Ouvre le panneau « Worker local », lance la commande sur ta machine, puis réessaie. [LOCAL_WORKER_OFFLINE]",
    );
  }

  const { data: job, error } = await db
    .from("agent_local_browser_jobs")
    .insert({
      org_id: context.orgId,
      user_id: context.userId,
      worker_id: worker.id,
      session_id: context.sessionId,
      tool_name: toolName,
      args,
      context: {
        missionId: context.missionId,
        sessionId: context.sessionId,
        orgId: context.orgId,
        userId: context.userId,
        leadSearchId: context.leadSearchId ?? null,
        capabilityPacks: context.capabilityPacks,
        leadGenDiscoveryMinResults: context.leadGenDiscoveryMinResults ?? null,
      },
    })
    .select("id")
    .single<{ id: string }>();
  if (error || !job) {
    throw new Error(`Création du job navigateur local impossible: ${error?.message || "unknown"}`);
  }

  const deadline = Date.now() + JOB_WAIT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const { data: current } = await db
      .from("agent_local_browser_jobs")
      .select("status, result, error")
      .eq("id", job.id)
      .maybeSingle<{ status: string; result: unknown; error: string | null }>();
    if (current?.status === "completed") {
      if (toolName === "google_maps_search") {
        try {
          const rawTarget = Number(args.target_pool_size);
          const rawMax = Number(args.max_results);
          const maxResultsRequested = Math.min(
            60,
            Math.max(
              1,
              Number.isFinite(rawMax) && rawMax > 0 ? Math.floor(rawMax) : 30,
            ),
          );
          await persistGoogleMapsSearchResult({
            sessionId: context.sessionId,
            query: String(args.query || ""),
            maxResultsRequested,
            targetCount:
              Number.isFinite(rawTarget) && rawTarget > 0
                ? Math.floor(rawTarget)
                : null,
            payload:
              current.result && typeof current.result === "object"
                ? (current.result as { leads?: unknown[]; blocked?: boolean })
                : {},
            scratchpad: context.scratchpad,
          });
        } catch (e) {
          console.warn(
            "[local-browser] google_maps persistence failed:",
            e instanceof Error ? e.message : e,
          );
        }
      }
      return current.result;
    }
    if (current?.status === "failed") {
      throw new Error(current.error || "Le worker local a échoué sans message.");
    }
    await new Promise((resolve) => setTimeout(resolve, JOB_POLL_MS));
  }

  await db
    .from("agent_local_browser_jobs")
    .update({
      status: "expired",
      error: "Timeout côté serveur en attente du worker local.",
      completed_at: new Date().toISOString(),
    })
    .eq("id", job.id)
    .in("status", ["pending", "claimed"]);
  throw new Error(
    "Timeout en attente du worker local. La machine est peut-être en veille, le navigateur bloqué, ou la mission trop longue. [LOCAL_WORKER_TIMEOUT]",
  );
}
