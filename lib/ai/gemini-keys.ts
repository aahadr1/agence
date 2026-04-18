/**
 * Ordered Gemini API keys: primary + optional fallbacks (quota / rate limit only).
 *
 * Env:
 *   GEMINI_API_KEY              — required primary
 *   GEMINI_API_KEY_FALLBACK     — optional single extra key (common typo vs …FALLBACKS)
 *   GEMINI_API_KEY_FALLBACK_1 … GEMINI_API_KEY_FALLBACK_8 — optional, tried in order
 *   GEMINI_API_KEY_FALLBACKS    — optional comma/space/semicolon-separated extra keys
 *
 * Duplicate values are dropped — two identical keys produce one entry (no “fallback”).
 */

export function listGeminiApiKeysInOrder(): string[] {
  const primary = process.env.GEMINI_API_KEY?.trim();
  if (!primary) return [];

  const ordered: string[] = [primary];
  const singleFallback = process.env.GEMINI_API_KEY_FALLBACK?.trim();
  if (singleFallback) ordered.push(singleFallback);
  for (let i = 1; i <= 8; i++) {
    const v = process.env[`GEMINI_API_KEY_FALLBACK_${i}`]?.trim();
    if (v) ordered.push(v);
  }
  const rawExtras = process.env.GEMINI_API_KEY_FALLBACKS?.trim();
  if (rawExtras) {
    ordered.push(
      ...rawExtras
        .split(/[,;\s]+/)
        .map((s) => s.trim())
        .filter(Boolean),
    );
  }

  const seen = new Set<string>();
  return ordered.filter((k) => {
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export function hasGeminiApiKey(): boolean {
  return listGeminiApiKeysInOrder().length > 0;
}

/**
 * Flatten error + `cause` chain + common SDK fields into one lowercase string.
 * Google’s `GoogleGenerativeAIFetchError` puts HTTP status on `.status`; some
 * wrappers only preserve that on `cause`, so a shallow `.message` check can
 * miss 429 and we would retry the same key instead of rotating.
 */
export function collectGeminiErrorBlob(e: unknown): string {
  const chunks: string[] = [];
  const visited = new Set<unknown>();
  let cur: unknown = e;

  for (let depth = 0; cur != null && depth < 12; depth++) {
    if (typeof cur === "object" && cur !== null) {
      if (visited.has(cur)) break;
      visited.add(cur);
    }

    if (cur instanceof Error) {
      chunks.push(cur.message, cur.name);
      cur = (cur as Error & { cause?: unknown }).cause;
      continue;
    }
    if (typeof cur === "object" && cur !== null) {
      const o = cur as Record<string, unknown>;
      if (typeof o.message === "string") chunks.push(o.message);
      if (typeof o.status === "number") chunks.push(String(o.status));
      if (typeof o.statusText === "string") chunks.push(o.statusText);
      if ("cause" in o && o.cause !== undefined) {
        cur = o.cause;
        continue;
      }
      break;
    }
    chunks.push(String(cur));
    break;
  }

  let json = "";
  try {
    json = JSON.stringify(e).toLowerCase();
  } catch {
    /* circular */
  }
  return `${chunks.join(" ")} ${json}`.toLowerCase();
}

/** True when switching to another API key may help (quota, RPM, burst). */
export function isGeminiQuotaLikeError(e: unknown): boolean {
  const blob = collectGeminiErrorBlob(e);

  if (blob.includes("429")) return true;
  if (blob.includes("resource_exhausted")) return true;
  if (blob.includes("resource exhausted")) return true;
  if (blob.includes("quota")) return true;
  if (blob.includes("rate limit")) return true;
  if (blob.includes("too many requests")) return true;
  if (blob.includes("exceeded your")) return true;
  if (blob.includes("generate_requests_per")) return true;
  if (blob.includes("requests per minute")) return true;
  if (blob.includes("billing")) return true;
  if (blob.includes("consumer_suspended")) return true;

  return false;
}

/**
 * True when the **same** request might work with another `GEMINI_*` key
 * (different Google Cloud project / billing). Retrying the same key is useless.
 *
 * Covers: quota/RPM, API not enabled for project (`SERVICE_DISABLED`),
 * invalid API key string, etc. Does **not** cover model refusals / safety blocks
 * where every key would fail the same way — callers still exhaust keys then throw.
 */
export function shouldRotateGeminiApiKey(e: unknown): boolean {
  if (isGeminiQuotaLikeError(e)) return true;
  const blob = collectGeminiErrorBlob(e);

  if (blob.includes("api_key_invalid")) return true;
  if (blob.includes("invalid api key")) return true;
  if (blob.includes("api key not valid")) return true;

  if (blob.includes("service_disabled")) return true;
  if (blob.includes("has not been used") && blob.includes("gemini")) return true;
  if (blob.includes("api has not been")) return true;

  if (blob.includes("permission_denied") && blob.includes("generativelanguage"))
    return true;

  return false;
}
