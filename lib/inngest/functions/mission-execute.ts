/**
 * Inngest function: durable mission execution.
 * Runs the orchestrator agent loop, persisting messages and status to Supabase.
 */

import { inngest } from "../client";
import { ORCHESTRATOR_SYSTEM_PROMPT, ROLE_TOOLS } from "@/lib/agent/orchestrator";
import { getToolDefinitions } from "@/lib/agent/tool-registry";
import type { AgentContext } from "@/lib/agent/types";
import { createClient } from "@supabase/supabase-js";

function getDb() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

type InngestStep = {
  run: <T>(name: string, fn: () => Promise<T> | T) => Promise<T>;
};

export const missionExecute = inngest.createFunction(
  {
    id: "mission-execute",
    retries: 1,
    concurrency: [{ limit: 5 }],
    triggers: [{ event: "lead-agent/mission.start" }],
  },
  async ({
    event,
    step,
  }: {
    event: { data: { missionId: string } };
    step: InngestStep;
  }) => {
    const { missionId } = event.data as { missionId: string };
    const db = getDb();

    const mission = await step.run("load-mission", async () => {
      const { data, error } = await db
        .from("missions")
        .select("*")
        .eq("id", missionId)
        .single();
      if (error) throw new Error(`Mission not found: ${error.message}`);
      return data;
    });

    await step.run("mark-running", async () => {
      await db
        .from("missions")
        .update({ status: "running", started_at: new Date().toISOString() })
        .eq("id", missionId);
    });

    const result = await step.run("orchestrator-loop", async () => {
      const { executeTool: executeRegisteredTool } = await import(
        "@/lib/agent/tools",
      );
      const { runAgentLoop } = await import("@/lib/agent/engine");

      const context: AgentContext = {
        missionId,
        sessionId: missionId,
        orgId: mission.org_id,
        userId: mission.user_id,
        scratchpad: new Map(),
        totalCostCents: mission.cost_cents || 0,
        budgetCapCents: mission.budget_cap_cents || null,
        iterationCount: 0,
        maxIterations: 50,
        capabilityPacks: ["lead-gen-fr", "web-research"],
        inputTokensSoFar: 0,
      };

      const toolNames = ROLE_TOOLS.orchestrator;
      const tools = getToolDefinitions(toolNames);

      const { buildLeadGenMissionContextAppendix } = await import(
        "@/lib/agent/mission-prompt",
      );
      const missionAppendix = await buildLeadGenMissionContextAppendix(
        mission.org_id,
        missionId,
        ["lead-gen-fr", "web-research"],
        mission.user_prompt || "",
      );
      const systemPromptWithMission = missionAppendix
        ? `${ORCHESTRATOR_SYSTEM_PROMPT}\n\n${missionAppendix}`
        : ORCHESTRATOR_SYSTEM_PROMPT;

      const agentResult = await runAgentLoop(
        {
          systemPrompt: systemPromptWithMission,
          tools,
          model: "gemini-2.5-pro",
          maxIterations: 50,
          reflectEveryN: 0,
          reflectionLeadGenDepth: false,
          onThinking: async (text) => {
            await db.from("mission_messages").insert({
              mission_id: missionId,
              role: "thinking",
              content: text,
            });
          },
          onMessage: async (text) => {
            await db.from("mission_messages").insert({
              mission_id: missionId,
              role: "assistant",
              content: text,
            });
          },
          onToolCall: async (name, params) => {
            await db.from("mission_messages").insert({
              mission_id: missionId,
              role: "system",
              content: `Calling tool: ${name}`,
              metadata: { tool: name, params },
            });
          },
          onToolResult: async (toolResult) => {
            await db.from("api_calls").insert({
              mission_id: missionId,
              service: toolResult.name,
              cost_cents: toolResult.costCents,
              duration_ms: toolResult.durationMs,
              response_status: toolResult.error ? 500 : 200,
            });
          },
        },
        context,
        executeRegisteredTool as Parameters<typeof runAgentLoop>[2],
        mission.user_prompt
      );

      return {
        finalMessage: agentResult.finalMessage,
        costCents: agentResult.totalCostCents,
        iterations: agentResult.iterations,
        toolCalls: agentResult.toolCalls.length,
        agentStatus: agentResult.status,
      };
    });

    await step.run("mark-completed", async () => {
      const agentStatus = (result as { agentStatus?: string }).agentStatus;
      const paused =
        agentStatus === "awaiting_user_input" ||
        agentStatus === "awaiting_approval" ||
        agentStatus === "budget_exhausted" ||
        agentStatus === "aborted" ||
        (typeof result.finalMessage === "string" &&
          result.finalMessage.toLowerCase().includes("paused"));
      const status = paused ? "paused" : "completed";
      await db
        .from("missions")
        .update({
          status,
          cost_cents: result.costCents,
          completed_at: status === "completed" ? new Date().toISOString() : null,
        })
        .eq("id", missionId);

      if (status === "completed") {
        const { count } = await db
          .from("leads")
          .select("id", { count: "exact", head: true })
          .eq("mission_id", missionId);

        await db
          .from("missions")
          .update({ leads_found: count || 0 })
          .eq("id", missionId);
      }
    });

    return result;
  }
);
