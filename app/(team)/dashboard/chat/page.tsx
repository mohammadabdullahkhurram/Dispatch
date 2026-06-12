import { ChatWorkspace } from "@/components/dashboard/chat-workspace";
import { getCurrentProfile } from "@/lib/data";
import type {
  CannedResponse,
  ChatThread,
  Client,
  UserProfile,
} from "@/lib/types";

export const metadata = { title: "Chat" };

export default async function TeamChatPage() {
  const { supabase, profile } = await getCurrentProfile();

  const [threads, canned, teamMembers, clients] = await Promise.all([
    supabase
      .from("chat_threads")
      .select("*, client:clients(id, company_name, contact_name, logo_url)")
      .order("last_message_at", { ascending: false, nullsFirst: false }),
    supabase.from("canned_responses").select("*").order("title"),
    supabase
      .from("users")
      .select("id, full_name, avatar_url")
      .neq("role", "client")
      .order("full_name"),
    supabase
      .from("clients")
      .select("id, company_name, logo_url")
      .eq("status", "active")
      .order("company_name"),
  ]);

  return (
    <ChatWorkspace
      currentUser={profile!}
      initialThreads={(threads.data ?? []) as ChatThread[]}
      cannedResponses={(canned.data ?? []) as CannedResponse[]}
      teamMembers={
        (teamMembers.data ?? []) as Pick<
          UserProfile,
          "id" | "full_name" | "avatar_url"
        >[]
      }
      clients={
        (clients.data ?? []) as Pick<
          Client,
          "id" | "company_name" | "logo_url"
        >[]
      }
    />
  );
}
