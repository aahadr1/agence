/**
 * Self-coding tool pack — lets the agent extend the product by opening
 * GitHub PRs against its own repository.
 *
 * Architecture:
 *   - All filesystem ops go through the GitHub API (Octokit), because the
 *     runtime is a read-only Vercel serverless function. No local git, no
 *     writable FS.
 *   - Writes are confined to a narrow whitelist (see self-coding-config.ts):
 *       lib/agent/tools/_generated/**   (new agent-authored tools)
 *       docs/agent/**                   (agent-authored docs)
 *   - Every proposed change:
 *       1. Runs an in-process TypeScript AST sanity check.
 *       2. Requires an explicit human approval (high-risk).
 *       3. Creates an `agent/*` branch (never touches main directly).
 *       4. Opens a ready-for-review PR (not draft — the user wants to see it).
 *       5. Is logged in `agent_code_commits` for audit + rate-limit.
 *   - Rate limit: N PRs/hour per org (env AGENT_MAX_COMMITS_PER_HOUR, default 10).
 *   - Kill switch: env AGENT_SELF_CODING must be "true" for tools to register.
 */

import { registerTool } from "../tool-registry";
import { getAgentDb } from "./_db";
import {
  assertRateLimit,
  getBaseBranch,
  getRepoInfo,
  isPathReadable,
  isPathWritable,
  isSelfCodingEnabled,
  slugifyBranch,
} from "../runtime/self-coding-config";
import {
  commitFilesOnBranch,
  listDir,
  listPullRequestChecks,
  openPullRequest,
  readFile as ghReadFile,
  searchCode,
} from "../runtime/github";

// ---------------------------------------------------------------------------
// Register tools only if the pack is enabled AND the env vars are wired.
// ---------------------------------------------------------------------------

if (isSelfCodingEnabled()) {
  const repoInfo = getRepoInfo();
  if (!repoInfo) {
    console.warn(
      "[self-coding] AGENT_SELF_CODING=true but GITHUB_OWNER/GITHUB_REPO are missing — tools not registered.",
    );
  } else {
    register();
  }
}

function register() {
  // -------------------------------------------------------------------------
  // READ tools — safe, no approval needed
  // -------------------------------------------------------------------------

  registerTool(
    {
      name: "repo_read",
      description:
        "Read a file from the agent's own repository. Returns up to 60KB of content. Use this to inspect existing code before proposing a change. Path is repo-relative (e.g. `lib/agent/tools/learn.ts`).",
      parameters: {
        path: { type: "string", description: "Repo-relative path." },
        ref: {
          type: "string",
          description:
            "Optional git ref (branch, tag, commit). Defaults to the base branch.",
        },
      },
      required: ["path"],
      costEstimateCents: 0,
    },
    async (args) => {
      const path = String(args.path || "").trim();
      const check = isPathReadable(path);
      if (!check.ok) throw new Error(check.reason);
      const ref = args.ref ? String(args.ref) : undefined;
      const f = await ghReadFile(path, ref);
      const MAX = 60_000;
      const truncated = f.content.length > MAX;
      return {
        path,
        ref: f.ref,
        sha: f.sha,
        size: f.size,
        content: truncated ? f.content.slice(0, MAX) : f.content,
        truncated,
      };
    },
  );

  registerTool(
    {
      name: "repo_list",
      description:
        "List the contents of a directory in the agent's own repository. Returns name + type (file/dir) + size.",
      parameters: {
        path: {
          type: "string",
          description:
            "Repo-relative directory path. Use '' or '.' for repo root.",
        },
        ref: { type: "string", description: "Optional git ref." },
      },
      required: ["path"],
      costEstimateCents: 0,
    },
    async (args) => {
      const raw = String(args.path || "").trim();
      const path = raw === "." ? "" : raw;
      if (path) {
        const check = isPathReadable(path);
        if (!check.ok) throw new Error(check.reason);
      }
      const ref = args.ref ? String(args.ref) : undefined;
      const entries = await listDir(path, ref);
      return { path: path || "/", entries };
    },
  );

  registerTool(
    {
      name: "repo_search",
      description:
        "Search the agent's repository for code matching a query (uses GitHub code search). Returns matching file paths.",
      parameters: {
        query: {
          type: "string",
          description:
            "Search query (e.g. 'registerTool path:lib/agent/tools').",
        },
        limit: {
          type: "number",
          description: "Max results (default 15, max 30).",
        },
      },
      required: ["query"],
      costEstimateCents: 0,
    },
    async (args) => {
      const query = String(args.query || "").trim();
      if (!query) throw new Error("query is required");
      const limit = Math.min(30, Math.max(1, Number(args.limit) || 15));
      const results = await searchCode(query, limit);
      return { query, results };
    },
  );

  // -------------------------------------------------------------------------
  // LINT — cheap in-process TypeScript sanity check
  // -------------------------------------------------------------------------

  registerTool(
    {
      name: "repo_lint",
      description:
        "Parse a TypeScript/JavaScript source as an AST and return any syntactic errors. Use this on any file you're about to commit to catch typos before opening a PR.",
      parameters: {
        content: {
          type: "string",
          description: "The full source text to check.",
        },
        filename: {
          type: "string",
          description:
            "Original filename (used to pick TS vs TSX). Default: 'file.ts'.",
        },
      },
      required: ["content"],
      costEstimateCents: 0,
    },
    async (args) => {
      const source = String(args.content || "");
      const filename = String(args.filename || "file.ts");
      const diagnostics = await lintTypeScriptSource(source, filename);
      return {
        ok: diagnostics.length === 0,
        diagnostics,
      };
    },
  );

  registerTool(
    {
      name: "repo_check_pr",
      description:
        "Poll the GitHub Actions checks on a previously-opened agent PR. Returns 'pending', 'success', or 'failure' plus details. Use this to wait for CI before asking the user to merge.",
      parameters: {
        pr_number: {
          type: "number",
          description: "Pull request number returned by repo_propose_change.",
        },
      },
      required: ["pr_number"],
      costEstimateCents: 0,
    },
    async (args) => {
      const prNumber = Number(args.pr_number);
      if (!Number.isInteger(prNumber) || prNumber <= 0) {
        throw new Error("pr_number must be a positive integer");
      }
      const { state, runs } = await listPullRequestChecks(prNumber);
      return { pr_number: prNumber, state, runs };
    },
  );

  // -------------------------------------------------------------------------
  // WRITE / PROPOSE CHANGE — requires approval + lint + rate limit
  // -------------------------------------------------------------------------

  registerTool(
    {
      name: "repo_propose_change",
      description:
        "Propose a code change by opening a pull request. Requires explicit human approval before the PR is created. You can change MULTIPLE files in one atomic commit. Only paths under `lib/agent/tools/_generated/**` and `docs/agent/**` are writable. When adding a new tool file, remember to also update `lib/agent/tools/_generated/index.ts` to import it.",
      parameters: {
        files: {
          type: "array",
          items: { type: "object" },
          description:
            "Array of { path, content } objects. `content` is the FULL new file content (not a diff). Each path must be under the writable scope.",
        },
        pr_title: {
          type: "string",
          description:
            "Short, imperative PR title (e.g. 'Add pricing-calculator tool').",
        },
        pr_body: {
          type: "string",
          description:
            "PR description explaining the WHY, linked to the user request. Markdown allowed.",
        },
        commit_message: {
          type: "string",
          description:
            "Conventional-style commit message (default: same as pr_title).",
        },
      },
      required: ["files", "pr_title", "pr_body"],
      costEstimateCents: 0,
      destructive: true,
    },
    async (args, context) => {
      if (!isSelfCodingEnabled()) {
        throw new Error(
          "Self-coding is disabled. Set AGENT_SELF_CODING=true to enable it.",
        );
      }
      const repo = getRepoInfo();
      if (!repo) throw new Error("GITHUB_OWNER / GITHUB_REPO missing");

      // 1) Validate files
      const rawFiles = Array.isArray(args.files) ? args.files : [];
      if (rawFiles.length === 0) throw new Error("files is empty");
      if (rawFiles.length > 20) throw new Error("too many files (max 20)");

      const files: { path: string; content: string }[] = [];
      const touchedGenerated: string[] = [];
      for (const raw of rawFiles as unknown[]) {
        if (!raw || typeof raw !== "object") {
          throw new Error("Each file must be { path, content }");
        }
        const obj = raw as Record<string, unknown>;
        const path = String(obj.path || "").trim();
        const content = String(obj.content ?? "");
        if (!path) throw new Error("file.path is required");
        const check = isPathWritable(path);
        if (!check.ok) {
          throw new Error(`Blocked write to "${path}": ${check.reason}`);
        }
        if (content.length > 200_000) {
          throw new Error(
            `file "${path}" is too large (${content.length} > 200000 bytes)`,
          );
        }
        if (path.startsWith("lib/agent/tools/_generated/") && path.endsWith(".ts")) {
          touchedGenerated.push(path);
        }
        files.push({ path, content });
      }

      // 2) Lint every .ts / .tsx file in-process — fail fast
      const lintFailures: { path: string; diagnostics: LintDiagnostic[] }[] = [];
      for (const f of files) {
        if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(f.path)) {
          const diags = await lintTypeScriptSource(f.content, f.path);
          if (diags.length > 0) lintFailures.push({ path: f.path, diagnostics: diags });
        }
      }
      if (lintFailures.length > 0) {
        return {
          status: "lint_failed",
          message:
            "Fix the syntax errors below, then call repo_propose_change again.",
          lint_failures: lintFailures,
        };
      }

      // 3) Rate limit
      await assertRateLimit(context.orgId);

      // 4) Record a proposal row + awaiting approval. The PR is only created
      //    after the human hits "approve".
      const db = getAgentDb();
      const prTitle = String(args.pr_title).slice(0, 120);
      const prBody = String(args.pr_body || "").slice(0, 20_000);
      const commitMessage = String(args.commit_message || prTitle).slice(0, 500);
      const branch = slugifyBranch(context.sessionId, prTitle);

      const { data: commitRow, error: insertErr } = await db
        .from("agent_code_commits")
        .insert({
          org_id: context.orgId,
          user_id: context.userId,
          session_id: context.sessionId,
          branch_name: branch,
          pr_title: prTitle,
          pr_body: prBody,
          commit_message: commitMessage,
          files_changed: files.map((f) => ({ path: f.path, bytes: f.content.length })),
          status: "proposed",
          metadata: {
            touched_generated: touchedGenerated,
            base_branch: getBaseBranch(),
            // Full payload kept here so the approval route can reconstitute
            // the commit when the human clicks "Approve". We cap bytes per
            // file in validation above (200KB) so this stays reasonable.
            payload: { files },
          },
        })
        .select("id")
        .single();
      if (insertErr)
        throw new Error(`Failed to log proposal: ${insertErr.message}`);

      await db.from("agent_approvals").insert({
        session_id: context.sessionId,
        action: `repo_push_pr:${branch}`,
        details: buildApprovalDetails({
          owner: repo.owner,
          repoName: repo.repo,
          baseBranch: getBaseBranch(),
          branch,
          prTitle,
          prBody,
          files,
          commitId: commitRow.id,
        }),
        risk: "high",
        status: "awaiting",
        metadata: {
          kind: "repo_push_pr",
          commit_id: commitRow.id,
          branch,
          files: files.map((f) => f.path),
        },
      });

      return {
        status: "awaiting_approval",
        commit_id: commitRow.id,
        branch,
        files: files.map((f) => f.path),
        message:
          "PR proposal filed. Waiting for a human to approve it. Once approved, the branch + PR will be created automatically.",
      };
    },
  );

  // -------------------------------------------------------------------------
  // OBSERVABILITY — list past commits for this session/org
  // -------------------------------------------------------------------------

  registerTool(
    {
      name: "repo_list_my_prs",
      description:
        "List the self-coding PRs this agent (this org) has opened, with their status.",
      parameters: {
        limit: { type: "number", description: "Max results (default 10, max 50)." },
        status: {
          type: "string",
          description:
            "Optional filter: proposed | opened | merged | closed | failed.",
        },
      },
      required: [],
      costEstimateCents: 0,
    },
    async (args, context) => {
      const db = getAgentDb();
      let q = db
        .from("agent_code_commits")
        .select(
          "id, branch_name, pr_number, pr_url, pr_title, status, created_at, files_changed",
        )
        .eq("org_id", context.orgId)
        .order("created_at", { ascending: false })
        .limit(Math.min(50, Math.max(1, Number(args.limit) || 10)));
      if (args.status) q = q.eq("status", String(args.status));
      const { data } = await q;
      return { prs: data || [] };
    },
  );
}

// ---------------------------------------------------------------------------
// Approval payload helper
// ---------------------------------------------------------------------------

function buildApprovalDetails(opts: {
  owner: string;
  repoName: string;
  baseBranch: string;
  branch: string;
  prTitle: string;
  prBody: string;
  files: { path: string; content: string }[];
  commitId: string;
}): string {
  const preview = opts.files
    .slice(0, 5)
    .map((f) => {
      const firstLines = f.content.split("\n").slice(0, 3).join("\n");
      const ellipsis = f.content.split("\n").length > 3 ? "\n…" : "";
      return `• ${f.path} (${f.content.length} bytes)\n${firstLines}${ellipsis}`;
    })
    .join("\n\n");
  return [
    `Open a PR on ${opts.owner}/${opts.repoName}`,
    `Branch: ${opts.branch} → ${opts.baseBranch}`,
    `Title: ${opts.prTitle}`,
    "",
    "Files changed:",
    preview,
    opts.files.length > 5 ? `\n…and ${opts.files.length - 5} more` : "",
    "",
    "Description:",
    opts.prBody.slice(0, 2000),
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Apply an approved proposal — called from the approval route
// ---------------------------------------------------------------------------

export async function applyApprovedProposal(
  commitId: string,
): Promise<{
  pr_number: number;
  pr_url: string;
  branch: string;
  commit_sha: string;
}> {
  if (!isSelfCodingEnabled()) {
    throw new Error("AGENT_SELF_CODING is not enabled on this runtime.");
  }
  const db = getAgentDb();
  const { data: row, error } = await db
    .from("agent_code_commits")
    .select("*")
    .eq("id", commitId)
    .single();
  if (error || !row) throw new Error(`Proposal not found: ${commitId}`);
  if (row.status !== "proposed") {
    throw new Error(`Proposal is in status "${row.status}", cannot apply`);
  }

  // Re-hydrate file contents from the approval payload stored on the
  // awaiting approval row. We persist them there so the approver can review
  // them — same blob is used to actually create the commit.
  const { data: approvals } = await db
    .from("agent_approvals")
    .select("id, details, metadata, status")
    .eq("session_id", row.session_id)
    .eq("status", "approved")
    .contains("metadata", { commit_id: commitId })
    .order("created_at", { ascending: false })
    .limit(1);
  const approval = approvals?.[0];
  if (!approval) {
    throw new Error("Cannot find approved approval row for this proposal");
  }
  // metadata.files is just the list of paths — we re-read the full content
  // from the payload we stashed when the agent called repo_propose_change.
  // Ensure we have `files_with_content` saved when approving. Since we only
  // stored `files_changed` as { path, bytes }, we need a different strategy:
  // the agent MUST pass content in approvals metadata. We store it at propose
  // time below in `metadata.payload`.
  //
  // Backfill: if the row has no payload, ask the agent to retry.
  const payload = (row.metadata as { payload?: { files?: Array<{ path: string; content: string }> } })?.payload;
  if (!payload || !Array.isArray(payload.files)) {
    throw new Error(
      "Proposal has no stored file payload — please ask the agent to re-propose the change.",
    );
  }

  try {
    const commit = await commitFilesOnBranch({
      branch: row.branch_name,
      baseBranch: (row.metadata as { base_branch?: string })?.base_branch || getBaseBranch(),
      message: row.commit_message || row.pr_title || "agent: update",
      files: payload.files,
      authorName: "agence-agent",
      authorEmail: "agent@agence.local",
    });

    const pr = await openPullRequest({
      branch: row.branch_name,
      baseBranch: (row.metadata as { base_branch?: string })?.base_branch || getBaseBranch(),
      title: row.pr_title || "agent: update",
      body: row.pr_body || "",
      draft: false,
    });

    await db
      .from("agent_code_commits")
      .update({
        commit_sha: commit.commitSha,
        pr_number: pr.number,
        pr_url: pr.html_url,
        status: "opened",
        updated_at: new Date().toISOString(),
      })
      .eq("id", commitId);

    return {
      pr_number: pr.number,
      pr_url: pr.html_url,
      branch: row.branch_name,
      commit_sha: commit.commitSha,
    };
  } catch (e) {
    await db
      .from("agent_code_commits")
      .update({
        status: "failed",
        failure_reason: e instanceof Error ? e.message : String(e),
        updated_at: new Date().toISOString(),
      })
      .eq("id", commitId);
    throw e;
  }
}

// ---------------------------------------------------------------------------
// In-process AST lint (syntax check) — uses @babel/parser which ships in the
// prod bundle and understands TS/TSX natively via plugins.
// ---------------------------------------------------------------------------

interface LintDiagnostic {
  line: number;
  column: number;
  message: string;
  category: "error" | "warning";
}

async function lintTypeScriptSource(
  source: string,
  filename: string,
): Promise<LintDiagnostic[]> {
  let parse: typeof import("@babel/parser").parse;
  try {
    const mod = await import("@babel/parser");
    parse = mod.parse;
  } catch {
    return [];
  }
  const isTSX = /\.(tsx|jsx)$/.test(filename);
  const plugins: Array<string | [string, Record<string, unknown>]> = [
    "typescript",
    "decorators-legacy",
    "classProperties",
    "topLevelAwait",
  ];
  if (isTSX) plugins.push("jsx");
  try {
    parse(source, {
      sourceType: "module",
      allowReturnOutsideFunction: false,
      allowImportExportEverywhere: false,
      errorRecovery: false,
      // @ts-expect-error babel types don't expose this union perfectly
      plugins,
    });
    return [];
  } catch (e) {
    const err = e as {
      loc?: { line: number; column: number };
      message?: string;
    };
    return [
      {
        line: err.loc?.line || 1,
        column: (err.loc?.column ?? 0) + 1,
        message: err.message || "parse error",
        category: "error",
      },
    ];
  }
}
