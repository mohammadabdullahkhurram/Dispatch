import { MessageSquare } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PortalChat } from "@/components/portal/chat-client";
import { getClientContext, getCurrentProfile } from "@/lib/data";
import type { ChatMessage, ChatThread } from "@/lib/types";

export const metadata = { title: "Chat Support" };

export default async function PortalChatPage() {
  const { supabase, profile } = await getCurrentProfile();
  const { client } = profile
    ? await getClientContext(supabase, profile)
    : { client: null };

  if (!profile || !client) {
    return (
      <div className="flex flex-1 flex-col p-6 md:p-8">
        <EmptyState
          icon={MessageSquare}
          title="No client account linked"
          description="Your login isn't linked to a client account yet. Contact your Bluejaypro account manager."
        />
      </div>
    );
  }

  const { data: thread } = await supabase
    .from("chat_threads")
    .select("*")
    .eq("client_id", client.id)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  let messages: ChatMessage[] = [];
  if (thread) {
    const { data } = await supabase
      .from("chat_messages")
      .select("*, sender:users(id, full_name, avatar_url)")
      .eq("thread_id", thread.id)
      .order("sent_at", { ascending: true });
    messages = (data ?? []) as ChatMessage[];
  }

  return (
    <PortalChat
      userId={profile.id}
      clientId={client.id}
      initialThread={(thread as ChatThread) ?? null}
      initialMessages={messages}
    />
  );
}
