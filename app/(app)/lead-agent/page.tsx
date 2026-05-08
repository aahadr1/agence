import { redirect } from "next/navigation";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { ChatClient } from "./chat-client";
import { PageHeader } from "@/components/ui/page-header";

export const dynamic = "force-dynamic";

export default async function LeadAgentPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const svc = await createServiceClient();
  const { data: chats } = await svc
    .from("agent_chats")
    .select("id, opencode_session_id, title, created_at, last_message_at")
    .eq("user_id", user.id)
    .order("last_message_at", { ascending: false })
    .limit(50);

  return (
    <div className="animate-fade-in">
      <PageHeader
        eyebrow="Agent"
        title="Lead Agent"
        description="Ton agent personnel — recherche, qualifie et écrit les leads. Connecté à OpenCode sur le VPS, partagé avec Telegram."
      />
      <div className="mt-8">
        <ChatClient initialChats={chats ?? []} userEmail={user.email ?? ""} />
      </div>
    </div>
  );
}
