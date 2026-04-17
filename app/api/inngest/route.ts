import { serve } from "inngest/next";
import { inngest } from "@/lib/inngest/client";
import { missionExecute } from "@/lib/inngest/functions/mission-execute";
import {
  sessionStart,
  sessionContinue,
  approvalResponded,
} from "@/lib/inngest/functions/session-run";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [missionExecute, sessionStart, sessionContinue, approvalResponded],
});
