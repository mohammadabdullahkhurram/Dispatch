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

  // The portal chats in the persistent workspace thread.
  let { data: thread } = await supabase
    .from("chat_threads")
    .select("*")
    .eq("client_id", client.id)
    .eq("category", "workspace")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!thread) {
    const { data: created } = await supabase
      .from("chat_threads")
      .insert({ client_id: client.id, status: "active", category: "workspace" })
      .select("*")
      .single();
    thread = created;
  }

  let messages: ChatMessage[] = [];
  if (thread) {
    const { data } = await supabase
      .from("chat_messages")
      .select("*, sender:users(id, full_name, avatar_url)")
      .eq("thread_id", thread.id)
      .order("sent_at", { ascending: true });
    messages = (data ?? []) as ChatMessage[];
  }

  // Direct messages this user is a participant of (RLS hides the rest).
  const { data: dmThreads } = await supabase
    .from("chat_threads")
    .select("*")
    .eq("category", "dm")
    .contains("participant_ids", [profile.id])
    .order("last_message_at", { ascending: false, nullsFirst: false });

  // Resolve the team member on the other side of each DM for labels.
  const dms = (dmThreads ?? []) as ChatThread[];
  const otherIds = [
    ...new Set(
      dms
        .flatMap((t) => t.participant_ids ?? [])
        .filter((uid) => uid !== profile.id)
    ),
  ];
  const { data: others } = otherIds.length
    ? await supabase
        .from("users")
        .select("id, full_name, avatar_url")
        .in("id", otherIds)
    : { data: [] };

  return (
    <PortalChat
      userId={profile.id}
      thread={thread as ChatThread}
      initialMessages={messages}
      dmThreads={dms}
      dmContacts={others ?? []}
    />
  );
}
