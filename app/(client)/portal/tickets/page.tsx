import { Ticket as TicketIcon } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PortalTickets } from "@/components/portal/tickets-client";
import { getClientForProfile, getCurrentProfile } from "@/lib/data";
import type { Ticket } from "@/lib/types";

export const metadata = { title: "My Tickets" };

export default async function PortalTicketsPage() {
  const { supabase, profile } = await getCurrentProfile();
  const client = profile ? await getClientForProfile(supabase, profile) : null;

  if (!profile || !client) {
    return (
      <div className="flex flex-1 flex-col p-6 md:p-8">
        <EmptyState
          icon={TicketIcon}
          title="No client account linked"
          description="Your login isn't linked to a client account yet. Contact your Bluejaypro account manager."
        />
      </div>
    );
  }

  const { data: tickets } = await supabase
    .from("tickets")
    .select("*")
    .eq("client_id", client.id)
    .order("created_at", { ascending: false });

  return (
    <PortalTickets
      userId={profile.id}
      clientId={client.id}
      initialTickets={(tickets ?? []) as Ticket[]}
    />
  );
}
