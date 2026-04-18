import type { LongTaskPayload, WorkflowEnqueueResult } from "./types";

/** Fire-and-forget long task — Inngest when INNGEST_EVENT_KEY is set. */
export async function enqueueAgentOsJob(
  data: LongTaskPayload,
): Promise<WorkflowEnqueueResult> {
  if (!process.env.INNGEST_EVENT_KEY) {
    return { ok: false, provider: "none", detail: "INNGEST_EVENT_KEY not set" };
  }
  try {
    const { inngest } = await import("@/lib/inngest/client");
    await inngest.send({
      name: "agent/os.long_task",
      data: { jobName: data.jobName, payload: data.payload },
    });
    return { ok: true, provider: "inngest" };
  } catch (e) {
    return {
      ok: false,
      provider: "inngest",
      detail: e instanceof Error ? e.message : String(e),
    };
  }
}
