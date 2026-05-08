import { Inngest } from "inngest";

export const inngest = new Inngest({
  id: "agence",
  eventKey: process.env.INNGEST_EVENT_KEY,
});
