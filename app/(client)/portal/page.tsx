import Link from "next/link";
import {
  CheckCircle2,
  MessageSquare,
  MessagesSquare,
  Plus,
  Ticket as TicketIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  CategoryBadge,
  PriorityBadge,
  TicketStatusBadge,
  ONBOARDING_LABELS,
} from "@/components/badges";
import { EmptyState } from "@/components/empty-state";
import { getClientContext, getCurrentProfile } from "@/lib/data";
import { formatDate } from "@/lib/format";
import { isClientAdminRole, type Ticket } from "@/lib/types";

export const metadata = { title: "Overview" };

function StatCard({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string | number;
  icon: typeof TicketIcon;
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-4">
        <span className="flex size-10 items-center justify-center rounded-lg bg-primary/15">
          <Icon className="size-5 text-primary" />
        </span>
        <div>
          <p className="text-2xl font-semibold tabular-nums">{value}</p>
          <p className="text-sm text-muted-foreground">{label}</p>
        </div>
      </CardContent>
    </Card>
  );
}

export default async function PortalOverviewPage() {
  const { supabase, profile } = await getCurrentProfile();
  const { client, clientRole } = profile
    ? await getClientContext(supabase, profile)
    : { client: null, clientRole: null };

  if (!client) {
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

  // office_member / contractor: tickets, tasks, chat only — no
  // checklist/onboarding, and billing tickets are hidden.
  const fullAccess = isClientAdminRole(clientRole);

  let openTicketsQuery = supabase
    .from("tickets")
    .select("id", { count: "exact", head: true })
    .eq("client_id", client.id)
    .neq("status", "resolved");
  let recentTicketsQuery = supabase
    .from("tickets")
    .select("*")
    .eq("client_id", client.id)
    .order("created_at", { ascending: false })
    .limit(5);

  if (!fullAccess) {
    openTicketsQuery = openTicketsQuery.neq("category", "billing");
    recentTicketsQuery = recentTicketsQuery.neq("category", "billing");
  }

  const [openTickets, checklist, activeThreads, recentTickets] =
    await Promise.all([
      openTicketsQuery,
      fullAccess
        ? supabase
            .from("client_checklist_items")
            .select("id, completed")
            .eq("client_id", client.id)
        : Promise.resolve({ data: [] }),
      supabase
        .from("chat_threads")
        .select("id", { count: "exact", head: true })
        .eq("client_id", client.id)
        .eq("status", "active"),
      recentTicketsQuery,
    ]);

  const checklistItems = checklist.data ?? [];
  const checklistPct = checklistItems.length
    ? Math.round(
        (checklistItems.filter((i) => i.completed).length /
          checklistItems.length) *
          100
      )
    : 0;
  const tickets = (recentTickets.data ?? []) as Ticket[];

  return (
    <div className="flex flex-1 flex-col gap-6 p-6 md:p-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            Welcome, {client.company_name}
          </h1>
          <p className="text-sm text-muted-foreground">
            Here&apos;s what&apos;s happening with your account.
          </p>
        </div>
        <div className="flex gap-2">
          <Button asChild>
            <Link href="/portal/tickets">
              <Plus className="size-4" /> Submit Ticket
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/portal/chat">
              <MessageSquare className="size-4" /> Start Chat
            </Link>
          </Button>
        </div>
      </header>

      <div className={`grid gap-4 ${fullAccess ? "sm:grid-cols-3" : "sm:grid-cols-2"}`}>
        <StatCard
          label="Open tickets"
          value={openTickets.count ?? 0}
          icon={TicketIcon}
        />
        {fullAccess && (
          <StatCard
            label="Checklist complete"
            value={`${checklistPct}%`}
            icon={CheckCircle2}
          />
        )}
        <StatCard
          label="Active chat threads"
          value={activeThreads.count ?? 0}
          icon={MessagesSquare}
        />
      </div>

      {fullAccess && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Onboarding — {ONBOARDING_LABELS[client.onboarding_status]}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <Progress value={checklistPct} />
            <p className="text-sm text-muted-foreground">
              {checklistPct}% of your onboarding checklist is complete.{" "}
              <Link
                href="/portal/profile?tab=checklist"
                className="text-primary hover:underline"
              >
                View checklist
              </Link>
            </p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent tickets</CardTitle>
        </CardHeader>
        <CardContent>
          {tickets.length === 0 ? (
            <EmptyState
              icon={TicketIcon}
              title="No tickets yet"
              description="Submit your first ticket and we'll get right on it."
              action={
                <Button asChild size="sm">
                  <Link href="/portal/tickets">Submit a ticket</Link>
                </Button>
              }
            />
          ) : (
            <ul className="divide-y divide-border">
              {tickets.map((t) => (
                <li key={t.id}>
                  <Link
                    href="/portal/tickets"
                    className="flex flex-wrap items-center gap-3 py-3 transition-colors hover:bg-accent/40"
                  >
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">
                      {t.title}
                    </span>
                    <CategoryBadge category={t.category} />
                    <PriorityBadge priority={t.priority} />
                    <TicketStatusBadge status={t.status} />
                    <span className="text-xs text-muted-foreground">
                      {formatDate(t.created_at)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
