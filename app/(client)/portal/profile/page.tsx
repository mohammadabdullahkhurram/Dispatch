import { UserCircle } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PortalProfile } from "@/components/portal/profile-client";
import { getClientForProfile, getCurrentProfile } from "@/lib/data";
import type { ChecklistItem, ClientDocument } from "@/lib/types";

export const metadata = { title: "Profile" };

export default async function PortalProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab } = await searchParams;
  const { supabase, profile } = await getCurrentProfile();
  const client = profile ? await getClientForProfile(supabase, profile) : null;

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

  const [checklist, documents] = await Promise.all([
    supabase
      .from("client_checklist_items")
      .select("*")
      .eq("client_id", client.id)
      .order("created_at", { ascending: true }),
    supabase
      .from("client_documents")
      .select("*")
      .eq("client_id", client.id)
      .order("created_at", { ascending: false }),
  ]);

  return (
    <PortalProfile
      userId={profile.id}
      client={client}
      initialChecklist={(checklist.data ?? []) as ChecklistItem[]}
      documents={(documents.data ?? []) as ClientDocument[]}
      initialTab={tab}
    />
  );
}
