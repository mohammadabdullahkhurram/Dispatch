import Link from "next/link";
import {
  Activity,
  AlertCircle,
  Building2,
  ListChecks,
  MessagesSquare,
  Ticket as TicketIcon,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { TaskStatusBadge, PriorityBadge } from "@/components/badges";
import { EmptyState } from "@/components/empty-state";
import { UserAvatar } from "@/components/user-avatar";
import { getCurrentProfile } from "@/lib/data";
import { formatDate, isDueToday, isOverdue, timeAgo } from "@/lib/format";
import type { AuditLog, Task } from "@/lib/types";

export const metadata = { title: "Overview" };

const QUICK_LINKS = [
  { href: "/dashboard/clients", label: "Clients", icon: Building2 },
  { href: "/dashboard/tickets", label: "Tickets", icon: TicketIcon },
  { href: "/dashboard/tasks", label: "Tasks", icon: ListChecks },
  { href: "/dashboard/chat", label: "Chat", icon: MessagesSquare },
];

function StatCard({
  label,
  value,
  icon: Icon,
  href,
  alert,
}: {
  label: string;
  value: number;
  icon: typeof TicketIcon;
  href: string;
  alert?: boolean;
}) {
  return (
    <Link href={href}>
      <Card className="transition-colors hover:border-primary/40">
        <CardContent className="flex items-center gap-4">
          <span
            className={`flex size-10 items-center justify-center rounded-lg ${
              alert && value > 0 ? "bg-red-500/15" : "bg-primary/15"
            }`}
          >
            <Icon
              className={`size-5 ${alert && value > 0 ? "text-red-400" : "text-primary"}`}
            />
          </span>
          <div>
            <p className="text-2xl font-semibold tabular-nums">{value}</p>
            <p className="text-sm text-muted-foreground">{label}</p>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

export default async function DashboardPage() {
  const { supabase, profile } = await getCurrentProfile();
  const nowIso = new Date().toISOString();
  const endOfToday = new Date();
  endOfToday.setHours(23, 59, 59, 999);

  const [openTickets, activeChats, overdueTasks, totalClients, recentActivity, myTasks] =
    await Promise.all([
      supabase
        .from("tickets")
        .select("id", { count: "exact", head: true })
        .neq("status", "resolved"),
      supabase
        .from("chat_threads")
        .select("id", { count: "exact", head: true })
        .eq("status", "active"),
      supabase
        .from("tasks")
        .select("id", { count: "exact", head: true })
        .neq("status", "done")
        .lt("due_date", nowIso),
      supabase.from("clients").select("id", { count: "exact", head: true }),
      supabase
        .from("audit_logs")
        .select("*, user:users(id, full_name, avatar_url)")
        .order("created_at", { ascending: false })
        .limit(10),
      profile
        ? supabase
            .from("tasks")
            .select("*, client:clients(id, company_name)")
            .eq("assigned_to", profile.id)
            .neq("status", "done")
            .lte("due_date", endOfToday.toISOString())
            .order("due_date", { ascending: true })
            .limit(8)
        : Promise.resolve({ data: [] }),
    ]);

  const activity = (recentActivity.data ?? []) as AuditLog[];
  const tasks = (myTasks.data ?? []) as Task[];

  return (
    <div className="flex flex-1 flex-col gap-6 p-6 md:p-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          {profile ? `Good to see you, ${profile.full_name.split(" ")[0]}` : "Overview"}
        </h1>
        <p className="text-sm text-muted-foreground">
          The agency pulse — tickets, chats, tasks, and clients at a glance.
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Open tickets"
          value={openTickets.count ?? 0}
          icon={TicketIcon}
          href="/dashboard/tickets"
        />
        <StatCard
          label="Active chats"
          value={activeChats.count ?? 0}
          icon={MessagesSquare}
          href="/dashboard/chat"
        />
        <StatCard
          label="Overdue tasks"
          value={overdueTasks.count ?? 0}
          icon={AlertCircle}
          href="/dashboard/tasks"
          alert
        />
        <StatCard
          label="Total clients"
          value={totalClients.count ?? 0}
          icon={Building2}
          href="/dashboard/clients"
        />
      </div>

      <div className="grid flex-1 gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle className="text-base">Recent activity</CardTitle>
          </CardHeader>
          <CardContent>
            {activity.length === 0 ? (
              <EmptyState
                icon={Activity}
                title="No activity yet"
                description="Audit log entries will stream in here as the team works."
              />
            ) : (
              <ul className="space-y-4">
                {activity.map((entry) => (
                  <li key={entry.id} className="flex items-start gap-3">
                    <UserAvatar
                      name={entry.user?.full_name ?? "System"}
                      avatarUrl={entry.user?.avatar_url}
                      className="mt-0.5 size-7"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm">
                        <span className="font-medium">
                          {entry.user?.full_name ?? "System"}
                        </span>{" "}
                        <span className="text-muted-foreground">
                          {entry.action.replaceAll("_", " ")}
                        </span>{" "}
                        <span className="text-muted-foreground">
                          · {entry.entity_type}
                        </span>
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {timeAgo(entry.created_at)}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <div className="flex flex-col gap-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">My tasks — today & overdue</CardTitle>
            </CardHeader>
            <CardContent>
              {tasks.length === 0 ? (
                <p className="py-4 text-center text-sm text-muted-foreground">
                  Nothing due today. Nice.
                </p>
              ) : (
                <ul className="space-y-3">
                  {tasks.map((task) => (
                    <li key={task.id}>
                      <Link
                        href="/dashboard/tasks"
                        className="flex items-center gap-2 rounded-md p-1.5 transition-colors hover:bg-accent/50"
                      >
                        <span className="min-w-0 flex-1 truncate text-sm font-medium">
                          {task.title}
                        </span>
                        <PriorityBadge priority={task.priority} />
                        <TaskStatusBadge status={task.status} />
                        <span
                          className={
                            isOverdue(task.due_date)
                              ? "text-xs font-medium text-red-400"
                              : isDueToday(task.due_date)
                                ? "text-xs text-orange-400"
                                : "text-xs text-muted-foreground"
                          }
                        >
                          {formatDate(task.due_date)}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Quick links</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-3">
              {QUICK_LINKS.map(({ href, label, icon: Icon }) => (
                <Link
                  key={href}
                  href={href}
                  className="flex items-center gap-2.5 rounded-lg border border-border p-3 text-sm font-medium transition-colors hover:border-primary/40 hover:bg-accent/50"
                >
                  <Icon className="size-4 text-primary" />
                  {label}
                </Link>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
