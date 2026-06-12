import { ListChecks } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PortalTasks } from "@/components/portal/tasks-client";
import { getClientContext, getCurrentProfile } from "@/lib/data";
import type { Task } from "@/lib/types";

export const metadata = { title: "Tasks" };

export default async function PortalTasksPage() {
  const { supabase, profile } = await getCurrentProfile();
  const { client } = profile
    ? await getClientContext(supabase, profile)
    : { client: null };

  if (!profile || !client) {
    return (
      <div className="flex flex-1 flex-col p-6 md:p-8">
        <EmptyState
          icon={ListChecks}
          title="No client account linked"
          description="Your login isn't linked to a client account yet. Contact your Bluejaypro account manager."
        />
      </div>
    );
  }

  // Read-only view — no descriptions or internal comments, just the
  // fields the client should see.
  const { data: tasks } = await supabase
    .from("tasks")
    .select(
      "id, title, status, priority, due_date, created_at, assignee:users!tasks_assigned_to_fkey(id, full_name, avatar_url)"
    )
    .eq("client_id", client.id)
    .order("due_date", { ascending: true, nullsFirst: false });

  return <PortalTasks initialTasks={(tasks ?? []) as unknown as Task[]} />;
}
