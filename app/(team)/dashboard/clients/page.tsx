import { createClient } from "@/lib/supabase/server";
import { ClientsList } from "@/components/dashboard/clients-list";
import type { Client, Department } from "@/lib/types";

export const metadata = { title: "Clients" };

export default async function ClientsPage() {
  const supabase = await createClient();

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
    />
  );
}
