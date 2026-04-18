import { inngest } from "@/lib/inngest/client";

type InngestStep = { run: (name: string, fn: () => unknown) => Promise<unknown> };

/**
 * Placeholder durable handler for `workflow_enqueue` / `enqueueAgentOsJob`.
 * Replace `step.run` body with real fan-out work (crawl, batch enrich, …).
 */
export const agentOsLongTask = inngest.createFunction(
  {
    id: "agent-os-long-task",
    retries: 1,
    concurrency: [{ limit: 8 }],
    triggers: [{ event: "agent/os.long_task" }],
  },
  async ({
    event,
    step,
  }: {
    event: { data: { jobName?: string; payload?: Record<string, unknown> } };
    step: InngestStep;
  }) => {
    const jobName = event.data?.jobName ?? null;
    await step.run("record", async () => ({ ok: true, jobName }));
    return { done: true };
  },
);
