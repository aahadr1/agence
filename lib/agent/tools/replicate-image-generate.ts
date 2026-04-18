/**
 * Image generation via Replicate — Google's Nano Banana family on Replicate.
 * Default: nano-banana; variants: nano-banana-2, nano-banana-pro.
 */

import { registerTool } from "../tool-registry";

const MODEL_BY_VARIANT = {
  nano_banana: { owner: "google", name: "nano-banana" },
  nano_banana_2: { owner: "google", name: "nano-banana-2" },
  nano_banana_pro: { owner: "google", name: "nano-banana-pro" },
} as const;

type Variant = keyof typeof MODEL_BY_VARIANT;

const PREFER_WAIT_SEC = 55;
const POLL_MS = 1500;
const POLL_MAX_MS = 120_000;

function getToken(): string {
  const t = process.env.REPLICATE_API_TOKEN?.trim();
  if (!t) {
    throw new Error(
      "REPLICATE_API_TOKEN is not set. Add it in .env.local (see .env.local.example).",
    );
  }
  return t;
}

function normalizeVariant(raw: unknown): Variant {
  const s = String(raw || "nano_banana")
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  if (s === "nano_banana" || s === "nanobanana" || s === "default")
    return "nano_banana";
  if (
    s === "nano_banana_2" ||
    s === "nanobanana2" ||
    s === "nano_banana2" ||
    s === "2"
  )
    return "nano_banana_2";
  if (
    s === "nano_banana_pro" ||
    s === "nanobananapro" ||
    s === "pro"
  )
    return "nano_banana_pro";
  return "nano_banana";
}

function buildInput(args: Record<string, unknown>): Record<string, unknown> {
  const prompt = String(args.prompt || "").trim();
  if (!prompt) throw new Error("prompt is required");

  const input: Record<string, unknown> = { prompt };

  if (args.aspect_ratio != null && String(args.aspect_ratio).trim()) {
    input.aspect_ratio = String(args.aspect_ratio).trim();
  }

  if (args.output_format != null) {
    const fmt = String(args.output_format).toLowerCase();
    if (fmt === "jpg" || fmt === "jpeg" || fmt === "png" || fmt === "webp") {
      input.output_format = fmt === "jpeg" ? "jpg" : fmt;
    }
  }

  const urls = args.image_input_urls;
  if (Array.isArray(urls) && urls.length > 0) {
    const cleaned = urls
      .map((u) => String(u).trim())
      .filter((u) => u.startsWith("http://") || u.startsWith("https://"));
    if (cleaned.length > 0) input.image_input = cleaned;
  }

  if (args.resolution != null && String(args.resolution).trim()) {
    input.resolution = String(args.resolution).trim();
  }

  if (typeof args.google_search === "boolean") {
    input.google_search = args.google_search;
  }
  if (typeof args.image_search === "boolean") {
    input.image_search = args.image_search;
  }

  return input;
}

interface PredictionResponse {
  id?: string;
  status?: string;
  error?: string;
  detail?: string;
  output?: unknown;
  urls?: { get?: string; cancel?: string };
}

async function fetchPrediction(
  token: string,
  getUrl: string,
): Promise<PredictionResponse> {
  const res = await fetch(getUrl, {
    headers: { Authorization: `Token ${token}` },
  });
  const body = (await res.json()) as PredictionResponse;
  if (!res.ok) {
    throw new Error(
      body.detail || body.error || `Replicate GET ${res.status}: ${JSON.stringify(body)}`,
    );
  }
  return body;
}

async function createPrediction(
  token: string,
  owner: string,
  model: string,
  input: Record<string, unknown>,
): Promise<PredictionResponse> {
  const url = `https://api.replicate.com/v1/models/${owner}/${model}/predictions`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Token ${token}`,
      "Content-Type": "application/json",
      Prefer: `wait=${PREFER_WAIT_SEC}`,
    },
    body: JSON.stringify({ input }),
  });
  const body = (await res.json()) as PredictionResponse;
  if (!res.ok) {
    throw new Error(
      body.detail ||
        body.error ||
        `Replicate POST ${res.status}: ${JSON.stringify(body)}`,
    );
  }
  return body;
}

async function waitForOutput(
  token: string,
  pred: PredictionResponse,
): Promise<unknown> {
  if (pred.status === "succeeded" && pred.output != null) return pred.output;
  if (pred.status === "failed" || pred.status === "canceled") {
    throw new Error(pred.error || `Prediction ${pred.status}`);
  }

  const getUrl = pred.urls?.get;
  if (!getUrl || !pred.id) {
    throw new Error("Replicate response missing prediction urls.get or id");
  }

  const deadline = Date.now() + POLL_MAX_MS;
  let last = pred;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_MS));
    last = await fetchPrediction(token, getUrl);
    if (last.status === "succeeded" && last.output != null) return last.output;
    if (last.status === "failed" || last.status === "canceled") {
      throw new Error(last.error || `Prediction ${last.status}`);
    }
  }
  throw new Error(
    `Replicate prediction timed out after ${POLL_MAX_MS / 1000}s (last status: ${last.status})`,
  );
}

function formatOutput(output: unknown): { image_urls: string[]; raw: unknown } {
  if (typeof output === "string" && output.startsWith("http")) {
    return { image_urls: [output], raw: output };
  }
  if (Array.isArray(output)) {
    const urls = output.filter(
      (x): x is string => typeof x === "string" && x.startsWith("http"),
    );
    return { image_urls: urls, raw: output };
  }
  if (output && typeof output === "object" && "url" in (output as object)) {
    const u = (output as { url?: string }).url;
    if (typeof u === "string" && u.startsWith("http")) {
      return { image_urls: [u], raw: output };
    }
  }
  return { image_urls: [], raw: output };
}

registerTool(
  {
    name: "replicate_image_generate",
    description:
      "Generate or edit images via Replicate using Google's Nano Banana models. Default model is **nano-banana** (fast). Use variant **nano_banana_2** when the user asks for \"nano banana 2\" / v2. Use **nano_banana_pro** when they ask for \"pro\" / higher quality. Requires REPLICATE_API_TOKEN. Returns public image URL(s).",
    parameters: {
      prompt: {
        type: "string",
        description:
          "Natural-language description of the image to create, or editing instructions if image_input_urls are provided.",
      },
      variant: {
        type: "string",
        description:
          "One of: nano_banana (default), nano_banana_2, nano_banana_pro. Aliases accepted: pro → nano_banana_pro; 2 / nano banana 2 → nano_banana_2.",
        required: false,
      },
      aspect_ratio: {
        type: "string",
        description:
          "Optional aspect ratio if the model supports it (e.g. 1:1, 16:9, match_input_image).",
        required: false,
      },
      image_input_urls: {
        type: "array",
        items: { type: "string" },
        description:
          "Optional list of HTTPS image URLs for reference / editing (model-dependent).",
        required: false,
      },
      resolution: {
        type: "string",
        description:
          "Optional resolution hint for Nano Banana 2 / Pro when supported (e.g. 1K, 2K).",
        required: false,
      },
      output_format: {
        type: "string",
        description: "Optional: jpg, png, or webp if supported.",
        required: false,
      },
      google_search: {
        type: "boolean",
        description:
          "Optional: enable Google Web Search grounding if the model supports it.",
        required: false,
      },
      image_search: {
        type: "boolean",
        description:
          "Optional: enable Google Image Search grounding if the model supports it.",
        required: false,
      },
    },
    required: ["prompt"],
    costEstimateCents: 3,
  },
  async (args) => {
    let token: string;
    try {
      token = getToken();
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return {
        error: "replicate_configuration",
        message,
        image_urls: [] as string[],
      };
    }
    const variant = normalizeVariant(args.variant);
    const { owner, name } = MODEL_BY_VARIANT[variant];
    const input = buildInput(args as Record<string, unknown>);

    const created = await createPrediction(token, owner, name, input);
    const output = await waitForOutput(token, created);
    const { image_urls, raw } = formatOutput(output);

    return {
      variant,
      model: `${owner}/${name}`,
      image_urls,
      output: raw,
    };
  },
);
