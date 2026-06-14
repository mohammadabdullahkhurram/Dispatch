"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Bot,
  ChevronDown,
  ChevronRight,
  Phone,
  Sparkles,
  Ticket as TicketIcon,
  Video,
} from "lucide-react";
import { CategoryBadge, TicketStatusBadge } from "@/components/badges";
import { UserAvatar } from "@/components/user-avatar";
import { formatDateTime, formatDuration } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ChatMessage, TicketCategory, TicketStatus } from "@/lib/types";

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
    caller_name?: string | null;
    phone?: string | null;
    transcript?: string | null;
    ai_summary?: string | null;
    category?: TicketCategory | null;
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
      body = <CallLogCard meta={meta} ticketHrefBase={ticketHrefBase} />;
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

const TRANSCRIPT_COLLAPSE_AT = 280;

/** "Processing — check back shortly" with a subtle pulsing dot. */
function Processing({ label = "Processing — check back shortly" }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      <span className="size-1.5 animate-pulse rounded-full bg-amber-500" />
      {label}
    </span>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-0.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
      {children}
    </p>
  );
}

/**
 * Rich inbound-call card. Always shows every field — caller, category,
 * duration, AI summary, recording, transcript, ticket link — with a
 * pulsing "Processing" placeholder for anything GHL hasn't sent yet
 * (recording/transcript/summary often lag the call by a few minutes).
 */
function CallLogCard({
  meta,
  ticketHrefBase,
}: {
  meta: {
    direction?: string;
    status?: string;
    caller_name?: string | null;
    phone?: string | null;
    duration?: number | null;
    recording_url?: string | null;
    transcript?: string | null;
    ai_summary?: string | null;
    category?: TicketCategory | null;
    ticket_id?: string;
  };
  ticketHrefBase: string;
}) {
  const transcript = meta.transcript ?? "";
  const isLong = transcript.length > TRANSCRIPT_COLLAPSE_AT;
  const [open, setOpen] = useState(false);

  return (
    <div className="w-full space-y-3 rounded-lg border border-border bg-card p-3">
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2 text-sm font-medium">
          <Phone className="size-4 shrink-0 text-primary" />
          <span className="truncate">
            {meta.direction === "outbound" ? "Outbound call" : "Inbound call"}
          </span>
        </div>
        {meta.category && <CategoryBadge category={meta.category} />}
      </div>

      {/* Caller / category / duration */}
      <div className="grid grid-cols-2 gap-2 text-sm">
        <div>
          <FieldLabel>Caller</FieldLabel>
          <p className="truncate">
            {meta.caller_name ?? "Unknown"}
            {meta.phone ? (
              <span className="text-muted-foreground"> ({meta.phone})</span>
            ) : null}
          </p>
        </div>
        <div>
          <FieldLabel>Duration</FieldLabel>
          {meta.duration != null && !Number.isNaN(meta.duration) ? (
            <p>{formatDuration(meta.duration)}</p>
          ) : (
            <p className="text-muted-foreground">—</p>
          )}
        </div>
      </div>

      {/* AI summary */}
      <div className="rounded-md border border-primary/30 bg-primary/10 p-2.5">
        <p className="mb-0.5 flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-primary">
          <Sparkles className="size-3" /> AI summary
        </p>
        {meta.ai_summary ? (
          <p className="text-sm">{meta.ai_summary}</p>
        ) : (
          <Processing label="Processing…" />
        )}
      </div>

      {/* Recording */}
      <div>
        <FieldLabel>Recording</FieldLabel>
        {meta.recording_url ? (
          <audio controls src={meta.recording_url} className="h-9 w-full" />
        ) : (
          <Processing />
        )}
      </div>

      {/* Transcript */}
      <div>
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground hover:text-foreground"
          disabled={!transcript || !isLong}
        >
          {transcript && isLong ? (
            open ? (
              <ChevronDown className="size-3.5" />
            ) : (
              <ChevronRight className="size-3.5" />
            )
          ) : null}
          Transcript
        </button>
        {transcript ? (
          <p
            className={cn(
              "mt-1 whitespace-pre-wrap text-sm text-secondary-foreground",
              isLong && !open && "line-clamp-3"
            )}
          >
            {transcript}
          </p>
        ) : (
          <div className="mt-1">
            <Processing />
          </div>
        )}
      </div>

      {/* Ticket link — directly to the ticket */}
      {meta.ticket_id && (
        <Link
          href={`${ticketHrefBase}/${meta.ticket_id}`}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
        >
          <TicketIcon className="size-3.5" /> View ticket
        </Link>
      )}
    </div>
  );
}
