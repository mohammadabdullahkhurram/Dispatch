"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Building2,
  Kanban,
  Link2,
  List,
  ListChecks,
  Plus,
  Users,
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  PriorityBadge,
  TaskStatusBadge,
  TASK_STATUS_LABELS,
} from "@/components/badges";
import { EmptyState } from "@/components/empty-state";
import { UserAvatar } from "@/components/user-avatar";
import { createClient } from "@/lib/supabase/client";
import { logAudit } from "@/lib/audit";
import { formatDate, isOverdue, timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";
import type {
  Client,
  Department,
  Priority,
  Task,
  TaskComment,
  TaskStatus,
  UserProfile,
} from "@/lib/types";

const COLUMNS: TaskStatus[] = ["todo", "in_progress", "done"];

type Scope =
  | { kind: "all" }
  | { kind: "mine" }
  | { kind: "department"; id: string }
  | { kind: "client"; id: string };

export function TasksView({
  currentUser,
  initialTasks,
  teamMembers,
  departments,
  clients,
}: {
  currentUser: UserProfile;
  initialTasks: Task[];
  teamMembers: UserProfile[];
  departments: Department[];
  clients: Pick<Client, "id" | "company_name">[];
}) {
  const [tasks, setTasks] = useState(initialTasks);
  const [view, setView] = useState<"kanban" | "list">("kanban");
  const [scope, setScope] = useState<Scope>({ kind: "all" });
  const [selected, setSelected] = useState<Task | null>(null);
  const [comments, setComments] = useState<TaskComment[]>([]);
  const [commentDraft, setCommentDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState({
    title: "",
    description: "",
    priority: "medium" as Priority,
    status: "todo" as TaskStatus,
    department_id: "",
    client_id: "",
    assigned_to: "",
    due_date: "",
  });

  useEffect(() => {
    if (!selected) return;
    const supabase = createClient();
    supabase
      .from("task_comments")
      .select("*, user:users(id, full_name, avatar_url)")
      .eq("task_id", selected.id)
      .order("created_at", { ascending: true })
      .then(({ data }) => setComments((data ?? []) as TaskComment[]));
  }, [selected]);

  const filtered = useMemo(() => {
    switch (scope.kind) {
      case "mine":
        return tasks.filter((t) => t.assigned_to === currentUser.id);
      case "department":
        return tasks.filter((t) => t.department_id === scope.id);
      case "client":
        return tasks.filter((t) => t.client_id === scope.id);
      default:
        return tasks;
    }
  }, [tasks, scope, currentUser.id]);

  function applyLocal(id: string, patch: Partial<Task>) {
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
    setSelected((prev) => (prev && prev.id === id ? { ...prev, ...patch } : prev));
  }

  async function changeStatus(task: Task, status: TaskStatus) {
    const supabase = createClient();
    const { error: updateError } = await supabase
      .from("tasks")
      .update({ status })
      .eq("id", task.id);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    applyLocal(task.id, { status });
    await logAudit(supabase, {
      userId: currentUser.id,
      entityType: "task",
      entityId: task.id,
      action: "task_status_changed",
      details: { from: task.status, to: status, title: task.title },
    });
  }

  async function addComment(task: Task) {
    if (!commentDraft.trim()) return;
    const supabase = createClient();
    const { data, error: insertError } = await supabase
      .from("task_comments")
      .insert({
        task_id: task.id,
        user_id: currentUser.id,
        content: commentDraft.trim(),
      })
      .select("*, user:users(id, full_name, avatar_url)")
      .single();
    if (insertError || !data) {
      setError(insertError?.message ?? "Comment failed.");
      return;
    }
    setComments((prev) => [...prev, data as TaskComment]);
    setCommentDraft("");
  }

  async function createTask(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setError(null);
    const supabase = createClient();
    const { data, error: insertError } = await supabase
      .from("tasks")
      .insert({
        title: draft.title,
        description: draft.description || null,
        priority: draft.priority,
        status: draft.status,
        department_id: draft.department_id || null,
        client_id: draft.client_id || null,
        assigned_to: draft.assigned_to || null,
        due_date: draft.due_date ? new Date(draft.due_date).toISOString() : null,
        created_by: currentUser.id,
      })
      .select(
        `*,
         client:clients(id, company_name),
         assignee:users!tasks_assigned_to_fkey(id, full_name, avatar_url),
         linked_ticket:tickets!tasks_linked_ticket_id_fkey(id, title)`
      )
      .single();

    if (insertError || !data) {
      setError(insertError?.message ?? "Failed to create task.");
      setCreating(false);
      return;
    }

    await logAudit(supabase, {
      userId: currentUser.id,
      entityType: "task",
      entityId: data.id,
      action: "task_created",
      details: { title: draft.title },
    });

    setTasks((prev) => [data as Task, ...prev]);
    setDraft({
      title: "",
      description: "",
      priority: "medium",
      status: "todo",
      department_id: "",
      client_id: "",
      assigned_to: "",
      due_date: "",
    });
    setCreateOpen(false);
    setCreating(false);
  }

  function TaskCard({ task }: { task: Task }) {
    return (
      <button
        onClick={() => setSelected(task)}
        className="rounded-lg border border-border bg-card p-3 text-left transition-colors hover:border-primary/50"
      >
        <p className="line-clamp-2 text-sm font-medium">{task.title}</p>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {task.client && (
            <Badge variant="outline" className="gap-1 text-xs">
              <Building2 className="size-3" /> {task.client.company_name}
            </Badge>
          )}
          <PriorityBadge priority={task.priority} />
          {task.linked_ticket && (
            <Badge variant="outline" className="gap-1 text-xs text-primary">
              <Link2 className="size-3" /> Ticket
            </Badge>
          )}
        </div>
        <div className="mt-2 flex items-center justify-between">
          <span
            className={cn(
              "text-xs",
              isOverdue(task.due_date) && task.status !== "done"
                ? "font-medium text-red-400"
                : "text-muted-foreground"
            )}
          >
            {task.due_date ? `Due ${formatDate(task.due_date)}` : "No due date"}
          </span>
          {task.assignee ? (
            <UserAvatar
              name={task.assignee.full_name}
              avatarUrl={task.assignee.avatar_url}
              className="size-6"
            />
          ) : (
            <span className="text-[10px] text-muted-foreground">Unassigned</span>
          )}
        </div>
      </button>
    );
  }

  const scopeKey =
    scope.kind === "all"
      ? "all"
      : scope.kind === "mine"
        ? "mine"
        : `${scope.kind}:${scope.id}`;

  return (
    <div className="flex flex-1 gap-0 md:gap-6 md:p-8 p-6">
      {/* Filter sidebar */}
      <aside className="hidden w-52 shrink-0 space-y-1 lg:block">
        <p className="px-2 pb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          Filters
        </p>
        {[
          { key: "all", label: "All tasks", icon: ListChecks, s: { kind: "all" } as Scope },
          { key: "mine", label: "My tasks", icon: Users, s: { kind: "mine" } as Scope },
        ].map(({ key, label, icon: Icon, s }) => (
          <button
            key={key}
            onClick={() => setScope(s)}
            className={cn(
              "flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors",
              scopeKey === key
                ? "bg-accent font-medium"
                : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"
            )}
          >
            <Icon className="size-4" /> {label}
          </button>
        ))}
        <p className="px-2 pb-1 pt-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          Departments
        </p>
        {departments.map((d) => (
          <button
            key={d.id}
            onClick={() => setScope({ kind: "department", id: d.id })}
            className={cn(
              "flex w-full items-center gap-2.5 rounded-md px-3 py-1.5 text-sm transition-colors",
              scopeKey === `department:${d.id}`
                ? "bg-accent font-medium"
                : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"
            )}
          >
            {d.name}
          </button>
        ))}
        <p className="px-2 pb-1 pt-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          Clients
        </p>
        <div className="max-h-64 space-y-0.5 overflow-y-auto">
          {clients.map((c) => (
            <button
              key={c.id}
              onClick={() => setScope({ kind: "client", id: c.id })}
              className={cn(
                "flex w-full items-center rounded-md px-3 py-1.5 text-sm transition-colors",
                scopeKey === `client:${c.id}`
                  ? "bg-accent font-medium"
                  : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"
              )}
            >
              <span className="truncate">{c.company_name}</span>
            </button>
          ))}
        </div>
      </aside>

      {/* Main */}
      <div className="flex min-w-0 flex-1 flex-col gap-5">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">Tasks</h1>
            <p className="text-sm text-muted-foreground">
              {filtered.filter((t) => t.status !== "done").length} open in this view.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex rounded-md border border-border p-0.5">
              <button
                onClick={() => setView("kanban")}
                className={cn(
                  "flex items-center gap-1.5 rounded px-2.5 py-1.5 text-xs font-medium",
                  view === "kanban" ? "bg-accent" : "text-muted-foreground"
                )}
              >
                <Kanban className="size-3.5" /> Board
              </button>
              <button
                onClick={() => setView("list")}
                className={cn(
                  "flex items-center gap-1.5 rounded px-2.5 py-1.5 text-xs font-medium",
                  view === "list" ? "bg-accent" : "text-muted-foreground"
                )}
              >
                <List className="size-3.5" /> List
              </button>
            </div>
            <Dialog open={createOpen} onOpenChange={setCreateOpen}>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="size-4" /> New task
                </Button>
              </DialogTrigger>
              <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
                <DialogHeader>
                  <DialogTitle>Create task</DialogTitle>
                  <DialogDescription>Add a work item for the team.</DialogDescription>
                </DialogHeader>
                <form onSubmit={createTask} className="space-y-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="task-title">Title</Label>
                    <Input
                      id="task-title"
                      required
                      value={draft.title}
                      onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="task-desc">Description</Label>
                    <Textarea
                      id="task-desc"
                      rows={3}
                      value={draft.description}
                      onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
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
                      <Label>Status</Label>
                      <Select
                        value={draft.status}
                        onValueChange={(v) => setDraft({ ...draft, status: v as TaskStatus })}
                      >
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {COLUMNS.map((s) => (
                            <SelectItem key={s} value={s}>{TASK_STATUS_LABELS[s]}</SelectItem>
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
                    <div className="space-y-1.5">
                      <Label>Client</Label>
                      <Select
                        value={draft.client_id || "none"}
                        onValueChange={(v) =>
                          setDraft({ ...draft, client_id: v === "none" ? "" : v })
                        }
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
                    <div className="space-y-1.5">
                      <Label htmlFor="task-due">Due date</Label>
                      <Input
                        id="task-due"
                        type="date"
                        value={draft.due_date}
                        onChange={(e) => setDraft({ ...draft, due_date: e.target.value })}
                      />
                    </div>
                  </div>
                  {error && <p className="text-sm text-destructive">{error}</p>}
                  <Button type="submit" className="w-full" disabled={creating || !draft.title.trim()}>
                    {creating ? "Creating…" : "Create task"}
                  </Button>
                </form>
              </DialogContent>
            </Dialog>
          </div>
        </header>

        {/* Mobile scope picker */}
        <div className="lg:hidden">
          <Select
            value={scopeKey}
            onValueChange={(v) => {
              if (v === "all") setScope({ kind: "all" });
              else if (v === "mine") setScope({ kind: "mine" });
              else {
                const [kind, id] = v.split(":");
                setScope({ kind: kind as "department" | "client", id });
              }
            }}
          >
            <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All tasks</SelectItem>
              <SelectItem value="mine">My tasks</SelectItem>
              {departments.map((d) => (
                <SelectItem key={d.id} value={`department:${d.id}`}>{d.name}</SelectItem>
              ))}
              {clients.map((c) => (
                <SelectItem key={c.id} value={`client:${c.id}`}>{c.company_name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {filtered.length === 0 ? (
          <EmptyState
            icon={ListChecks}
            title="No tasks in this view"
            description="Create a task or switch filters."
          />
        ) : view === "kanban" ? (
          <div className="grid flex-1 gap-4 md:grid-cols-3">
            {COLUMNS.map((status) => {
              const column = filtered.filter((t) => t.status === status);
              return (
                <div key={status} className="flex min-h-48 flex-col rounded-xl bg-sidebar/60 p-3">
                  <div className="mb-3 flex items-center justify-between px-1">
                    <span className="text-sm font-medium">{TASK_STATUS_LABELS[status]}</span>
                    <span className="rounded-full bg-muted px-2 py-0.5 text-xs tabular-nums text-muted-foreground">
                      {column.length}
                    </span>
                  </div>
                  <div className="flex flex-1 flex-col gap-2.5">
                    {column.map((t) => (
                      <TaskCard key={t.id} task={t} />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="rounded-xl border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead>
                  <TableHead>Client</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Priority</TableHead>
                  <TableHead>Assignee</TableHead>
                  <TableHead>Due</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((t) => (
                  <TableRow key={t.id} className="cursor-pointer" onClick={() => setSelected(t)}>
                    <TableCell className="max-w-64 truncate font-medium">{t.title}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {t.client?.company_name ?? "—"}
                    </TableCell>
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
                    <TableCell
                      className={cn(
                        "text-sm",
                        isOverdue(t.due_date) && t.status !== "done"
                          ? "font-medium text-red-400"
                          : "text-muted-foreground"
                      )}
                    >
                      {formatDate(t.due_date)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      {/* Detail slide-over */}
      <Sheet open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
          {selected && (
            <>
              <SheetHeader>
                <SheetTitle className="pr-8">{selected.title}</SheetTitle>
                <SheetDescription>
                  {selected.client?.company_name ?? "Internal"} ·{" "}
                  {selected.due_date ? `Due ${formatDate(selected.due_date)}` : "No due date"}
                </SheetDescription>
              </SheetHeader>

              <div className="space-y-5 px-4 pb-8">
                <div className="flex flex-wrap items-center gap-2">
                  <TaskStatusBadge status={selected.status} />
                  <PriorityBadge priority={selected.priority} />
                  {selected.linked_ticket && (
                    <Badge variant="outline" className="gap-1 text-primary">
                      <Link2 className="size-3" /> {selected.linked_ticket.title}
                    </Badge>
                  )}
                </div>

                {selected.description && (
                  <p className="whitespace-pre-wrap text-sm">{selected.description}</p>
                )}

                <div className="space-y-1.5">
                  <Label className="text-xs">Status</Label>
                  <Select
                    value={selected.status}
                    onValueChange={(v) => changeStatus(selected, v as TaskStatus)}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {COLUMNS.map((s) => (
                        <SelectItem key={s} value={s}>{TASK_STATUS_LABELS[s]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {error && <p className="text-sm text-destructive">{error}</p>}

                <Separator />

                <div className="space-y-3">
                  <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Comments
                  </p>
                  {comments.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No comments yet.</p>
                  ) : (
                    <ul className="space-y-3">
                      {comments.map((c) => (
                        <li key={c.id} className="flex gap-3">
                          <UserAvatar
                            name={c.user?.full_name}
                            avatarUrl={c.user?.avatar_url}
                            className="mt-0.5 size-7"
                          />
                          <div className="min-w-0 flex-1">
                            <p className="text-sm">
                              <span className="font-medium">{c.user?.full_name ?? "Someone"}</span>{" "}
                              <span className="text-xs text-muted-foreground">
                                {timeAgo(c.created_at)}
                              </span>
                            </p>
                            <p className="whitespace-pre-wrap text-sm text-muted-foreground">
                              {c.content}
                            </p>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="flex gap-2">
                    <Input
                      value={commentDraft}
                      onChange={(e) => setCommentDraft(e.target.value)}
                      placeholder="Add a comment…"
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          addComment(selected);
                        }
                      }}
                    />
                    <Button
                      variant="outline"
                      onClick={() => addComment(selected)}
                      disabled={!commentDraft.trim()}
                    >
                      Post
                    </Button>
                  </div>
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
