# Agent self-coding pack

Let the agent extend the product by opening GitHub pull requests against its
own repository. Built for Vercel-serverless runtime, so everything goes
through the GitHub API — no local git, no writable FS, no `simple-git`.

## How it works

1. The agent uses `repo_read` / `repo_list` / `repo_search` to study the
   codebase.
2. It drafts one or more files (new tool file + updated `_generated/index.ts`).
3. It calls `repo_lint` on each file to catch syntax errors in-process
   (uses `@babel/parser`).
4. It calls `repo_propose_change({ files, pr_title, pr_body })`.
   - The server runs AST lint again, rate-limits the org, persists the full
     payload to `agent_code_commits` and files a high-risk approval row.
   - **No branch and no PR are created yet.**
5. The human reviews the proposal in the approval UI and approves/rejects.
6. On approve, `applyApprovedProposal()` runs:
   - Creates the `agent/<sess>-<slug>` branch from the base branch.
   - Uploads blobs + tree + commit via the Git Database API.
   - Opens a **ready-for-review** PR (not draft).
   - Updates the commit row with `pr_number`, `pr_url`, `commit_sha`, sets
     status to `opened`.
7. The agent is notified in the next tick that the PR is open. It can poll
   GitHub Actions via `repo_check_pr({ pr_number })`.
8. The human merges the PR manually. Vercel redeploys. The new tool is
   registered via `_generated/index.ts` on the next cold start.

## Kill switch

Set `AGENT_SELF_CODING=true` in the Vercel env. Anything else (unset, `0`,
`false`, `'1'`, etc.) leaves the pack dormant — the `repo_*` tools are not
registered and the agent cannot touch the repo.

## Required env

| var | required | default | notes |
|-----|----------|---------|-------|
| `AGENT_SELF_CODING` | yes | `false` | Kill switch. Must be `"true"`. |
| `GITHUB_TOKEN` | yes | — | Fine-grained PAT scoped to this repo only. |
| `GITHUB_OWNER` | yes | — | GitHub user or org. |
| `GITHUB_REPO` | yes | — | Repo name. |
| `GITHUB_BASE_BRANCH` | no | `main` | Target branch for PRs. |
| `AGENT_MAX_COMMITS_PER_HOUR` | no | `10` | Rate limit per org. |

### GitHub PAT scopes

Use a **fine-grained PAT** limited to the target repo with:

- `Contents: Read and write`
- `Pull requests: Read and write`
- `Checks: Read-only`

Nothing else. Do **not** use a classic PAT unless you must.

## Guardrails (code-enforced)

- **Writable paths** are a whitelist:
  - `lib/agent/tools/_generated/**/*.ts` (new tools)
  - `docs/agent/**/*.md` (agent-authored docs)
  - Files inside `_generated/` must be kebab-case `.ts` — no subdirs.
- **Hard deny** list blocks every dangerous path regardless of scope:
  `.env*`, `node_modules`, `.git`, `.next`, `.vercel`, `lib/supabase/**`,
  `middleware.ts`, `app/api/auth/**`, `app/api/agent/(tick|cron|tools)/**`,
  `supabase/migrations/**`, `vercel.json`, `package*.json`, `next.config.*`,
  `tsconfig*.json`, `eslint.config.*`.
- **No force-push.** `git.updateRef` is always called with `force: false`.
- **No direct commit on `main`.** The branch is always `agent/<sess>-<slug>`.
- **Explicit approval** on every PR. Approval is `risk: high` — the UI
  highlights it in red.
- **Rate limit** (default 10 PRs/hour per org) enforced in Postgres.
- **In-process AST lint** fails fast on syntax errors before rate-limit is
  consumed.
- **File size cap** (200KB per file, 20 files per proposal).

## Audit

Every proposal is logged in `agent_code_commits`:

| column | meaning |
|--------|---------|
| `status` | `proposed` → `opened` → (merged \| closed \| failed) |
| `files_changed` | list of `{ path, bytes }` |
| `metadata.payload.files` | full file contents (used on approval) |
| `pr_number` / `pr_url` | populated after approval |
| `failure_reason` | populated on status=`failed` |

The table is exposed via Supabase realtime so the UI can live-update.

## Upgrading beyond V1

Things deliberately NOT done in V1 that make sense later:

- GitHub webhook → bump `status` to `merged` / `closed` automatically.
- Vercel preview deploy link in the PR body.
- Rollback tool (`repo_close_pr`) for the agent to abandon its own proposal.
- Self-editing beyond `_generated/` (requires a taint analysis we don't
  have yet).
- Auto-retry with fixes when GitHub Actions checks fail on the PR.
