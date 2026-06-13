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

  const [threads, canned, teamMembers, clients, directory, clientUsers] =
    await Promise.all([
      supabase
        .from("chat_threads")
        .select(
          `*,
           client:clients(id, company_name, contact_name, logo_url),
           poc:users!chat_threads_point_of_contact_id_fkey(id, full_name)`
        )
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
      // Everyone (team + client users) for DM names, group avatars, presence.
      supabase
        .from("users")
        .select("id, full_name, avatar_url, last_seen, role"),
      supabase.from("client_users").select("client_id, user_id, role"),
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
      directory={
        (directory.data ?? []) as {
          id: string;
          full_name: string;
          avatar_url: string | null;
          last_seen: string | null;
          role: string;
        }[]
      }
      clientUsers={
        (clientUsers.data ?? []) as {
          client_id: string;
          user_id: string;
          role: string;
        }[]
      }
    />
  );
}
