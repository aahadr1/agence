import { registerTool } from "../tool-registry";

registerTool(
  {
    name: "scratchpad_write",
    description:
      "Write a key-value pair to the mission scratchpad (working memory). Use to persist observations, patterns, intermediate data between iterations.",
    parameters: {
      key: { type: "string", description: "Key to store under" },
      value: { type: "string", description: "Value to store (stringified)" },
    },
    required: ["key", "value"],
    costEstimateCents: 0,
  },
  async (args, context) => {
    context.scratchpad.set(args.key as string, args.value);
    return { stored: true, key: args.key };
  }
);

registerTool(
  {
    name: "scratchpad_read",
    description:
      "Read a value from the mission scratchpad by key. Returns null if key not found.",
    parameters: {
      key: { type: "string", description: "Key to read" },
    },
    required: ["key"],
    costEstimateCents: 0,
  },
  async (args, context) => {
    const value = context.scratchpad.get(args.key as string);
    return { key: args.key, value: value ?? null };
  }
);
