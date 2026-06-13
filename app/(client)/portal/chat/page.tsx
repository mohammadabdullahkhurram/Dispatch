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
    .eq("chat_type", "workspace")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!thread) {
    const { data: created } = await supabase
      .from("chat_threads")
      .insert({
        client_id: client.id,
        status: "active",
        category: "workspace",
        chat_type: "workspace",
        title: client.company_name,
        is_deletable: false,
      })
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

  // DMs + group chats this user participates in (RLS hides the rest;
  // sessions are never returned to the portal).
  const { data: sideThreads } = await supabase
    .from("chat_threads")
    .select("*")
    .in("chat_type", ["dm", "group"])
    .contains("participant_ids", [profile.id])
    .order("last_message_at", { ascending: false, nullsFirst: false });

  const side = (sideThreads ?? []) as ChatThread[];
  const dms = side.filter((t) => t.chat_type === "dm");
  const groups = side.filter((t) => t.chat_type === "group");

  // The Dispatch team — for resolving DM/group names and for the
  // "new DM" picker. (Clients may read team members per migration 011.)
  const { data: team } = await supabase
    .from("users")
    .select("id, full_name, avatar_url, last_seen")
    .neq("role", "client")
    .order("full_name");

  return (
    <PortalChat
      userId={profile.id}
      clientId={client.id}
      thread={thread as ChatThread}
      initialMessages={messages}
      dmThreads={dms}
      groupThreads={groups}
      team={team ?? []}
    />
  );
}
