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
import type { ToolDefinition } from "@/lib/agent/types";

export type GeminiModel = "gemini-2.5-pro" | "gemini-2.5-flash";

const MODEL_MAP: Record<GeminiModel, string> = {
  "gemini-2.5-pro": "gemini-2.5-pro",
  "gemini-2.5-flash": "gemini-2.5-flash",
};

const COST_PER_M_INPUT: Record<GeminiModel, number> = {
  "gemini-2.5-pro": 250,
  "gemini-2.5-flash": 15,
};
const COST_PER_M_OUTPUT: Record<GeminiModel, number> = {
  "gemini-2.5-pro": 1000,
  "gemini-2.5-flash": 60,
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

export function getModel(model: GeminiModel) {
  return getClient().getGenerativeModel({ model: MODEL_MAP[model] });
}

export function estimateCostCents(
  model: GeminiModel,
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
      const typeUpper = param.type.toUpperCase();
      const schema: Record<string, unknown> = {
        type: typeUpper,
        description: param.description,
        ...(param.enum ? { enum: param.enum } : {}),
      };
      // Gemini REQUIRES `items` on every ARRAY schema. Default to string
      // items if the tool author forgot to specify them — safer than
      // crashing the whole agent run with a 400.
      if (typeUpper === "ARRAY") {
        const itemType =
          (param.items && (param.items as { type?: string }).type) || "string";
        schema.items = { type: itemType.toUpperCase() };
      }
      // Gemini rejects OBJECT schemas without at least an empty `properties`
      // field. Provide a permissive default if absent.
      if (typeUpper === "OBJECT") {
        schema.properties = {};
      }
      properties[key] = schema;
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
  model: GeminiModel;
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
