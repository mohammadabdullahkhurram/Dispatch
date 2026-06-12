import { ClientsList } from "@/components/dashboard/clients-list";
import { getCurrentProfile } from "@/lib/data";
import type { Client, Department, UserRole } from "@/lib/types";

export const metadata = { title: "Clients" };

// Roles allowed to create clients.
const CREATOR_ROLES: UserRole[] = [
  "agency_owner",
  "agency_admin",
  "agency_manager",
  "department_head",
];

export default async function ClientsPage() {
  const { supabase, profile } = await getCurrentProfile();

  const [clients, departments, openTickets] = await Promise.all([
    supabase.from("clients").select("*").order("company_name"),
    supabase.from("departments").select("*").order("name"),
    supabase.from("tickets").select("client_id").neq("status", "resolved"),
  ]);

  const openCounts: Record<string, number> = {};
  for (const t of openTickets.data ?? []) {
    if (t.client_id) {
      openCounts[t.client_id] = (openCounts[t.client_id] ?? 0) + 1;
    }
  }

  return (
    <ClientsList
      clients={(clients.data ?? []) as Client[]}
      departments={(departments.data ?? []) as Department[]}
      openTicketCounts={openCounts}
      currentUserId={profile?.id ?? null}
      canCreate={!!profile && CREATOR_ROLES.includes(profile.role)}
    />
  );
}
