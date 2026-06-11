"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Bell,
  CheckCheck,
  ListChecks,
  MessageSquare,
  Ticket as TicketIcon,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EmptyState } from "@/components/empty-state";
import { createClient } from "@/lib/supabase/client";
import { timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Notification } from "@/lib/types";

const TYPE_ICONS: Record<string, LucideIcon> = {
  ticket: TicketIcon,
  task: ListChecks,
  chat: MessageSquare,
  sla: AlertTriangle,
};

function iconFor(type: string): LucideIcon {
  const key = Object.keys(TYPE_ICONS).find((k) => type.toLowerCase().includes(k));
  return key ? TYPE_ICONS[key] : Bell;
}

export function NotificationsList({
  userId,
  initialNotifications,
}: {
  userId: string;
  initialNotifications: Notification[];
}) {
  const [notifications, setNotifications] = useState(initialNotifications);
  const [filter, setFilter] = useState("all");
  const router = useRouter();

  const types = useMemo(
    () => Array.from(new Set(notifications.map((n) => n.type))).sort(),
    [notifications]
  );

  const filtered = useMemo(
    () => (filter === "all" ? notifications : notifications.filter((n) => n.type === filter)),
    [notifications, filter]
  );

  const unreadCount = notifications.filter((n) => !n.read).length;

  // Realtime: prepend new notifications as they land.
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`notifications-page-${userId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          const incoming = payload.new as Notification;
          setNotifications((prev) =>
            prev.some((n) => n.id === incoming.id) ? prev : [incoming, ...prev]
          );
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId]);

  async function markAllRead() {
    const supabase = createClient();
    const { error } = await supabase
      .from("notifications")
      .update({ read: true })
      .eq("user_id", userId)
      .eq("read", false);
    if (!error) {
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    }
  }

  async function open(notification: Notification) {
    if (!notification.read) {
      const supabase = createClient();
      await supabase
        .from("notifications")
        .update({ read: true })
        .eq("id", notification.id);
      setNotifications((prev) =>
        prev.map((n) => (n.id === notification.id ? { ...n, read: true } : n))
      );
    }
    if (notification.link) router.push(notification.link);
  }

  return (
    <div className="flex flex-1 flex-col gap-6 p-6 md:p-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">Notifications</h1>
          <p className="text-sm text-muted-foreground">
            {unreadCount ? `${unreadCount} unread` : "All caught up"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={filter} onValueChange={setFilter}>
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              {types.map((t) => (
                <SelectItem key={t} value={t} className="capitalize">
                  {t.replaceAll("_", " ")}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" onClick={markAllRead} disabled={unreadCount === 0}>
            <CheckCheck className="size-4" /> Mark all read
          </Button>
        </div>
      </header>

      {filtered.length === 0 ? (
        <EmptyState
          icon={Bell}
          title="No notifications"
          description="Mentions, assignments, and SLA warnings will land here."
        />
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border">
          {filtered.map((n) => {
            const Icon = iconFor(n.type);
            return (
              <li key={n.id}>
                <button
                  onClick={() => open(n)}
                  className={cn(
                    "flex w-full items-start gap-3.5 px-4 py-3.5 text-left transition-colors hover:bg-accent/50",
                    !n.read && "bg-primary/5"
                  )}
                >
                  <span
                    className={cn(
                      "mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full",
                      n.read ? "bg-muted" : "bg-primary/15"
                    )}
                  >
                    <Icon
                      className={cn("size-4", n.read ? "text-muted-foreground" : "text-primary")}
                    />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className={cn("text-sm", !n.read && "font-medium")}>{n.title}</p>
                    {n.body && (
                      <p className="mt-0.5 line-clamp-2 text-sm text-muted-foreground">{n.body}</p>
                    )}
                    <p className="mt-1 text-xs text-muted-foreground">
                      <span className="capitalize">{n.type.replaceAll("_", " ")}</span> ·{" "}
                      {timeAgo(n.created_at)}
                    </p>
                  </div>
                  {!n.read && <span className="mt-2 size-2 shrink-0 rounded-full bg-primary" />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
