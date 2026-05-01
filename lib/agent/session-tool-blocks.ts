import { classifyToolFailure } from "./tool-failure-policy";

/**
 * Per-session circuit breaker: after a NON_RETRYABLE tool failure, skip repeat
 * calls to the same tool for that session (saves API quota + stops 6×401 loops).
 */

const blockedToolsBySession = new Map<string, Set<string>>();

export function sessionToolBlockKey(orgId: string, sessionId: string): string {
  return `${orgId}:${sessionId}`;
}

export function isSessionToolBlocked(
  key: string | undefined,
  toolName: string,
): boolean {
  if (!key) return false;
  return blockedToolsBySession.get(key)?.has(toolName) ?? false;
}

export function blockSessionTool(key: string | undefined, toolName: string): void {
  if (!key) return;
  let set = blockedToolsBySession.get(key);
  if (!set) {
    set = new Set<string>();
    blockedToolsBySession.set(key, set);
  }
  set.add(toolName);
}

/** True if this error should permanently block retries for this tool this session. */
export function errorShouldBlockFurtherCalls(
  message: string,
  toolName: string,
): boolean {
  return classifyToolFailure(message, toolName).blockToolForSession;
}
