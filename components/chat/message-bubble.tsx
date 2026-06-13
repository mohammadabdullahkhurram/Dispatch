"use client";

import Link from "next/link";
import { Bot, Phone, Ticket as TicketIcon, Video } from "lucide-react";
import { TicketStatusBadge } from "@/components/badges";
import { UserAvatar } from "@/components/user-avatar";
import { formatDateTime, formatDuration } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ChatMessage, TicketStatus } from "@/lib/types";

/**
 * Renders one chat message. `viewer` decides which side "mine" is:
 * the client sees their own messages on the right; the team sees
 * team messages on the right.
 */
export function MessageBubble({
  message,
  viewer,
  ticketHrefBase,
  clientCompany,
}: {
  message: ChatMessage;
  viewer: "client" | "team";
  ticketHrefBase: string;
  /** Shown after the sender name on client messages: "Jane · Acme Co." */
  clientCompany?: string;
}) {
  const mine = message.sender_type === viewer;
  const meta = (message.metadata ?? {}) as {
    ticket_id?: string;
    ticket_title?: string;
    ticket_status?: TicketStatus;
    url?: string;
    direction?: string;
    status?: string;
    duration?: number | null;
    recording_url?: string | null;
  };

  // Rich cards (anything that isn't a plain text message) stretch to
  // the full width of the chat area instead of sitting in a narrow
  // bubble.
  const isCard = message.message_type !== "text";

  let body: React.ReactNode;

  switch (message.message_type) {
    case "ticket_card":
      body = (
        <Link
          href={ticketHrefBase}
          className="block w-full rounded-lg border border-border bg-card p-3 transition-colors hover:border-primary/50"
        >
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <TicketIcon className="size-3.5 text-primary" /> Ticket
          </div>
          <p className="mt-1 text-sm font-medium">
            {meta.ticket_title ?? message.content ?? "View ticket"}
          </p>
          {meta.ticket_status && (
            <div className="mt-2">
              <TicketStatusBadge status={meta.ticket_status} />
            </div>
          )}
        </Link>
      );
      break;

    case "recording":
      body = (
        <div className="w-full space-y-1.5 rounded-lg border border-border bg-card p-3">
          {message.content && <p className="text-sm">{message.content}</p>}
          <audio controls src={meta.url} className="h-10 w-full" />
        </div>
      );
      break;

    case "call_log":
      body = (
        <div className="w-full space-y-1.5 rounded-lg border border-border bg-card p-3">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Phone className="size-3.5 text-primary" />
            {meta.direction === "inbound" ? "Inbound call" : "Outbound call"}
            {meta.status ? ` · ${meta.status}` : ""}
          </div>
          {message.content && <p className="text-sm">{message.content}</p>}
          {meta.duration != null && (
            <p className="text-xs text-muted-foreground">
              Duration: {formatDuration(meta.duration)}
            </p>
          )}
          {meta.recording_url && (
            <audio
              controls
              src={meta.recording_url}
              className="h-9 w-full"
            />
          )}
        </div>
      );
      break;

    case "meet_link":
      body = (
        <a
          href={meta.url ?? message.content ?? "#"}
          target="_blank"
          rel="noopener noreferrer"
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 px-3.5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-emerald-500"
        >
          <Video className="size-4" /> Join Google Meet
        </a>
      );
      break;

    default:
      body = <p className="whitespace-pre-wrap text-sm">{message.content}</p>;
  }

  // Dispatch Bot system messages: full-width muted row, bot icon left.
  if (message.sender_type === "bot") {
    return (
      <div className="group w-full space-y-1">
        <div
          className={cn(
            "flex w-full items-start gap-2.5 rounded-2xl text-left",
            message.message_type === "ticket_card"
              ? "bg-muted/40 p-2"
              : "bg-muted/40 px-3.5 py-2.5 text-muted-foreground"
          )}
        >
          <Bot className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">{body}</div>
        </div>
        <p className="text-[11px] text-muted-foreground opacity-0 transition-opacity duration-150 group-hover:opacity-100">
          Dispatch Bot · {formatDateTime(message.sent_at)}
        </p>
      </div>
    );
  }

  return (
    <div className={cn("group flex gap-2.5", mine ? "flex-row-reverse" : "flex-row")}>
      <UserAvatar
        name={message.sender?.full_name ?? (message.sender_type === "team" ? "Team" : "Client")}
        avatarUrl={message.sender?.avatar_url}
        className="mt-1 size-7 shrink-0"
      />
      {/* Plain text sits in a ≤75% bubble; rich cards stretch full width. */}
      <div
        className={cn(
          "space-y-1",
          isCard ? "min-w-0 flex-1" : "max-w-[75%]",
          mine && !isCard && "items-end text-right"
        )}
      >
        <div
          className={cn(
            "rounded-2xl px-3.5 py-2.5 text-left",
            isCard
              ? "block bg-transparent p-0"
              : mine
                ? "inline-block rounded-br-sm bg-primary text-primary-foreground"
                : "inline-block rounded-bl-sm bg-surface-elevated text-secondary-foreground"
          )}
        >
          {body}
        </div>
        <p className="text-[11px] text-muted-foreground opacity-0 transition-opacity duration-150 group-hover:opacity-100">
          {message.sender?.full_name ? `${message.sender.full_name} · ` : ""}
          {message.sender_type === "client" && clientCompany
            ? `${clientCompany} · `
            : ""}
          {formatDateTime(message.sent_at)}
        </p>
      </div>
    </div>
  );
}
