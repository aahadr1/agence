#!/usr/bin/env node
/**
 * Local Browser Worker
 *
 * Runs Playwright-heavy agent tools on the user's own machine while the web app
 * keeps LLM/API/CRM secrets server-side. The worker only needs a short-lived
 * pairing token generated from the Agent UI.
 *
 * Usage:
 *   AGENCE_APP_URL="https://app.example.com" \
 *   AGENCE_WORKER_TOKEN="agw_..." \
 *   npm run worker:local-browser
 */

import path from "path";
import { readFileSync } from "fs";

function loadEnvFile(filePath: string) {
  try {
    const content = readFileSync(filePath, "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "");
      if (!process.env[key]) process.env[key] = val;
    }
  } catch {
    /* optional */
  }
}

loadEnvFile(path.resolve(process.cwd(), ".env.local"));
loadEnvFile(path.resolve(process.cwd(), ".env"));

process.env.AGENT_LOCAL_WORKER = "1";
process.env.PLAYWRIGHT_SERIALIZE_JOBS ||= "1";
process.env.PLAYWRIGHT_REUSE_BROWSER ||= "1";
process.env.PLAYWRIGHT_JOB_SPACING_MS ||= "500";

import "../lib/agent/tools";
import { getTool } from "../lib/agent/tool-registry";
import type { AgentContext } from "../lib/agent/types";

const appUrl = (process.env.AGENCE_APP_URL || "").replace(/\/$/, "");
const token = process.env.AGENCE_WORKER_TOKEN || "";
const pollMs = Math.max(750, Number(process.env.AGENCE_WORKER_POLL_MS || 1500));
const heartbeatMs = Math.max(
  10_000,
  Number(process.env.AGENCE_WORKER_HEARTBEAT_MS || 20_000),
);

if (!appUrl || !token) {
  console.error(
    "[local-worker] AGENCE_APP_URL and AGENCE_WORKER_TOKEN are required.",
  );
  process.exit(1);
}

let shuttingDown = false;
process.on("SIGINT", () => {
  shuttingDown = true;
  console.log("\n[local-worker] arrêt demandé, sortie après le job en cours...");
});

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function api(pathname: string, init?: RequestInit) {
  return fetch(`${appUrl}${pathname}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
      ...(init?.headers || {}),
    },
  });
}

type WorkerJob = {
  id: string;
  tool_name: string;
  args: Record<string, unknown>;
  context?: Partial<AgentContext> & Record<string, unknown>;
};

async function nextJob(): Promise<WorkerJob | null> {
  const res = await api("/api/agent/local-worker/jobs/next");
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `poll failed (${res.status})`);
  return (json.job as WorkerJob | null) || null;
}

async function completeJob(jobId: string, body: { ok: boolean; result?: unknown; error?: string }) {
  const res = await api(`/api/agent/local-worker/jobs/${jobId}/complete`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new Error(json.error || `complete failed (${res.status})`);
  }
}

async function heartbeat(jobId?: string) {
  await api("/api/agent/local-worker/heartbeat", {
    method: "POST",
    body: JSON.stringify({ jobId }),
  }).catch(() => {});
}

function buildContext(job: WorkerJob): AgentContext {
  const c = job.context || {};
  return {
    missionId: String(c.missionId || c.sessionId || "local-worker"),
    sessionId: String(c.sessionId || "local-worker"),
    orgId: String(c.orgId || "local-worker"),
    userId: String(c.userId || "local-worker"),
    leadSearchId: typeof c.leadSearchId === "string" ? c.leadSearchId : undefined,
    scratchpad: new Map(),
    totalCostCents: 0,
    budgetCapCents: null,
    iterationCount: 0,
    maxIterations: 1,
    capabilityPacks: Array.isArray(c.capabilityPacks)
      ? c.capabilityPacks.map(String)
      : [],
    inputTokensSoFar: 0,
    leadGenDiscoveryMinResults:
      typeof c.leadGenDiscoveryMinResults === "number"
        ? c.leadGenDiscoveryMinResults
        : undefined,
  };
}

async function runJob(job: WorkerJob) {
  const registered = getTool(job.tool_name);
  if (!registered) throw new Error(`Unknown local tool: ${job.tool_name}`);
  return registered.execute(job.args || {}, buildContext(job));
}

async function main() {
  console.log(`
╔══════════════════════════════════════════════════════╗
║          LOCAL BROWSER WORKER                        ║
║  Playwright tourne sur cette machine                 ║
║  App : ${appUrl.slice(0, 42).padEnd(42)} ║
║  Mode: 1 Chromium partagé, jobs en série             ║
╚══════════════════════════════════════════════════════╝
`);

  while (!shuttingDown) {
    try {
      const job = await nextJob();
      if (!job) {
        await sleep(pollMs);
        continue;
      }

      const start = Date.now();
      console.log(`[local-worker] → ${job.tool_name} (${job.id})`);
      const heartbeatTimer = setInterval(() => {
        void heartbeat(job.id);
      }, heartbeatMs);
      heartbeatTimer.unref?.();
      try {
        await heartbeat(job.id);
        const result = await runJob(job);
        await completeJob(job.id, { ok: true, result });
        console.log(
          `[local-worker] ✓ ${job.tool_name} terminé en ${Date.now() - start}ms`,
        );
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        await completeJob(job.id, { ok: false, error: msg });
        console.error(`[local-worker] ✗ ${job.tool_name}: ${msg}`);
      } finally {
        clearInterval(heartbeatTimer);
        void heartbeat();
      }
    } catch (e) {
      console.error(
        "[local-worker] poll error:",
        e instanceof Error ? e.message : e,
      );
      await sleep(Math.max(3000, pollMs * 2));
    }
  }
}

main().catch((e) => {
  console.error("[local-worker] fatal:", e);
  process.exit(1);
});
