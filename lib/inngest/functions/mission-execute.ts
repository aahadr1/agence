/**
 * Inngest function: durable mission execution.
 * Runs the orchestrator agent loop, persisting messages and status to Supabase.
 */

import { inngest } from "../client";
import { runAgentLoop } from "@/lib/agent/engine";
import { executeTool as executeRegisteredTool } from "@/lib/agent/tools";
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

export const missionExecute = inngest.createFunction(
  {
    id: "mission-execute",
    retries: 1,
    concurrency: [{ limit: 5 }],
    triggers: [{ event: "lead-agent/mission.start" }],
  },
  async ({ event, step }: { event: { data: { missionId: string } }; step: any }) => {
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
      await import("@/lib/agent/tools");

      const context: AgentContext = {
        missionId,
        orgId: mission.org_id,
        userId: mission.user_id,
        scratchpad: new Map(),
        totalCostCents: mission.cost_cents || 0,
        budgetCapCents: mission.budget_cap_cents || null,
        iterationCount: 0,
        maxIterations: 50,
      };

      const toolNames = ROLE_TOOLS.orchestrator;
      const tools = getToolDefinitions(toolNames);

      const agentResult = await runAgentLoop(
        {
          systemPrompt: ORCHESTRATOR_SYSTEM_PROMPT,
          tools,
          model: "gemini-2.5-pro",
          maxIterations: 50,
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
        executeRegisteredTool,
        mission.user_prompt
      );

      return {
        finalMessage: agentResult.finalMessage,
        costCents: agentResult.totalCostCents,
        iterations: agentResult.iterations,
        toolCalls: agentResult.toolCalls.length,
      };
    });

    await step.run("mark-completed", async () => {
      const status = result.finalMessage.includes("paused") ? "paused" : "completed";
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
