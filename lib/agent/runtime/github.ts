/**
 * Thin wrapper around Octokit used by the self-coding tool pack.
 *
 * All mutating operations go through the Git Database API so we can batch
 * multiple file changes into a single atomic commit, without needing a
 * local filesystem or a git binary (Vercel serverless).
 */

import { Octokit } from "@octokit/rest";
import {
  getBaseBranch,
  getGitHubToken,
  getRepoInfo,
} from "./self-coding-config";

let _client: Octokit | null = null;

export function getOctokit(): Octokit {
  if (_client) return _client;
  const token = getGitHubToken();
  if (!token) {
    throw new Error(
      "GITHUB_TOKEN is not set. Set it in the Vercel env to enable self-coding.",
    );
  }
  _client = new Octokit({ auth: token, userAgent: "agence-self-coding/1.0" });
  return _client;
}

export function getRepo(): { owner: string; repo: string } {
  const info = getRepoInfo();
  if (!info) {
    throw new Error(
      "GITHUB_OWNER / GITHUB_REPO env vars are missing.",
    );
  }
  return info;
}

// ---------------------------------------------------------------------------
// READS
// ---------------------------------------------------------------------------

export async function readFile(
  path: string,
  ref?: string,
): Promise<{ content: string; sha: string; size: number; ref: string }> {
  const gh = getOctokit();
  const { owner, repo } = getRepo();
  const refName = ref || getBaseBranch();
  const res = await gh.repos.getContent({ owner, repo, path, ref: refName });
  const node = res.data;
  if (Array.isArray(node) || node.type !== "file") {
    throw new Error(`"${path}" is not a file`);
  }
  const content = Buffer.from(node.content || "", node.encoding as BufferEncoding)
    .toString("utf8");
  return {
    content,
    sha: node.sha,
    size: node.size,
    ref: refName,
  };
}

export async function listDir(
  path: string,
  ref?: string,
): Promise<
  Array<{ name: string; path: string; type: "file" | "dir"; size: number }>
> {
  const gh = getOctokit();
  const { owner, repo } = getRepo();
  const refName = ref || getBaseBranch();
  const res = await gh.repos.getContent({ owner, repo, path, ref: refName });
  if (!Array.isArray(res.data)) {
    throw new Error(`"${path}" is not a directory`);
  }
  return res.data.map((e) => ({
    name: e.name,
    path: e.path,
    type: e.type as "file" | "dir",
    size: e.size || 0,
  }));
}

export async function searchCode(
  query: string,
  limit = 15,
): Promise<Array<{ path: string; name: string; repository: string; snippet?: string }>> {
  const gh = getOctokit();
  const { owner, repo } = getRepo();
  const res = await gh.search.code({
    q: `${query} repo:${owner}/${repo}`,
    per_page: Math.min(limit, 30),
  });
  return res.data.items.map((i) => ({
    path: i.path,
    name: i.name,
    repository: `${owner}/${repo}`,
  }));
}

// ---------------------------------------------------------------------------
// MULTI-FILE COMMIT
// ---------------------------------------------------------------------------

export interface FileChange {
  path: string;
  content: string;
}

/**
 * Create a branch off `baseBranch` (default: main) if it doesn't exist,
 * commit ALL file changes as one atomic commit on that branch, and return
 * the new commit SHA + branch ref. No local git needed.
 */
export async function commitFilesOnBranch(params: {
  branch: string;
  baseBranch?: string;
  message: string;
  files: FileChange[];
  authorName?: string;
  authorEmail?: string;
}): Promise<{
  commitSha: string;
  treeSha: string;
  branchRef: string;
}> {
  const gh = getOctokit();
  const { owner, repo } = getRepo();
  const baseBranch = params.baseBranch || getBaseBranch();

  // 1) resolve base branch tip
  const baseRefRes = await gh.git.getRef({
    owner,
    repo,
    ref: `heads/${baseBranch}`,
  });
  const baseCommitSha = baseRefRes.data.object.sha;

  const baseCommit = await gh.git.getCommit({
    owner,
    repo,
    commit_sha: baseCommitSha,
  });
  const baseTreeSha = baseCommit.data.tree.sha;

  // 2) ensure our working branch exists
  const wantedRef = `heads/${params.branch}`;
  try {
    await gh.git.getRef({ owner, repo, ref: wantedRef });
  } catch {
    await gh.git.createRef({
      owner,
      repo,
      ref: `refs/heads/${params.branch}`,
      sha: baseCommitSha,
    });
  }

  // 3) upload blobs
  const blobs = await Promise.all(
    params.files.map(async (f) => {
      const res = await gh.git.createBlob({
        owner,
        repo,
        content: Buffer.from(f.content, "utf8").toString("base64"),
        encoding: "base64",
      });
      return { path: f.path, sha: res.data.sha };
    }),
  );

  // 4) build a new tree on top of the base tree
  const treeRes = await gh.git.createTree({
    owner,
    repo,
    base_tree: baseTreeSha,
    tree: blobs.map((b) => ({
      path: b.path,
      mode: "100644",
      type: "blob",
      sha: b.sha,
    })),
  });

  // 5) commit pointing at current head of our working branch (or base)
  const parentRef = await gh.git.getRef({ owner, repo, ref: wantedRef });
  const commitRes = await gh.git.createCommit({
    owner,
    repo,
    message: params.message,
    tree: treeRes.data.sha,
    parents: [parentRef.data.object.sha],
    author: params.authorName
      ? {
          name: params.authorName,
          email: params.authorEmail || "agent@agence.local",
          date: new Date().toISOString(),
        }
      : undefined,
  });

  // 6) move the branch to the new commit
  await gh.git.updateRef({
    owner,
    repo,
    ref: wantedRef,
    sha: commitRes.data.sha,
    force: false,
  });

  return {
    commitSha: commitRes.data.sha,
    treeSha: treeRes.data.sha,
    branchRef: params.branch,
  };
}

// ---------------------------------------------------------------------------
// PULL REQUESTS
// ---------------------------------------------------------------------------

export async function openPullRequest(params: {
  branch: string;
  baseBranch?: string;
  title: string;
  body: string;
  draft?: boolean;
}): Promise<{
  number: number;
  url: string;
  html_url: string;
}> {
  const gh = getOctokit();
  const { owner, repo } = getRepo();
  const res = await gh.pulls.create({
    owner,
    repo,
    head: params.branch,
    base: params.baseBranch || getBaseBranch(),
    title: params.title,
    body: params.body,
    draft: !!params.draft,
  });
  return {
    number: res.data.number,
    url: res.data.url,
    html_url: res.data.html_url,
  };
}

export async function listPullRequestChecks(prNumber: number): Promise<{
  state: "pending" | "success" | "failure" | "neutral" | "skipped" | "unknown";
  runs: Array<{ name: string; status: string; conclusion: string | null; url: string }>;
}> {
  const gh = getOctokit();
  const { owner, repo } = getRepo();
  const prRes = await gh.pulls.get({ owner, repo, pull_number: prNumber });
  const sha = prRes.data.head.sha;
  const runsRes = await gh.checks.listForRef({
    owner,
    repo,
    ref: sha,
    per_page: 20,
  });
  const runs = runsRes.data.check_runs.map((r) => ({
    name: r.name,
    status: r.status,
    conclusion: r.conclusion,
    url: r.html_url || "",
  }));
  const anyFail = runs.some((r) => r.conclusion === "failure");
  const anyPending = runs.some((r) => r.status !== "completed");
  const allSuccess = runs.length > 0 && runs.every(
    (r) => r.conclusion === "success" || r.conclusion === "neutral" || r.conclusion === "skipped",
  );
  let state:
    | "pending"
    | "success"
    | "failure"
    | "neutral"
    | "skipped"
    | "unknown" = "unknown";
  if (anyFail) state = "failure";
  else if (anyPending) state = "pending";
  else if (allSuccess) state = "success";
  return { state, runs };
}
