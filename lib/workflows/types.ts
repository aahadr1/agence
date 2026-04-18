/**
 * Durable execution façade — map to Vercel Workflows when available,
 * or Inngest / Queues today (see `enqueueAgentOsJob`).
 */

export interface LongTaskPayload {
  jobName: string;
  payload: Record<string, unknown>;
}

export interface WorkflowEnqueueResult {
  ok: boolean;
  provider: "inngest" | "vercel_workflows" | "none";
  detail?: string;
}
