import { TasksView } from "@/components/dashboard/tasks-view";
import { getCurrentProfile } from "@/lib/data";
import type { Client, Department, Task, UserProfile } from "@/lib/types";

export const metadata = { title: "Tasks" };

export default async function TasksPage() {
  const { supabase, profile } = await getCurrentProfile();

  const [tasks, teamMembers, departments, clients] = await Promise.all([
    supabase
      .from("tasks")
      .select(
        `*,
         client:clients(id, company_name),
         assignee:users!tasks_assigned_to_fkey(id, full_name, avatar_url),
         linked_ticket:tickets!tasks_linked_ticket_id_fkey(id, title)`
      )
      .order("created_at", { ascending: false }),
    supabase
      .from("users")
      .select("id, email, full_name, avatar_url, role, department_id, phone, created_at")
      .neq("role", "client")
      .order("full_name"),
    supabase.from("departments").select("*").order("name"),
    supabase.from("clients").select("id, company_name").order("company_name"),
  ]);

  return (
    <TasksView
      currentUser={profile!}
      initialTasks={(tasks.data ?? []) as Task[]}
      teamMembers={(teamMembers.data ?? []) as UserProfile[]}
      departments={(departments.data ?? []) as Department[]}
      clients={(clients.data ?? []) as Pick<Client, "id" | "company_name">[]}
    />
  );
}
