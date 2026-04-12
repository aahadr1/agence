import { MessagesClient } from "../messages-client";

export default async function MessagesPage({
  params,
}: {
  params: Promise<{ conversationId?: string[] }>;
}) {
  const p = await params;
  const id = p.conversationId?.[0];
  return <MessagesClient conversationId={id} />;
}
