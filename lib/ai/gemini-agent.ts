/**
 * Gemini agent wrapper with function calling (tool use) and streaming.
 *
 * Two tiers:
 *  - gemini-2.5-pro: orchestrator + complex sub-agents
 *  - gemini-2.5-flash: simple/repetitive sub-agents (already used in v1 browser extraction)
 */

import {
  GoogleGenerativeAI,
  SchemaType,
  type Content,
  type FunctionDeclaration,
  type Part,
  type GenerateContentResult,
} from "@google/generative-ai";
import type { AgentModel, ToolDefinition } from "@/lib/agent/types";

const MODEL_MAP: Record<AgentModel, string> = {
  "gemini-2.5-pro": "gemini-2.5-pro",
  "gemini-2.5-flash": "gemini-2.5-flash",
};

const COST_PER_M_INPUT: Record<AgentModel, number> = {
  "gemini-2.5-pro": 250,   // $2.50 per M input tokens = 250 cents
  "gemini-2.5-flash": 15,  // $0.15 per M input tokens = 15 cents
};
const COST_PER_M_OUTPUT: Record<AgentModel, number> = {
  "gemini-2.5-pro": 1000,  // $10 per M output tokens
  "gemini-2.5-flash": 60,  // $0.60 per M output tokens
};

let _client: GoogleGenerativeAI | null = null;

function getClient(): GoogleGenerativeAI {
  if (!_client) {
    const key = process.env.GEMINI_API_KEY;
    if (!key) throw new Error("GEMINI_API_KEY is not set");
    _client = new GoogleGenerativeAI(key);
  }
  return _client;
}

export function getModel(model: AgentModel) {
  return getClient().getGenerativeModel({ model: MODEL_MAP[model] });
}

export function estimateCostCents(
  model: AgentModel,
  inputTokens: number,
  outputTokens: number
): number {
  const inCost = (inputTokens / 1_000_000) * COST_PER_M_INPUT[model];
  const outCost = (outputTokens / 1_000_000) * COST_PER_M_OUTPUT[model];
  return Math.ceil(inCost + outCost);
}

/**
 * Convert our ToolDefinition format to Gemini FunctionDeclaration.
 * We use `as any` for the schema properties because the Gemini SDK's
 * Schema type is a complex discriminated union that doesn't match
 * simple property descriptors.
 */
export function toFunctionDeclarations(
  tools: ToolDefinition[]
): FunctionDeclaration[] {
  return tools.map((tool) => {
    const properties: Record<string, unknown> = {};
    for (const [key, param] of Object.entries(tool.parameters)) {
      properties[key] = {
        type: param.type.toUpperCase(),
        description: param.description,
        ...(param.enum ? { enum: param.enum } : {}),
      };
    }
    return {
      name: tool.name,
      description: tool.description,
      parameters: {
        type: SchemaType.OBJECT,
        properties,
        required: tool.required || Object.entries(tool.parameters)
          .filter(([, p]) => p.required !== false)
          .map(([k]) => k),
      },
    } as FunctionDeclaration;
  });
}

export interface ThinkingBlock {
  thinking: string;
  response: string;
}

/**
 * Parse <think>...</think> blocks from model output.
 * The system prompt instructs the model to wrap reasoning in these tags.
 */
export function parseThinking(text: string): ThinkingBlock {
  const thinkMatch = text.match(/<think>([\s\S]*?)<\/think>/i);
  const thinking = thinkMatch ? thinkMatch[1].trim() : "";
  const response = text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  return { thinking, response };
}

export interface GeminiCallResult {
  text: string;
  thinking: string;
  functionCalls: { name: string; args: Record<string, unknown> }[];
  inputTokens: number;
  outputTokens: number;
  costCents: number;
}

/**
 * Single call to Gemini with function calling support.
 */
export async function callGemini(opts: {
  model: AgentModel;
  systemPrompt: string;
  history: Content[];
  tools?: ToolDefinition[];
  maxRetries?: number;
}): Promise<GeminiCallResult> {
  const { model: modelId, systemPrompt, history, tools, maxRetries = 2 } = opts;
  const model = getModel(modelId);

  const functionDeclarations = tools?.length ? toFunctionDeclarations(tools) : undefined;

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result: GenerateContentResult = await model.generateContent({
        contents: history,
        systemInstruction: { role: "user", parts: [{ text: systemPrompt }] },
        ...(functionDeclarations ? {
          tools: [{ functionDeclarations }],
        } : {}),
      });

      const response = result.response;
      const candidate = response.candidates?.[0];
      if (!candidate) throw new Error("No candidate in Gemini response");

      const parts: Part[] = candidate.content?.parts || [];

      let textContent = "";
      const functionCalls: { name: string; args: Record<string, unknown> }[] = [];

      for (const part of parts) {
        if ("text" in part && part.text) {
          textContent += part.text;
        }
        if ("functionCall" in part && part.functionCall) {
          functionCalls.push({
            name: part.functionCall.name,
            args: (part.functionCall.args as Record<string, unknown>) || {},
          });
        }
      }

      const usage = response.usageMetadata;
      const inputTokens = usage?.promptTokenCount || 0;
      const outputTokens = usage?.candidatesTokenCount || 0;
      const costCents = estimateCostCents(modelId, inputTokens, outputTokens);

      const { thinking, response: cleanText } = parseThinking(textContent);

      return {
        text: cleanText,
        thinking,
        functionCalls,
        inputTokens,
        outputTokens,
        costCents,
      };
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));
      if (attempt < maxRetries) {
        const delay = 1000 * Math.pow(2, attempt);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }

  throw lastError || new Error("callGemini failed");
}
