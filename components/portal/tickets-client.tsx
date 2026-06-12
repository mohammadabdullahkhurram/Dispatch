"use client";

import { useEffect, useRef, useState } from "react";
import { Paperclip, Ticket as TicketIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import {
  CategoryBadge,
  PriorityBadge,
  TicketStatusBadge,
} from "@/components/badges";
import { EmptyState } from "@/components/empty-state";
import { SlaCountdown } from "@/components/sla-countdown";
import { createClient } from "@/lib/supabase/client";
import { slaDeadline } from "@/lib/sla";
import { logAudit, logTicketActivity } from "@/lib/audit";
import { formatDate, formatDateTime, shortId, timeAgo } from "@/lib/format";
import type {
  Priority,
  Ticket,
  TicketActivity,
  TicketCategory,
} from "@/lib/types";

export function PortalTickets({
  userId,
  clientId,
  allowBilling,
  initialTickets,
}: {
  userId: string;
  clientId: string;
  allowBilling: boolean;
  initialTickets: Ticket[];
}) {
  const [tickets, setTickets] = useState(initialTickets);
  const [selected, setSelected] = useState<Ticket | null>(null);
  // Loading state is derived: activity is "loading" until it matches the
  // selected ticket, so the effect never has to set a flag synchronously.
  const [activityFor, setActivityFor] = useState<{
    ticketId: string | null;
    items: TicketActivity[];
  }>({ ticketId: null, items: [] });
  const activity = activityFor.items;
  const activityLoading = !!selected && activityFor.ticketId !== selected.id;

  // form state
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<TicketCategory>("general");
  const [priority, setPriority] = useState<Priority>("medium");
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    const supabase = createClient();
    supabase
      .from("ticket_activity_log")
      .select("*, user:users(id, full_name, avatar_url)")
      .eq("ticket_id", selected.id)
      .order("created_at", { ascending: true })
      .then(({ data }) => {
        if (!cancelled) {
          setActivityFor({
            ticketId: selected.id,
            items: (data ?? []) as TicketActivity[],
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [selected]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setFormSuccess(false);
    setSubmitting(true);

    const supabase = createClient();
    let fileUrl: string | null = null;

    if (file) {
      const path = `tickets/${clientId}/${Date.now()}-${file.name}`;
      const { error: uploadError } = await supabase.storage
        .from("uploads")
        .upload(path, file);
      if (uploadError) {
        setFormError(`File upload failed: ${uploadError.message}`);
        setSubmitting(false);
        return;
      }
      fileUrl = supabase.storage.from("uploads").getPublicUrl(path).data
        .publicUrl;
    }

    const { data: ticket, error } = await supabase
      .from("tickets")
      .insert({
        title,
        description: fileUrl
          ? `${description}\n\nAttachment: ${fileUrl}`
          : description,
        category,
        priority,
        client_id: clientId,
        created_by: userId,
        source: "web",
        sla_deadline: slaDeadline(priority),
      })
      .select()
      .single();

    if (error || !ticket) {
      setFormError(error?.message ?? "Failed to submit ticket.");
      setSubmitting(false);
      return;
    }

    await Promise.all([
      logTicketActivity(supabase, {
        ticketId: ticket.id,
        userId,
        action: "created",
        newValue: title,
      }),
      logAudit(supabase, {
        userId,
        entityType: "ticket",
        entityId: ticket.id,
        action: "ticket_created",
        details: { title, category, priority, source: "web" },
      }),
    ]);

    setTickets((prev) => [ticket as Ticket, ...prev]);
    setTitle("");
    setDescription("");
    setCategory("general");
    setPriority("medium");
    setFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
    setFormSuccess(true);
    setSubmitting(false);
  }

  return (
    <div className="flex flex-1 flex-col gap-6 p-6 md:p-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">My Tickets</h1>
        <p className="text-sm text-muted-foreground">
          Submit support requests and track them through to resolution.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Submit New Ticket</CardTitle>
          <CardDescription>
            We&apos;ll route it to the right team and confirm your SLA.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-1.5 md:col-span-2">
                <Label htmlFor="t-title">Title</Label>
                <Input
                  id="t-title"
                  required
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Brief summary of the issue"
                />
              </div>
              <div className="space-y-1.5 md:col-span-2">
                <Label htmlFor="t-desc">Description</Label>
                <Textarea
                  id="t-desc"
                  rows={4}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="What's happening? Include any relevant links or details."
                />
              </div>
              <div className="space-y-1.5">
                <Label>Category</Label>
                <Select
                  value={category}
                  onValueChange={(v) => setCategory(v as TicketCategory)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="seo">SEO</SelectItem>
                    <SelectItem value="ghl">GHL</SelectItem>
                    <SelectItem value="software">Software</SelectItem>
                    {allowBilling && (
                      <SelectItem value="billing">Billing</SelectItem>
                    )}
                    <SelectItem value="general">General</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Priority</Label>
                <Select
                  value={priority}
                  onValueChange={(v) => setPriority(v as Priority)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="urgent">Urgent</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5 md:col-span-2">
                <Label htmlFor="t-file">
                  <span className="inline-flex items-center gap-1.5">
                    <Paperclip className="size-3.5" /> Attachment (optional)
                  </span>
                </Label>
                <Input
                  id="t-file"
                  type="file"
                  ref={fileInputRef}
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
              </div>
            </div>

            {formError && (
              <p className="text-sm text-destructive" role="alert">
                {formError}
              </p>
            )}
            {formSuccess && (
              <p className="text-sm text-emerald-600 dark:text-emerald-400">
                Ticket submitted — our team is on it.
              </p>
            )}

            <Button type="submit" disabled={submitting || !title.trim()}>
              {submitting ? "Submitting…" : "Submit ticket"}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">My Tickets</CardTitle>
        </CardHeader>
        <CardContent>
          {tickets.length === 0 ? (
            <EmptyState
              icon={TicketIcon}
              title="No tickets yet"
              description="Tickets you submit will show up here with live status."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ID</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Priority</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>SLA</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tickets.map((t) => (
                  <TableRow
                    key={t.id}
                    className="cursor-pointer"
                    onClick={() => setSelected(t)}
                  >
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {shortId(t.id)}
                    </TableCell>
                    <TableCell className="max-w-64 truncate font-medium">
                      {t.title}
                    </TableCell>
                    <TableCell>
                      <CategoryBadge category={t.category} />
                    </TableCell>
                    <TableCell>
                      <PriorityBadge priority={t.priority} />
                    </TableCell>
                    <TableCell>
                      <TicketStatusBadge status={t.status} />
                    </TableCell>
                    <TableCell>
                      <SlaCountdown
                        deadline={t.sla_deadline}
                        resolved={t.status === "resolved"}
                      />
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatDate(t.created_at)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Detail slide-over */}
      <Sheet open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
          {selected && (
            <>
              <SheetHeader>
                <SheetTitle className="pr-8">{selected.title}</SheetTitle>
                <SheetDescription className="font-mono text-xs">
                  Ticket {shortId(selected.id)}
                </SheetDescription>
              </SheetHeader>

              <div className="space-y-5 px-4 pb-6">
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
                  <div className="space-y-1">
                    <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      Description
                    </p>
                    <p className="whitespace-pre-wrap text-sm">
                      {selected.description}
                    </p>
                  </div>
                )}

                {selected.resolution_notes && (
                  <div className="space-y-1 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3">
                    <p className="text-xs font-medium uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                      Resolution
                    </p>
                    <p className="text-sm">{selected.resolution_notes}</p>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <p className="text-xs text-muted-foreground">Created</p>
                    <p>{formatDateTime(selected.created_at)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Last updated</p>
                    <p>{formatDateTime(selected.updated_at)}</p>
                  </div>
                </div>

                <Separator />

                <div className="space-y-3">
                  <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Activity
                  </p>
                  {activityLoading ? (
                    <p className="text-sm text-muted-foreground">
                      Loading activity…
                    </p>
                  ) : activity.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No activity recorded yet.
                    </p>
                  ) : (
                    <ul className="space-y-3">
                      {activity.map((a) => (
                        <li key={a.id} className="flex gap-3 text-sm">
                          <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary" />
                          <div>
                            <p>
                              <span className="font-medium">
                                {a.user?.full_name ?? "System"}
                              </span>{" "}
                              <span className="text-muted-foreground">
                                {a.action.replaceAll("_", " ")}
                              </span>
                              {a.new_value && (
                                <span className="text-muted-foreground">
                                  {" "}
                                  → {a.new_value}
                                </span>
                              )}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {timeAgo(a.created_at)}
                            </p>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
