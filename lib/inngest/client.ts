import { Inngest } from "inngest";

export const inngest = new Inngest({
  id: "lead-agent",
  eventKey: process.env.INNGEST_EVENT_KEY,
});
