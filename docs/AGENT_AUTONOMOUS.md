# Agent v3 — Autonomous runtime

No Inngest required. The agent runs on a tick-based loop powered by:

- **Postgres-advisory-style locks** (`agent_try_lock_session` RPC)
- **Self-chained HTTP calls** to `/api/agent/tick` (survives Vercel's 300s limit)
- **Vercel Cron** recovery job every minute (`/api/agent/cron/recover`)
- **Journal table** `agent_session_steps` for durability + replay
- **Retries with exponential backoff + jitter** on transient failures

## How one tick works

```
POST /api/agent/tick
  └─ tickSession(sessionId)
       ├─ acquireLock(sessionId, ttl=300s)     ← Postgres RPC
       ├─ load session + history from Supabase
       ├─ inject learnings from past sessions
       ├─ register approved custom tools
       ├─ runAgentLoop(...)  ← up to 8 iterations OR 270s
       │     ├─ LLM call
       │     ├─ tool calls
       │     └─ writes to agent_messages / agent_reflections
       ├─ persist status + cost to agent_sessions
       ├─ journal step in agent_session_steps
       ├─ scheduleNextTick(...) if more work
       └─ releaseLock(...)
```

If the tick crashes, the lock expires after 5 min and the cron recovery job
(every minute) picks it up. `attempt_count` increases; after 3 failed retries
the session is marked `failed`.

## Self-improvement loop

Tool `learn_record` → row in `agent_learnings` (org-scoped).
`injectLearnings()` pulls the top-K into the system prompt for every
subsequent session. This is the durable cross-session memory.

## Self-extension (custom tools)

1. Agent calls `tool_create` with JS code.
2. Row lands in `agent_custom_tools` with `is_approved=false`.
3. An `agent_approvals` entry is filed so a human approves it via the UI
   (or `POST /api/agent/tools/[id]/approve`).
4. Next tick registers the approved tool and the agent can call it like any
   built-in.

Execution happens inside a Node `vm` sandbox with ONLY these globals:
`fetch, URL, URLSearchParams, Headers, Request, Response, Blob, JSON, Math,
Date, Array, Object, String, Number, Boolean, Map, Set, console, setTimeout,
clearTimeout, Promise, Error`.

No `require`, no `process`, no filesystem, no child processes. Hard 30s
timeout, 256 KB output cap.

## Vercel Pro — Playwright (prod stable)

Les outils `web_search`, `web_fetch`, `google_search`, `google_maps_search`, etc. lancent **Chromium** (Sparticuz) dans les routes `/api/agent/*`. Sur **Pro**, donnez-leur assez de RAM / CPU :

1. **Dashboard** → ton projet → **Settings** → **Functions** → **Function CPU** (ou *Advanced* selon l’UI).
2. Choisis **Performance — 4 GB / 2 vCPUs** si tu vois des timeouts ou des plantages navigateur. **Standard — 2 GB** suffit souvent depuis qu’on évite `--single-process` par défaut sur Vercel.
3. Avec **Fluid Compute** activé, la taille mémoire se règle **ici (dashboard)** — pas via `memory` dans `vercel.json` (souvent ignoré / déconseillé).

Variable optionnelle : **`PLAYWRIGHT_SERVERLESS_SINGLE_PROCESS=1`** — force l’ancien mode Chromium très économe en RAM ; utile seulement si tu as des **OOM** sur un plan serré, au prix d’erreurs `BrowserContext closed` un peu plus fréquentes.

## Environment variables

| Name | Required | What it does |
| --- | --- | --- |
| `NEXT_PUBLIC_APP_URL` | Prod | Base URL used when self-chaining ticks. Falls back to `VERCEL_URL`, then `localhost:3000`. |
| `AGENT_TICK_SECRET` | Prod recommended | Shared secret for internal self-calls. If unset, the tick route trusts requests carrying the `x-agent-tick: 1` header. |
| `CRON_SECRET` | Prod recommended | Bearer token required by the cron recovery route. Vercel Cron automatically adds this. |
| `GEMINI_API_KEY` | Yes | Default LLM. |
| `ANTHROPIC_API_KEY` | Optional | Needed to use Claude models. |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Used by the runtime to bypass RLS for session writes. |
| `PLAYWRIGHT_SERVERLESS_SINGLE_PROCESS` | Optional | Set to `1` on Vercel only if Chromium OOMs; defaults to multi-process (more stable). |

## Migrations to apply

Run, in order:

1. `020_agent_v3.sql`
2. `021_agent_autonomous.sql`
3. `023_org_browser_credentials.sql` — cookies navigateur chiffrés par org (injection Playwright + UI Agent)

## Approving a custom tool

```
POST /api/agent/tools/<id>/approve
Cookie: sb-...
{ "approve": true }
```

To disable later:
```
POST /api/agent/tools/<id>/approve
{ "disable": true }
```

## Observability

All runtime events are already in Supabase:

- `agent_sessions` — status, cost, lock, last_tick_at
- `agent_session_steps` — one row per tick attempt with inputs/outputs/errors
- `agent_messages` — user+assistant+thinking+system (tool calls)
- `agent_reflections` — self-reviews
- `agent_approvals` — approval requests & decisions
- `agent_learnings` — durable lessons
- `agent_custom_tools` — tools defined at runtime

## Manual kick / debug

```
# force a tick on a session
curl -X POST https://your.app/api/agent/tick \
  -H "x-agent-tick: 1" \
  -H "content-type: application/json" \
  -d '{ "sessionId": "<uuid>" }'

# run cron recovery now
curl https://your.app/api/agent/cron/recover
```
