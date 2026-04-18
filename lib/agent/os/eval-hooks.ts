/**
 * Extension points for offline evals (citation quality, tool success, completion).
 * Call from executeTool or a batch job; keep implementations side-effect free by default.
 */

export interface ToolEvalPayload {
  toolName: string;
  ok: boolean;
  durationMs: number;
  sessionId?: string;
}

const listeners: Array<(p: ToolEvalPayload) => void> = [];

export function registerToolEvalListener(fn: (p: ToolEvalPayload) => void) {
  listeners.push(fn);
}

export function emitToolEval(payload: ToolEvalPayload) {
  for (const fn of listeners) {
    try {
      fn(payload);
    } catch {
      /* */
    }
  }
}
