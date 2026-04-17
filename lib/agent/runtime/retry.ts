/**
 * Retry + classification helpers for the autonomous runtime.
 *
 * We retry transient LLM/network/tool errors with exponential backoff + jitter.
 * Permanent errors (auth, bad input, quota exhausted) are NOT retried.
 */

export interface RetryOptions {
  maxAttempts?: number; // default 3
  baseDelayMs?: number; // default 500
  maxDelayMs?: number; // default 8000
  jitter?: boolean; // default true
  isRetryable?: (err: unknown) => boolean;
}

export function isLikelyTransient(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  const s = msg.toLowerCase();
  if (!s) return false;
  return (
    s.includes("timeout") ||
    s.includes("timed out") ||
    s.includes("fetch failed") ||
    s.includes("network") ||
    s.includes("econnreset") ||
    s.includes("etimedout") ||
    s.includes("socket hang up") ||
    s.includes("503") ||
    s.includes("502") ||
    s.includes("504") ||
    s.includes("rate limit") ||
    s.includes("temporarily") ||
    s.includes("overloaded") ||
    s.includes("please try again")
  );
}

export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  opts: RetryOptions = {},
): Promise<T> {
  const maxAttempts = opts.maxAttempts ?? 3;
  const baseDelay = opts.baseDelayMs ?? 500;
  const maxDelay = opts.maxDelayMs ?? 8000;
  const jitter = opts.jitter ?? true;
  const isRetryable = opts.isRetryable ?? isLikelyTransient;

  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      lastErr = err;
      if (attempt >= maxAttempts || !isRetryable(err)) throw err;
      const exp = Math.min(maxDelay, baseDelay * 2 ** (attempt - 1));
      const delay = jitter ? Math.round(exp * (0.6 + Math.random() * 0.6)) : exp;
      await sleep(delay);
    }
  }
  throw lastErr;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
