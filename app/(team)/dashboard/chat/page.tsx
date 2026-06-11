import { ChatWorkspace } from "@/components/dashboard/chat-workspace";
import { getCurrentProfile } from "@/lib/data";
import type { CannedResponse, ChatThread } from "@/lib/types";

export const metadata = { title: "Chat" };

export default async function TeamChatPage() {
  const { supabase, profile } = await getCurrentProfile();

  const [threads, canned] = await Promise.all([
    supabase
      .from("chat_threads")
      .select("*, client:clients(id, company_name, logo_url)")
      .order("last_message_at", { ascending: false, nullsFirst: false }),
    supabase.from("canned_responses").select("*").order("title"),
  ]);

  return (
    <ChatWorkspace
      currentUser={profile!}
      initialThreads={(threads.data ?? []) as ChatThread[]}
      cannedResponses={(canned.data ?? []) as CannedResponse[]}
    />
  );
}
