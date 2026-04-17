/**
 * Session self-scheduler.
 *
 * To break past Vercel's 300s function limit, each agent "tick" is a short
 * serverless invocation. When a tick ends but the session still has work,
 * we fire-and-forget a new HTTP request to /api/agent/tick, giving the next
 * tick a fresh 300s budget and zero cold-start dependency on the previous run.
 *
 * This also works locally (Next dev server) and in any Node host.
 */

function getBaseUrl(): string {
  // Prefer the public app URL. Fallback to Vercel's auto-injected var.
  const explicit = process.env.NEXT_PUBLIC_APP_URL;
  if (explicit && /^https?:\/\//.test(explicit)) return explicit.replace(/\/$/, "");
  const vercel = process.env.VERCEL_URL;
  if (vercel) return `https://${vercel.replace(/\/$/, "")}`;
  return "http://localhost:3000";
}

export interface ScheduleOptions {
  /** Delay in ms before the next tick fires (default 0) */
  delayMs?: number;
}

/**
 * Schedule the next tick for a session. Resolves as soon as the request is
 * dispatched (we do NOT await the remote response — that would block us).
 */
export async function scheduleNextTick(
  sessionId: string,
  opts: ScheduleOptions = {},
): Promise<void> {
  const base = getBaseUrl();
  const url = `${base}/api/agent/tick`;
  const body = JSON.stringify({
    sessionId,
    secret: process.env.AGENT_TICK_SECRET || undefined,
  });

  const fire = async () => {
    try {
      // We intentionally do not await. If the platform drops the connection
      // before the function handler is invoked, the cron-based recovery job
      // will pick up stuck sessions within ~30 s.
      await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-agent-tick": "1",
        },
        body,
        // Abort after 3 s to guarantee the caller (current tick) can return.
        signal: AbortSignal.timeout(3000),
      }).catch(() => {});
    } catch {
      /* ignored */
    }
  };

  if (opts.delayMs && opts.delayMs > 0) {
    setTimeout(fire, opts.delayMs).unref?.();
    return;
  }
  // Use `after()` if we're inside a Next.js request context; otherwise fire
  // in the background immediately.
  try {
    const { after } = await import("next/server");
    after(fire);
  } catch {
    void fire();
  }
}
