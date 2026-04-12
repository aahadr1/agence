import { createServiceClient } from "@/lib/supabase/server";

export async function notifyUser(input: {
  orgId: string;
  userId: string;
  type: string;
  title: string;
  body?: string;
  payload?: Record<string, unknown>;
}) {
  const supabase = await createServiceClient();
  await supabase.from("notifications").insert({
    org_id: input.orgId,
    user_id: input.userId,
    type: input.type,
    title: input.title,
    body: input.body ?? null,
    payload: input.payload ?? {},
  });
}
