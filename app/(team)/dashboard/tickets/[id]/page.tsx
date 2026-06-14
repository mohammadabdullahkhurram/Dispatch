import { TicketsBoard } from "@/components/dashboard/tickets-board";
import { getCurrentProfile } from "@/lib/data";
import type { Client, Department, Ticket, UserProfile } from "@/lib/types";

export const metadata = { title: "Ticket" };

/**
 * Deep link to a single ticket (e.g. from a call_log card). Renders the
 * full board with that ticket's detail panel open.
 */
export default async function TicketDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { supabase, profile } = await getCurrentProfile();

  const [tickets, teamMembers, departments, clients] = await Promise.all([
    supabase
      .from("tickets")
      .select(
        `*,
         client:clients(id, company_name, logo_url),
         assignee:users!tickets_assigned_to_fkey(id, full_name, avatar_url),
         department:departments(id, name)`
      )
      .order("created_at", { ascending: false }),
    supabase
      .from("users")
      .select("id, email, full_name, avatar_url, role, department_id, phone, created_at")
      .neq("role", "client")
      .order("full_name"),
    supabase.from("departments").select("*").order("name"),
    supabase.from("clients").select("id, company_name, logo_url").order("company_name"),
  ]);

  return (
    <TicketsBoard
      currentUser={profile!}
      initialTickets={(tickets.data ?? []) as Ticket[]}
      teamMembers={(teamMembers.data ?? []) as UserProfile[]}
      departments={(departments.data ?? []) as Department[]}
      clients={(clients.data ?? []) as Pick<Client, "id" | "company_name" | "logo_url">[]}
      openTicketId={id}
    />
  );
}
