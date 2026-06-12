import { Ticket as TicketIcon } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PortalTickets } from "@/components/portal/tickets-client";
import { getClientContext, getCurrentProfile } from "@/lib/data";
import { isClientAdminRole, type Ticket } from "@/lib/types";

export const metadata = { title: "My Tickets" };

export default async function PortalTicketsPage() {
  const { supabase, profile } = await getCurrentProfile();
  const { client, clientRole } = profile
    ? await getClientContext(supabase, profile)
    : { client: null, clientRole: null };

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

  // office_member / contractor have no billing visibility.
  const allowBilling = isClientAdminRole(clientRole);

  let query = supabase
    .from("tickets")
    .select("*")
    .eq("client_id", client.id)
    .order("created_at", { ascending: false });
  if (!allowBilling) query = query.neq("category", "billing");

  const { data: tickets } = await query;

  return (
    <PortalTickets
      userId={profile.id}
      clientId={client.id}
      allowBilling={allowBilling}
      initialTickets={(tickets ?? []) as Ticket[]}
    />
  );
}
