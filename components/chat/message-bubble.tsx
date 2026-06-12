"use client";

import Link from "next/link";
import { Ticket as TicketIcon, Video } from "lucide-react";
import { TicketStatusBadge } from "@/components/badges";
import { UserAvatar } from "@/components/user-avatar";
import { formatDateTime } from "@/lib/format";
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
  };

  let body: React.ReactNode;

  switch (message.message_type) {
    case "ticket_card":
      body = (
        <Link
          href={ticketHrefBase}
          className="block min-w-56 rounded-lg border border-border bg-card p-3 transition-colors hover:border-primary/50"
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
        <div className="space-y-1.5">
          {message.content && <p className="text-sm">{message.content}</p>}
          <audio controls src={meta.url} className="h-10 w-64 max-w-full" />
        </div>
      );
      break;

    case "meet_link":
      body = (
        <a
          href={meta.url ?? message.content ?? "#"}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 rounded-md bg-emerald-600 px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-emerald-500"
        >
          <Video className="size-4" /> Join Google Meet
        </a>
      );
      break;

    default:
      body = <p className="whitespace-pre-wrap text-sm">{message.content}</p>;
  }

  return (
    <div className={cn("flex gap-2.5", mine ? "flex-row-reverse" : "flex-row")}>
      <UserAvatar
        name={message.sender?.full_name ?? (message.sender_type === "team" ? "Team" : "Client")}
        avatarUrl={message.sender?.avatar_url}
        className="mt-1 size-7 shrink-0"
      />
      <div className={cn("max-w-[75%] space-y-1", mine && "items-end text-right")}>
        <div
          className={cn(
            "inline-block rounded-2xl px-3.5 py-2.5 text-left",
            message.message_type !== "text"
              ? "bg-transparent p-0"
              : mine
                ? "rounded-br-sm bg-primary text-primary-foreground"
                : "rounded-bl-sm bg-secondary text-secondary-foreground"
          )}
        >
          {body}
        </div>
        <p className="text-[11px] text-muted-foreground">
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
