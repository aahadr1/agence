import { registerTool } from "../tool-registry";
import { createClient } from "@supabase/supabase-js";

registerTool(
  {
    name: "ask_user",
    description:
      "Ask the user a question when you need clarification or approval. The question will be shown in the chat with optional quick-reply buttons. The mission pauses until the user responds.",
    parameters: {
      question: { type: "string", description: "The question to ask" },
      options: {
        type: "string",
        description: "Comma-separated list of quick-reply options (e.g. 'Yes,No,Adjust')",
        required: false,
      },
    },
    required: ["question"],
    costEstimateCents: 0,
  },
  async (args, context) => {
    const db = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    const options = (args.options as string)
      ?.split(",")
      .map((o) => o.trim())
      .filter(Boolean);

    await db.from("mission_messages").insert({
      mission_id: context.missionId,
      role: "assistant",
      content: args.question as string,
      metadata: options?.length ? { options } : {},
    });

    await db
      .from("missions")
      .update({ status: "paused" })
      .eq("id", context.missionId);

    return {
      status: "paused",
      message: "Question sent to user. Mission paused until user responds.",
    };
  }
);
