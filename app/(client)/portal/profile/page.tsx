import { UserCircle } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PortalProfile } from "@/components/portal/profile-client";
import { getClientContext, getCurrentProfile } from "@/lib/data";
import {
  isClientAdminRole,
  type ChecklistItem,
  type ClientDocument,
  type ClientUser,
} from "@/lib/types";

export const metadata = { title: "Profile" };

export default async function PortalProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab } = await searchParams;
  const { supabase, profile } = await getCurrentProfile();
  const { client, clientRole } = profile
    ? await getClientContext(supabase, profile)
    : { client: null, clientRole: null };

  if (!profile || !client) {
    return (
      <div className="flex flex-1 flex-col p-6 md:p-8">
        <EmptyState
          icon={UserCircle}
          title="No client account linked"
          description="Your login isn't linked to a client account yet. Contact your Bluejaypro account manager."
        />
      </div>
    );
  }

  const fullAccess = isClientAdminRole(clientRole);

  const [checklist, documents, roster] = await Promise.all([
    fullAccess
      ? supabase
          .from("client_checklist_items")
          .select("*")
          .eq("client_id", client.id)
          .order("created_at", { ascending: true })
      : Promise.resolve({ data: [] }),
    fullAccess
      ? supabase
          .from("client_documents")
          .select("*")
          .eq("client_id", client.id)
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [] }),
    fullAccess
      ? supabase
          .from("client_users")
          .select("*, user:users(id, email, full_name, avatar_url, ghl_contact_id)")
          .eq("client_id", client.id)
          .order("created_at", { ascending: true })
      : Promise.resolve({ data: [] }),
  ]);

  return (
    <PortalProfile
      userId={profile.id}
      profile={profile}
      client={client}
      fullAccess={fullAccess}
      teamMembers={(roster.data ?? []) as ClientUser[]}
      initialChecklist={(checklist.data ?? []) as ChecklistItem[]}
      documents={(documents.data ?? []) as ClientDocument[]}
      initialTab={tab}
    />
  );
}
