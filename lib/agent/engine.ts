/**
 * Core ReAct agent loop: call Gemini with tools, execute function calls,
 * feed results back, repeat until done or budget exhausted.
 */

import type { Content, Part } from "@google/generative-ai";
import { callGemini } from "@/lib/ai/gemini-agent";
import type {
  AgentConfig,
  AgentContext,
  ToolDefinition,
  ToolResult,
} from "./types";

export type ToolExecutor = (
  name: string,
  args: Record<string, unknown>,
  context: AgentContext
) => Promise<ToolResult>;

export interface RunAgentResult {
  finalMessage: string;
  history: Content[];
  totalCostCents: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  iterations: number;
  toolCalls: ToolResult[];
}

const BUDGET_WARNING_THRESHOLD = 0.85;

export async function runAgentLoop(
  config: AgentConfig,
  context: AgentContext,
  executeTool: ToolExecutor,
  userMessage?: string,
): Promise<RunAgentResult> {
  const history: Content[] = [];
  const allToolCalls: ToolResult[] = [];
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let finalMessage = "";

  if (userMessage) {
    history.push({ role: "user", parts: [{ text: userMessage }] });
  }

  for (let i = 0; i < config.maxIterations; i++) {
    context.iterationCount = i + 1;

    if (
      context.budgetCapCents &&
      context.totalCostCents >= context.budgetCapCents
    ) {
      finalMessage = "Budget cap reached. Stopping agent loop.";
      await config.onMessage?.(finalMessage);
      break;
    }

    if (
      context.budgetCapCents &&
      context.totalCostCents >=
        context.budgetCapCents * BUDGET_WARNING_THRESHOLD
    ) {
      await config.onMessage?.(
        `Warning: approaching budget cap (${context.totalCostCents}/${context.budgetCapCents} cents used).`
      );
    }

    const result = await callGemini({
      model: config.model,
      systemPrompt: config.systemPrompt,
      history,
      tools: config.tools.length > 0 ? config.tools : undefined,
    });

    totalInputTokens += result.inputTokens;
    totalOutputTokens += result.outputTokens;
    context.totalCostCents += result.costCents;

    if (result.thinking) {
      await config.onThinking?.(result.thinking);
    }

    if (result.functionCalls.length === 0) {
      finalMessage = result.text;
      if (result.text) {
        history.push({ role: "model", parts: [{ text: result.text }] });
        await config.onMessage?.(result.text);
      }
      break;
    }

    const modelParts: Part[] = [];
    if (result.text) {
      modelParts.push({ text: result.text } as Part);
      await config.onMessage?.(result.text);
    }
    for (const fc of result.functionCalls) {
      modelParts.push({ functionCall: { name: fc.name, args: fc.args } } as Part);
    }
    history.push({ role: "model", parts: modelParts });

    const functionResponseParts: Array<{ functionResponse: { name: string; response: { result: unknown } } }> = [];

    for (const fc of result.functionCalls) {
      await config.onToolCall?.(fc.name, fc.args);

      const toolResult = await executeTool(fc.name, fc.args, context);
      allToolCalls.push(toolResult);
      context.totalCostCents += toolResult.costCents;

      await config.onToolResult?.(toolResult);

      functionResponseParts.push({
        functionResponse: {
          name: fc.name,
          response: {
            result: toolResult.error || toolResult.result,
          },
        },
      });
    }

    history.push({ role: "user", parts: functionResponseParts });
  }

  if (!finalMessage && context.iterationCount >= config.maxIterations) {
    finalMessage = "Maximum iterations reached. Stopping agent loop.";
    await config.onMessage?.(finalMessage);
  }

  return {
    finalMessage,
    history,
    totalCostCents: context.totalCostCents,
    totalInputTokens,
    totalOutputTokens,
    iterations: context.iterationCount,
    toolCalls: allToolCalls,
  };
}
