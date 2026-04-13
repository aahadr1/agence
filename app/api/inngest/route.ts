import { serve } from "inngest/next";
import { inngest } from "@/lib/inngest/client";
import { missionExecute } from "@/lib/inngest/functions/mission-execute";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [missionExecute],
});
