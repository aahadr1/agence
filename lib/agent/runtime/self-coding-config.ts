/**
 * Self-coding policy — kill switch, path whitelist, rate limits.
 *
 * All self-coding tools MUST go through `isPathWritable()` before touching
 * any file, and MUST call `assertRateLimit()` before opening a PR.
 */

import { getAgentDb } from "../tools/_db";

/** Kill switch. Must be literally "true" in env to enable the whole pack. */
export function isSelfCodingEnabled(): boolean {
  return process.env.AGENT_SELF_CODING === "true";
}

/** Which branch to open PRs against. */
export function getBaseBranch(): string {
  return process.env.GITHUB_BASE_BRANCH || "main";
}

export function getRepoInfo(): { owner: string; repo: string } | null {
  const owner = process.env.GITHUB_OWNER;
  const repo = process.env.GITHUB_REPO;
  if (!owner || !repo) return null;
  return { owner, repo };
}

export function getGitHubToken(): string | null {
  return process.env.GITHUB_TOKEN || null;
}

/** Never-write paths. Returned as `false` from isPathWritable even if they
 *  happen to fall under a writable scope. */
const HARD_DENY: RegExp[] = [
  /^\.env(\..*)?$/,
  /^\.env\..*$/,
  /(^|\/)node_modules(\/|$)/,
  /(^|\/)\.git(\/|$)/,
  /(^|\/)\.next(\/|$)/,
  /(^|\/)\.vercel(\/|$)/,
  /(^|\/)secrets?(\/|$)/,
  // Security-critical paths the agent must never touch
  /^lib\/supabase\//,
  /^middleware\.ts$/,
  /^app\/api\/auth\//,
  /^app\/api\/agent\/(tick|cron|tools)\//,
  /^supabase\/migrations\//,
  /^vercel\.json$/,
  /^package(-lock)?\.json$/,
  /^next\.config\.(js|ts|mjs)$/,
  /^tsconfig(\..*)?\.json$/,
  /^eslint\.config\.(js|mjs|ts)$/,
];

/**
 * Writable paths (after HARD_DENY). Intentionally narrow so the agent
 * can extend itself without touching security-sensitive code.
 *
 * `lib/agent/tools/_generated/**` is a dedicated sandbox folder whose
 * files are auto-imported at startup via `_generated/index.ts`.
 */
const WRITABLE_PREFIXES: string[] = [
  "lib/agent/tools/_generated/",
  "docs/agent/",
];

export function isPathWritable(path: string): {
  ok: boolean;
  reason?: string;
} {
  const p = path.replace(/^\/+/, "").replace(/\\/g, "/");
  if (!p || p.includes("..")) {
    return { ok: false, reason: "path must be a clean relative path" };
  }
  for (const re of HARD_DENY) {
    if (re.test(p)) return { ok: false, reason: `path "${p}" is in the deny list` };
  }
  for (const prefix of WRITABLE_PREFIXES) {
    if (p === prefix.slice(0, -1)) return { ok: true };
    if (p.startsWith(prefix)) {
      // Enforce extension for TS files in _generated/
      if (prefix === "lib/agent/tools/_generated/" && p !== prefix + "index.ts") {
        if (!p.endsWith(".ts")) {
          return {
            ok: false,
            reason:
              "_generated/ only accepts .ts files (one tool file per module)",
          };
        }
        const basename = p.slice(prefix.length);
        if (!/^[a-z0-9][a-z0-9-]*\.ts$/.test(basename)) {
          return {
            ok: false,
            reason:
              "_generated/ tool files must be kebab-case (e.g. my-tool.ts)",
          };
        }
      }
      if (prefix === "docs/agent/" && !p.endsWith(".md")) {
        return { ok: false, reason: "docs/agent/ only accepts .md files" };
      }
      return { ok: true };
    }
  }
  return {
    ok: false,
    reason: `path "${p}" is outside the writable scope. Allowed prefixes: ${WRITABLE_PREFIXES.join(
      ", ",
    )}`,
  };
}

/** Any path is readable except the hard-deny list. */
export function isPathReadable(path: string): {
  ok: boolean;
  reason?: string;
} {
  const p = path.replace(/^\/+/, "").replace(/\\/g, "/");
  if (!p || p.includes("..")) {
    return { ok: false, reason: "path must be a clean relative path" };
  }
  for (const re of HARD_DENY) {
    if (re.test(p)) return { ok: false, reason: `path "${p}" is in the deny list` };
  }
  return { ok: true };
}

/** Max PRs the agent can open per org per rolling hour. */
export function getRateLimitPerHour(): number {
  const n = parseInt(process.env.AGENT_MAX_COMMITS_PER_HOUR || "10", 10);
  return Number.isFinite(n) && n > 0 ? n : 10;
}

/** Throws if the org has already opened too many PRs in the last hour. */
export async function assertRateLimit(orgId: string): Promise<void> {
  const db = getAgentDb();
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count, error } = await db
    .from("agent_code_commits")
    .select("id", { count: "exact", head: true })
    .eq("org_id", orgId)
    .gte("created_at", since);
  if (error) throw new Error(`rate-limit check failed: ${error.message}`);
  const max = getRateLimitPerHour();
  if ((count || 0) >= max) {
    throw new Error(
      `Self-coding rate limit reached: ${count}/${max} PRs in the last hour. Try again later.`,
    );
  }
}

/** Generate a safe branch slug from a free-form title. */
export function slugifyBranch(sessionId: string, title: string): string {
  const slug = title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  const short = sessionId.replace(/-/g, "").slice(0, 8);
  return `agent/${short}-${slug || "change"}`;
}
