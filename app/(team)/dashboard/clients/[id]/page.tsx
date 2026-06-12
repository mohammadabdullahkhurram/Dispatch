import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  ExternalLink,
  FileText,
  FolderOpen,
  ListChecks,
  MessageSquare,
  Ticket as TicketIcon,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  CategoryBadge,
  OnboardingBadge,
  PriorityBadge,
  TaskStatusBadge,
  TicketStatusBadge,
} from "@/components/badges";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/empty-state";
import { UserAvatar } from "@/components/user-avatar";
import { ClientTeam } from "@/components/dashboard/client-team";
import { ClientStatusToggle } from "@/components/dashboard/client-status-toggle";
import { DeleteClientButton } from "@/components/dashboard/delete-client-button";
import { getCurrentProfile } from "@/lib/data";
import { formatDate, formatDateTime, shortId } from "@/lib/format";
import { isAgencyManagerRole } from "@/lib/types";
import type {
  ChatThread,
  ChecklistItem,
  Client,
  ClientDocument,
  ClientUser,
  Task,
  Ticket,
} from "@/lib/types";

export const metadata = { title: "Client" };

export default async function ClientProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { supabase, profile } = await getCurrentProfile();

  const { data: clientRow } = await supabase
    .from("clients")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (!clientRow) notFound();
  const client = clientRow as Client;

  const [tickets, tasks, threads, documents, checklist, clientUsers] =
    await Promise.all([
      supabase
        .from("tickets")
        .select("*, assignee:users!tickets_assigned_to_fkey(id, full_name, avatar_url)")
        .eq("client_id", id)
        .order("created_at", { ascending: false }),
      supabase
        .from("tasks")
        .select("*, assignee:users!tasks_assigned_to_fkey(id, full_name, avatar_url)")
        .eq("client_id", id)
        .order("created_at", { ascending: false }),
      supabase
        .from("chat_threads")
        .select("*")
        .eq("client_id", id)
        .order("last_message_at", { ascending: false, nullsFirst: false }),
      supabase
        .from("client_documents")
        .select("*")
        .eq("client_id", id)
        .order("created_at", { ascending: false }),
      supabase
        .from("client_checklist_items")
        .select("*")
        .eq("client_id", id)
        .order("created_at", { ascending: true }),
      supabase
        .from("client_users")
        .select("*, user:users(id, email, full_name, avatar_url, ghl_contact_id)")
        .eq("client_id", id)
        .order("created_at", { ascending: true }),
    ]);

  const ticketRows = (tickets.data ?? []) as Ticket[];
  const taskRows = (tasks.data ?? []) as Task[];
  const threadRows = (threads.data ?? []) as ChatThread[];
  const docRows = (documents.data ?? []) as ClientDocument[];
  const checklistRows = (checklist.data ?? []) as ChecklistItem[];
  const completed = checklistRows.filter((i) => i.completed).length;
  const brandColors = client.brand_colors ?? {};
  const brandFonts = client.brand_fonts ?? {};

  return (
    <div className="flex flex-1 flex-col gap-6 p-6 md:p-8">
      <Link
        href="/dashboard/clients"
        className="inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> All clients
      </Link>

      <header className="flex flex-wrap items-center gap-4">
        <UserAvatar
          name={client.company_name}
          avatarUrl={client.logo_url}
          className="size-14 text-base"
        />
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            {client.company_name}
          </h1>
          <p className="text-sm text-muted-foreground">
            {client.contact_name} · {client.email}
            {client.phone ? ` · ${client.phone}` : ""}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-3">
          {client.status === "inactive" && (
            <Badge
              variant="outline"
              className="border-red-500/30 bg-red-500/10 text-red-400"
            >
              Inactive
            </Badge>
          )}
          <OnboardingBadge status={client.onboarding_status} />
          {profile && isAgencyManagerRole(profile.role) && (
            <ClientStatusToggle
              clientId={client.id}
              companyName={client.company_name}
              status={client.status}
              currentUserId={profile.id}
            />
          )}
          {profile &&
            (profile.role === "agency_owner" ||
              profile.role === "agency_admin") && (
              <DeleteClientButton
                clientId={client.id}
                companyName={client.company_name}
                currentUserId={profile.id}
              />
            )}
        </div>
      </header>

      <Tabs defaultValue="overview" className="flex-1">
        <TabsList className="flex-wrap">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="team">Team</TabsTrigger>
          <TabsTrigger value="tickets">Tickets</TabsTrigger>
          <TabsTrigger value="tasks">Tasks</TabsTrigger>
          <TabsTrigger value="chat">Chat History</TabsTrigger>
          <TabsTrigger value="documents">Documents</TabsTrigger>
          <TabsTrigger value="checklist">Checklist</TabsTrigger>
          <TabsTrigger value="branding">Branding</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4 grid gap-4 sm:grid-cols-3">
          <Card>
            <CardContent>
              <p className="text-2xl font-semibold tabular-nums">
                {ticketRows.filter((t) => t.status !== "resolved").length}
              </p>
              <p className="text-sm text-muted-foreground">Open tickets</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent>
              <p className="text-2xl font-semibold tabular-nums">
                {taskRows.filter((t) => t.status !== "done").length}
              </p>
              <p className="text-sm text-muted-foreground">Open tasks</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent>
              <p className="text-2xl font-semibold tabular-nums">
                {checklistRows.length
                  ? Math.round((completed / checklistRows.length) * 100)
                  : 0}
                %
              </p>
              <p className="text-sm text-muted-foreground">Checklist complete</p>
            </CardContent>
          </Card>
          <Card className="sm:col-span-3">
            <CardHeader>
              <CardTitle className="text-base">Details</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <p className="text-xs text-muted-foreground">Client since</p>
                <p>{formatDate(client.created_at)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Drive folder</p>
                {client.google_drive_folder_url ? (
                  <a
                    href={client.google_drive_folder_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-primary hover:underline"
                  >
                    Open folder <ExternalLink className="size-3.5" />
                  </a>
                ) : (
                  <p>Not linked</p>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="team" className="mt-4">
          <ClientTeam
            clientId={id}
            initialMembers={(clientUsers.data ?? []) as ClientUser[]}
          />
        </TabsContent>

        <TabsContent value="tickets" className="mt-4">
          {ticketRows.length === 0 ? (
            <EmptyState icon={TicketIcon} title="No tickets" description="This client hasn't filed any tickets." />
          ) : (
            <div className="rounded-xl border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>ID</TableHead>
                    <TableHead>Title</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Priority</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Assignee</TableHead>
                    <TableHead>Created</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {ticketRows.map((t) => (
                    <TableRow key={t.id}>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {shortId(t.id)}
                      </TableCell>
                      <TableCell className="max-w-64 truncate font-medium">
                        <Link href="/dashboard/tickets" className="hover:text-primary">
                          {t.title}
                        </Link>
                      </TableCell>
                      <TableCell><CategoryBadge category={t.category} /></TableCell>
                      <TableCell><PriorityBadge priority={t.priority} /></TableCell>
                      <TableCell><TicketStatusBadge status={t.status} /></TableCell>
                      <TableCell>
                        {t.assignee ? (
                          <span className="flex items-center gap-2 text-sm">
                            <UserAvatar
                              name={t.assignee.full_name}
                              avatarUrl={t.assignee.avatar_url}
                              className="size-6"
                            />
                            {t.assignee.full_name}
                          </span>
                        ) : (
                          <span className="text-sm text-muted-foreground">Unassigned</span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {formatDate(t.created_at)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>

        <TabsContent value="tasks" className="mt-4">
          {taskRows.length === 0 ? (
            <EmptyState icon={ListChecks} title="No tasks" description="No tasks are linked to this client yet." />
          ) : (
            <div className="rounded-xl border border-border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Title</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Priority</TableHead>
                    <TableHead>Assignee</TableHead>
                    <TableHead>Due</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {taskRows.map((t) => (
                    <TableRow key={t.id}>
                      <TableCell className="max-w-72 truncate font-medium">{t.title}</TableCell>
                      <TableCell><TaskStatusBadge status={t.status} /></TableCell>
                      <TableCell><PriorityBadge priority={t.priority} /></TableCell>
                      <TableCell>
                        {t.assignee ? (
                          <span className="flex items-center gap-2 text-sm">
                            <UserAvatar
                              name={t.assignee.full_name}
                              avatarUrl={t.assignee.avatar_url}
                              className="size-6"
                            />
                            {t.assignee.full_name}
                          </span>
                        ) : (
                          <span className="text-sm text-muted-foreground">Unassigned</span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {formatDate(t.due_date)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>

        <TabsContent value="chat" className="mt-4">
          {threadRows.length === 0 ? (
            <EmptyState icon={MessageSquare} title="No conversations" description="Chat threads with this client will appear here." />
          ) : (
            <ul className="space-y-2">
              {threadRows.map((thread) => (
                <li key={thread.id}>
                  <Link
                    href="/dashboard/chat"
                    className="flex items-center gap-3 rounded-lg border border-border p-3 transition-colors hover:border-primary/50"
                  >
                    <MessageSquare className="size-5 text-primary" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">
                        {thread.category ?? "General"} conversation
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Opened {formatDate(thread.created_at)} · last message{" "}
                        {formatDateTime(thread.last_message_at)}
                      </p>
                    </div>
                    <span
                      className={
                        thread.status === "active"
                          ? "text-xs font-medium text-emerald-400"
                          : "text-xs text-muted-foreground"
                      }
                    >
                      {thread.status === "active" ? "Active" : "Closed"}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </TabsContent>

        <TabsContent value="documents" className="mt-4 space-y-3">
          {client.google_drive_folder_url && (
            <a
              href={client.google_drive_folder_url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-3 rounded-lg border border-border p-3 transition-colors hover:border-primary/50"
            >
              <FolderOpen className="size-5 text-primary" />
              <p className="flex-1 text-sm font-medium">Shared Drive folder</p>
              <ExternalLink className="size-4 text-muted-foreground" />
            </a>
          )}
          {docRows.length === 0 && !client.google_drive_folder_url ? (
            <EmptyState icon={FileText} title="No documents" description="Documents shared with this client will appear here." />
          ) : (
            <ul className="space-y-2">
              {docRows.map((doc) => (
                <li key={doc.id}>
                  <a
                    href={doc.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-3 rounded-lg border border-border p-3 transition-colors hover:border-primary/50"
                  >
                    <FileText className="size-5 text-primary" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{doc.title}</p>
                      {doc.description && (
                        <p className="truncate text-xs text-muted-foreground">
                          {doc.description}
                        </p>
                      )}
                    </div>
                    <ExternalLink className="size-4 text-muted-foreground" />
                  </a>
                </li>
              ))}
            </ul>
          )}
        </TabsContent>

        <TabsContent value="checklist" className="mt-4">
          {checklistRows.length === 0 ? (
            <EmptyState icon={ListChecks} title="No checklist" description="This client's onboarding checklist hasn't been created yet." />
          ) : (
            <ul className="divide-y divide-border rounded-xl border border-border px-4">
              {checklistRows.map((item) => (
                <li key={item.id} className="flex items-center gap-3 py-3">
                  <span
                    className={`size-2.5 shrink-0 rounded-full ${
                      item.completed ? "bg-emerald-400" : "bg-muted-foreground/40"
                    }`}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{item.item_name}</p>
                    {item.description && (
                      <p className="text-xs text-muted-foreground">{item.description}</p>
                    )}
                  </div>
                  {item.file_url && (
                    <a
                      href={item.file_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-primary hover:underline"
                    >
                      File
                    </a>
                  )}
                  <span className="text-xs text-muted-foreground">
                    {item.completed
                      ? `Done ${formatDate(item.completed_at)}`
                      : "Pending"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </TabsContent>

        <TabsContent value="branding" className="mt-4">
          <Card className="max-w-2xl">
            <CardContent className="space-y-6">
              <div className="space-y-2">
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Logo</p>
                {client.logo_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={client.logo_url}
                    alt={`${client.company_name} logo`}
                    className="h-20 w-auto rounded-lg border border-border bg-white/5 p-2"
                  />
                ) : (
                  <p className="text-sm text-muted-foreground">No logo on file.</p>
                )}
              </div>
              <div className="space-y-2">
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Colors</p>
                {Object.keys(brandColors).length === 0 ? (
                  <p className="text-sm text-muted-foreground">No brand colors on file.</p>
                ) : (
                  <div className="flex flex-wrap gap-3">
                    {Object.entries(brandColors).map(([name, hex]) => (
                      <div key={name} className="text-center">
                        <span
                          className="block size-12 rounded-lg border border-border"
                          style={{ backgroundColor: String(hex) }}
                        />
                        <p className="mt-1 text-xs capitalize">{name}</p>
                        <p className="font-mono text-[10px] text-muted-foreground">{String(hex)}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="space-y-2">
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Fonts</p>
                {Object.keys(brandFonts).length === 0 ? (
                  <p className="text-sm text-muted-foreground">No brand fonts on file.</p>
                ) : (
                  <ul className="space-y-1 text-sm">
                    {Object.entries(brandFonts).map(([usage, font]) => (
                      <li key={usage}>
                        <span className="capitalize text-muted-foreground">{usage}:</span>{" "}
                        <span className="font-medium">{String(font)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
