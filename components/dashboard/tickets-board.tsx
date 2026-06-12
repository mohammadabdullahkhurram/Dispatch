"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowUpRight,
  CheckCircle2,
  Plus,
  Ticket as TicketIcon,
  UserPlus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import {
  CategoryBadge,
  PriorityBadge,
  TicketStatusBadge,
  TICKET_STATUS_LABELS,
} from "@/components/badges";
import { EmptyState } from "@/components/empty-state";
import { SlaCountdown } from "@/components/sla-countdown";
import { UserAvatar } from "@/components/user-avatar";
import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { logAudit, logTicketActivity } from "@/lib/audit";
import { formatDateTime, shortId, timeAgo } from "@/lib/format";
import type {
  Client,
  Department,
  Priority,
  Ticket,
  TicketActivity,
  TicketCategory,
  TicketStatus,
  UserProfile,
} from "@/lib/types";

const COLUMNS: TicketStatus[] = ["open", "in_progress", "escalated", "resolved"];
const ALL = "all";

const PRIORITY_BORDER: Record<Priority, string> = {
  urgent: "border-l-red-500",
  high: "border-l-orange-500",
  medium: "border-l-yellow-500",
  low: "border-l-slate-500",
};

type ClientOption = Pick<Client, "id" | "company_name" | "logo_url">;

export function TicketsBoard({
  currentUser,
  initialTickets,
  teamMembers,
  departments,
  clients,
}: {
  currentUser: UserProfile;
  initialTickets: Ticket[];
  teamMembers: UserProfile[];
  departments: Department[];
  clients: ClientOption[];
}) {
  const [tickets, setTickets] = useState(initialTickets);
  const [selected, setSelected] = useState<Ticket | null>(null);
  const [activity, setActivity] = useState<TicketActivity[]>([]);
  const [note, setNote] = useState("");
  const [resolutionNotes, setResolutionNotes] = useState("");
  const [resolving, setResolving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // filters
  const [filterDept, setFilterDept] = useState(ALL);
  const [filterCategory, setFilterCategory] = useState(ALL);
  const [filterPriority, setFilterPriority] = useState(ALL);
  const [filterAssignee, setFilterAssignee] = useState(ALL);

  // create dialog
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState({
    title: "",
    description: "",
    category: "general" as TicketCategory,
    priority: "medium" as Priority,
    client_id: "",
    department_id: "",
    assigned_to: "",
  });

  const memberById = useMemo(
    () => Object.fromEntries(teamMembers.map((m) => [m.id, m])),
    [teamMembers]
  );

  useEffect(() => {
    if (!selected) return;
    const supabase = createClient();
    supabase
      .from("ticket_activity_log")
      .select("*, user:users(id, full_name, avatar_url)")
      .eq("ticket_id", selected.id)
      .order("created_at", { ascending: true })
      .then(({ data }) => setActivity((data ?? []) as TicketActivity[]));
  }, [selected]);

  const filtered = useMemo(
    () =>
      tickets.filter(
        (t) =>
          (filterDept === ALL || t.department_id === filterDept) &&
          (filterCategory === ALL || t.category === filterCategory) &&
          (filterPriority === ALL || t.priority === filterPriority) &&
          (filterAssignee === ALL ||
            (filterAssignee === "unassigned"
              ? !t.assigned_to
              : t.assigned_to === filterAssignee))
      ),
    [tickets, filterDept, filterCategory, filterPriority, filterAssignee]
  );

  function applyLocal(id: string, patch: Partial<Ticket>) {
    setTickets((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
    setSelected((prev) => (prev && prev.id === id ? { ...prev, ...patch } : prev));
  }

  async function updateTicket(
    ticket: Ticket,
    patch: Partial<Ticket>,
    action: string,
    oldValue?: string | null,
    newValue?: string | null
  ) {
    setActionError(null);
    const supabase = createClient();
    const { error } = await supabase.from("tickets").update(patch).eq("id", ticket.id);
    if (error) {
      setActionError(error.message);
      return false;
    }
    applyLocal(ticket.id, patch);
    await Promise.all([
      logTicketActivity(supabase, {
        ticketId: ticket.id,
        userId: currentUser.id,
        action,
        oldValue,
        newValue,
      }),
      logAudit(supabase, {
        userId: currentUser.id,
        entityType: "ticket",
        entityId: ticket.id,
        action: `ticket_${action}`,
        details: patch as Record<string, unknown>,
      }),
    ]);
    // refresh activity feed
    const { data } = await supabase
      .from("ticket_activity_log")
      .select("*, user:users(id, full_name, avatar_url)")
      .eq("ticket_id", ticket.id)
      .order("created_at", { ascending: true });
    setActivity((data ?? []) as TicketActivity[]);
    return true;
  }

  async function changeStatus(ticket: Ticket, status: TicketStatus) {
    await updateTicket(
      ticket,
      { status },
      "status_changed",
      TICKET_STATUS_LABELS[ticket.status],
      TICKET_STATUS_LABELS[status]
    );
  }

  async function assign(ticket: Ticket, userId: string | null) {
    const assignee = userId ? memberById[userId] : null;
    await updateTicket(
      ticket,
      {
        assigned_to: userId,
        assignee: assignee
          ? { id: assignee.id, full_name: assignee.full_name, avatar_url: assignee.avatar_url }
          : null,
      },
      "assigned",
      ticket.assignee?.full_name ?? "Unassigned",
      assignee?.full_name ?? "Unassigned"
    );
  }

  async function addNote(ticket: Ticket) {
    if (!note.trim()) return;
    const supabase = createClient();
    await logTicketActivity(supabase, {
      ticketId: ticket.id,
      userId: currentUser.id,
      action: "note_added",
      newValue: note.trim(),
    });
    setNote("");
    const { data } = await supabase
      .from("ticket_activity_log")
      .select("*, user:users(id, full_name, avatar_url)")
      .eq("ticket_id", ticket.id)
      .order("created_at", { ascending: true });
    setActivity((data ?? []) as TicketActivity[]);
  }

  async function resolve(ticket: Ticket) {
    setResolving(true);
    const ok = await updateTicket(
      ticket,
      {
        status: "resolved",
        resolved_at: new Date().toISOString(),
        resolution_notes: resolutionNotes.trim() || null,
      },
      "resolved",
      TICKET_STATUS_LABELS[ticket.status],
      "Resolved"
    );
    if (ok) setResolutionNotes("");
    setResolving(false);
  }

  async function createTicket(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setActionError(null);
    const supabase = createClient();
    const { data: ticket, error } = await supabase
      .from("tickets")
      .insert({
        title: draft.title,
        description: draft.description || null,
        category: draft.category,
        priority: draft.priority,
        client_id: draft.client_id || null,
        department_id: draft.department_id || null,
        assigned_to: draft.assigned_to || null,
        created_by: currentUser.id,
        source: "internal",
      })
      .select(
        `*,
         client:clients(id, company_name, logo_url),
         assignee:users!tickets_assigned_to_fkey(id, full_name, avatar_url),
         department:departments(id, name)`
      )
      .single();

    if (error || !ticket) {
      setActionError(error?.message ?? "Failed to create ticket.");
      setCreating(false);
      return;
    }

    await Promise.all([
      logTicketActivity(supabase, {
        ticketId: ticket.id,
        userId: currentUser.id,
        action: "created",
        newValue: draft.title,
      }),
      logAudit(supabase, {
        userId: currentUser.id,
        entityType: "ticket",
        entityId: ticket.id,
        action: "ticket_created",
        details: { title: draft.title, source: "internal" },
      }),
    ]);

    setTickets((prev) => [ticket as Ticket, ...prev]);
    setDraft({
      title: "",
      description: "",
      category: "general",
      priority: "medium",
      client_id: "",
      department_id: "",
      assigned_to: "",
    });
    setCreateOpen(false);
    setCreating(false);
  }

  return (
    <div className="flex flex-1 flex-col gap-5 p-6 md:p-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Tickets</h1>
          <p className="text-sm text-muted-foreground">
            {filtered.filter((t) => t.status !== "resolved").length} open across the agency.
          </p>
        </div>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="size-4" /> New ticket
            </Button>
          </DialogTrigger>
          <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Create ticket</DialogTitle>
              <DialogDescription>File an internal or client ticket.</DialogDescription>
            </DialogHeader>
            <form onSubmit={createTicket} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="new-title">Title</Label>
                <Input
                  id="new-title"
                  required
                  value={draft.title}
                  onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="new-desc">Description</Label>
                <Textarea
                  id="new-desc"
                  rows={3}
                  value={draft.description}
                  onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>Category</Label>
                  <Select
                    value={draft.category}
                    onValueChange={(v) => setDraft({ ...draft, category: v as TicketCategory })}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="seo">SEO</SelectItem>
                      <SelectItem value="ghl">GHL</SelectItem>
                      <SelectItem value="software">Software</SelectItem>
                      <SelectItem value="billing">Billing</SelectItem>
                      <SelectItem value="general">General</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Priority</Label>
                  <Select
                    value={draft.priority}
                    onValueChange={(v) => setDraft({ ...draft, priority: v as Priority })}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="low">Low</SelectItem>
                      <SelectItem value="medium">Medium</SelectItem>
                      <SelectItem value="high">High</SelectItem>
                      <SelectItem value="urgent">Urgent</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Client</Label>
                  <Select
                    value={draft.client_id || "none"}
                    onValueChange={(v) => setDraft({ ...draft, client_id: v === "none" ? "" : v })}
                  >
                    <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      {clients.map((c) => (
                        <SelectItem key={c.id} value={c.id}>{c.company_name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Department</Label>
                  <Select
                    value={draft.department_id || "none"}
                    onValueChange={(v) =>
                      setDraft({ ...draft, department_id: v === "none" ? "" : v })
                    }
                  >
                    <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      {departments.map((d) => (
                        <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="col-span-2 space-y-1.5">
                  <Label>Assignee</Label>
                  <Select
                    value={draft.assigned_to || "none"}
                    onValueChange={(v) =>
                      setDraft({ ...draft, assigned_to: v === "none" ? "" : v })
                    }
                  >
                    <SelectTrigger><SelectValue placeholder="Unassigned" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Unassigned</SelectItem>
                      {teamMembers.map((m) => (
                        <SelectItem key={m.id} value={m.id}>{m.full_name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              {actionError && <p className="text-sm text-destructive">{actionError}</p>}
              <Button type="submit" className="w-full" disabled={creating || !draft.title.trim()}>
                {creating ? "Creating…" : "Create ticket"}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </header>

      {/* Filter bar */}
      <div className="flex flex-wrap gap-2">
        <Select value={filterDept} onValueChange={setFilterDept}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All departments</SelectItem>
            {departments.map((d) => (
              <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filterCategory} onValueChange={setFilterCategory}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All categories</SelectItem>
            <SelectItem value="seo">SEO</SelectItem>
            <SelectItem value="ghl">GHL</SelectItem>
            <SelectItem value="software">Software</SelectItem>
            <SelectItem value="billing">Billing</SelectItem>
            <SelectItem value="general">General</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filterPriority} onValueChange={setFilterPriority}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All priorities</SelectItem>
            <SelectItem value="low">Low</SelectItem>
            <SelectItem value="medium">Medium</SelectItem>
            <SelectItem value="high">High</SelectItem>
            <SelectItem value="urgent">Urgent</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filterAssignee} onValueChange={setFilterAssignee}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All assignees</SelectItem>
            <SelectItem value="unassigned">Unassigned</SelectItem>
            {teamMembers.map((m) => (
              <SelectItem key={m.id} value={m.id}>{m.full_name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Kanban */}
      <div className="grid flex-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {COLUMNS.map((status) => {
          const column = filtered.filter((t) => t.status === status);
          return (
            <div key={status} className="flex min-h-48 flex-col rounded-xl bg-sidebar/60 p-3">
              <div className="mb-3 flex items-center justify-between px-1">
                <span className="section-label">{TICKET_STATUS_LABELS[status]}</span>
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs tabular-nums text-muted-foreground">
                  {column.length}
                </span>
              </div>
              <div className="flex flex-1 flex-col gap-2.5">
                {column.length === 0 ? (
                  <p className="py-6 text-center text-xs text-muted-foreground">No tickets</p>
                ) : (
                  column.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => setSelected(t)}
                      className={cn(
                        "cursor-grab rounded-lg border border-border border-l-[3px] bg-card p-3 text-left transition-colors hover:border-border-hover active:cursor-grabbing",
                        PRIORITY_BORDER[t.priority]
                      )}
                    >
                      <p className="text-xs text-muted-foreground">
                        {t.client?.company_name ?? "Internal"}
                      </p>
                      <p className="mt-0.5 line-clamp-2 text-sm font-medium">{t.title}</p>
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        <CategoryBadge category={t.category} />
                        <PriorityBadge priority={t.priority} />
                      </div>
                      <div className="mt-2 flex items-center justify-between">
                        <SlaCountdown deadline={t.sla_deadline} resolved={t.status === "resolved"} />
                        {t.assignee ? (
                          <UserAvatar
                            name={t.assignee.full_name}
                            avatarUrl={t.assignee.avatar_url}
                            className="size-6"
                          />
                        ) : (
                          <span className="text-[10px] text-muted-foreground">Unassigned</span>
                        )}
                      </div>
                    </button>
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>

      {filtered.length === 0 && (
        <EmptyState
          icon={TicketIcon}
          title="No tickets match these filters"
          description="Try clearing a filter or create a new ticket."
        />
      )}

      {/* Detail slide-over */}
      <Sheet open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
          {selected && (
            <>
              <SheetHeader>
                <SheetTitle className="pr-8">{selected.title}</SheetTitle>
                <SheetDescription className="font-mono text-xs">
                  {shortId(selected.id)} · {selected.client?.company_name ?? "Internal"} ·{" "}
                  {selected.source}
                </SheetDescription>
              </SheetHeader>

              <div className="space-y-5 px-4 pb-8">
                <div className="flex flex-wrap items-center gap-2">
                  <CategoryBadge category={selected.category} />
                  <PriorityBadge priority={selected.priority} />
                  <TicketStatusBadge status={selected.status} />
                  <SlaCountdown
                    deadline={selected.sla_deadline}
                    resolved={selected.status === "resolved"}
                  />
                </div>

                {selected.description && (
                  <p className="whitespace-pre-wrap text-sm">{selected.description}</p>
                )}

                {selected.ai_summary && (
                  <div className="rounded-lg border border-primary/30 bg-primary/10 p-3">
                    <p className="text-xs font-medium uppercase tracking-wider text-primary">
                      AI summary
                    </p>
                    <p className="mt-1 text-sm">{selected.ai_summary}</p>
                  </div>
                )}

                {selected.voice_recording_url && (
                  <div className="space-y-1.5">
                    <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      Call recording
                    </p>
                    <audio controls src={selected.voice_recording_url} className="h-10 w-full" />
                    {selected.transcription && (
                      <p className="max-h-32 overflow-y-auto rounded-md bg-muted/40 p-2 text-xs text-muted-foreground">
                        {selected.transcription}
                      </p>
                    )}
                  </div>
                )}

                <Separator />

                {/* Actions */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Status</Label>
                    <Select
                      value={selected.status}
                      onValueChange={(v) => changeStatus(selected, v as TicketStatus)}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {COLUMNS.map((s) => (
                          <SelectItem key={s} value={s}>{TICKET_STATUS_LABELS[s]}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Assignee</Label>
                    <Select
                      value={selected.assigned_to ?? "unassigned"}
                      onValueChange={(v) => assign(selected, v === "unassigned" ? null : v)}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="unassigned">Unassigned</SelectItem>
                        {teamMembers.map((m) => (
                          <SelectItem key={m.id} value={m.id}>{m.full_name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  {selected.assigned_to !== currentUser.id && (
                    <Button variant="outline" size="sm" onClick={() => assign(selected, currentUser.id)}>
                      <UserPlus className="size-4" /> Assign to me
                    </Button>
                  )}
                  {selected.status !== "escalated" && selected.status !== "resolved" && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="border-red-500/40 text-red-600 dark:text-red-400 hover:bg-red-500/10 hover:text-red-600 dark:text-red-400"
                      onClick={() => changeStatus(selected, "escalated")}
                    >
                      <ArrowUpRight className="size-4" /> Escalate
                    </Button>
                  )}
                </div>

                {selected.status !== "resolved" && (
                  <div className="space-y-2 rounded-lg border border-border p-3">
                    <Label htmlFor="resolution" className="text-xs">
                      Resolve with summary
                    </Label>
                    <Textarea
                      id="resolution"
                      rows={2}
                      value={resolutionNotes}
                      onChange={(e) => setResolutionNotes(e.target.value)}
                      placeholder="What fixed it?"
                    />
                    <Button
                      size="sm"
                      onClick={() => resolve(selected)}
                      disabled={resolving}
                      className="bg-emerald-600 hover:bg-emerald-500"
                    >
                      <CheckCircle2 className="size-4" />
                      {resolving ? "Resolving…" : "Mark resolved"}
                    </Button>
                  </div>
                )}

                {selected.resolution_notes && (
                  <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3">
                    <p className="text-xs font-medium uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                      Resolution
                    </p>
                    <p className="mt-1 text-sm">{selected.resolution_notes}</p>
                  </div>
                )}

                {actionError && <p className="text-sm text-destructive">{actionError}</p>}

                <Separator />

                {/* Notes + activity */}
                <div className="space-y-3">
                  <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Activity
                  </p>
                  <div className="flex gap-2">
                    <Input
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder="Add an internal note…"
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          addNote(selected);
                        }
                      }}
                    />
                    <Button variant="outline" onClick={() => addNote(selected)} disabled={!note.trim()}>
                      Add
                    </Button>
                  </div>
                  {activity.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No activity yet.</p>
                  ) : (
                    <ul className="space-y-3">
                      {activity.map((a) => (
                        <li key={a.id} className="flex gap-3 text-sm">
                          <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary" />
                          <div>
                            <p>
                              <span className="font-medium">{a.user?.full_name ?? "System"}</span>{" "}
                              <span className="text-muted-foreground">
                                {a.action.replaceAll("_", " ")}
                              </span>
                              {a.old_value && a.new_value && (
                                <span className="text-muted-foreground">
                                  : {a.old_value} → {a.new_value}
                                </span>
                              )}
                              {!a.old_value && a.new_value && (
                                <span className="text-muted-foreground"> — {a.new_value}</span>
                              )}
                            </p>
                            <p className="text-xs text-muted-foreground">{timeAgo(a.created_at)}</p>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <p className="text-xs text-muted-foreground">
                  Created {formatDateTime(selected.created_at)} · Updated{" "}
                  {formatDateTime(selected.updated_at)}
                </p>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
