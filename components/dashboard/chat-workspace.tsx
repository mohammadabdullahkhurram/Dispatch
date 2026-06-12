"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  CheckCircle2,
  MessageSquare,
  Phone,
  SendHorizonal,
  Slash,
  Ticket as TicketIcon,
  Video,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/empty-state";
import { MessageBubble } from "@/components/chat/message-bubble";
import { UserAvatar } from "@/components/user-avatar";
import { createClient } from "@/lib/supabase/client";
import { logAudit, logTicketActivity } from "@/lib/audit";
import { timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";
import type {
  CannedResponse,
  ChatMessage,
  ChatThread,
  MessageType,
  UserProfile,
} from "@/lib/types";

const SLASH_COMMANDS = [
  { cmd: "/ticket", hint: "Create a ticket from this conversation", icon: TicketIcon },
  { cmd: "/meet", hint: "Send a Google Meet link", icon: Video },
  { cmd: "/canned", hint: "Insert a canned response", icon: MessageSquare },
  { cmd: "/call", hint: "Log a phone call note", icon: Phone },
];

export function ChatWorkspace({
  currentUser,
  initialThreads,
  cannedResponses,
}: {
  currentUser: UserProfile;
  initialThreads: ChatThread[];
  cannedResponses: CannedResponse[];
}) {
  const [threads, setThreads] = useState(initialThreads);
  const [threadView, setThreadView] = useState<"active" | "archived">("active");
  const [activeId, setActiveId] = useState<string | null>(
    initialThreads.find((t) => t.status === "active")?.id ?? null
  );
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  // Derived loading flag: true until messages for the active thread land.
  const [loadedThreadId, setLoadedThreadId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unreadByThread, setUnreadByThread] = useState<Record<string, number>>({});
  const bottomRef = useRef<HTMLDivElement>(null);

  const active = useMemo(
    () => threads.find((t) => t.id === activeId) ?? null,
    [threads, activeId]
  );
  const loadingMessages = !!activeId && loadedThreadId !== activeId;

  // Archived = closed threads; read-only until the client is reactivated.
  const visibleThreads = useMemo(
    () =>
      threads.filter((t) =>
        threadView === "active" ? t.status === "active" : t.status === "closed"
      ),
    [threads, threadView]
  );

  const showSlashMenu = draft.startsWith("/") && !draft.includes(" ");
  const matchingCommands = SLASH_COMMANDS.filter((c) => c.cmd.startsWith(draft.toLowerCase()));
  const showCannedPicker = draft.toLowerCase().startsWith("/canned");

  // Unread counts for the thread list.
  useEffect(() => {
    const supabase = createClient();
    supabase
      .from("chat_messages")
      .select("thread_id")
      .eq("sender_type", "client")
      .is("read_at", null)
      .then(({ data }) => {
        const counts: Record<string, number> = {};
        for (const m of data ?? []) {
          counts[m.thread_id] = (counts[m.thread_id] ?? 0) + 1;
        }
        setUnreadByThread(counts);
      });
  }, []);

  // Load + mark read on thread select.
  useEffect(() => {
    if (!activeId) return;
    let cancelled = false;
    const supabase = createClient();

    supabase
      .from("chat_messages")
      .select("*, sender:users(id, full_name, avatar_url)")
      .eq("thread_id", activeId)
      .order("sent_at", { ascending: true })
      .then(async ({ data }) => {
        if (cancelled) return;
        setMessages((data ?? []) as ChatMessage[]);
        setLoadedThreadId(activeId);
        await supabase
          .from("chat_messages")
          .update({ read_at: new Date().toISOString() })
          .eq("thread_id", activeId)
          .eq("sender_type", "client")
          .is("read_at", null);
        setUnreadByThread((prev) => ({ ...prev, [activeId]: 0 }));
      });

    return () => {
      cancelled = true;
    };
  }, [activeId]);

  // Realtime: new messages across all threads.
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`team-chat-${currentUser.id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "chat_messages" },
        async (payload) => {
          const incoming = payload.new as ChatMessage;
          setThreads((prev) =>
            prev
              .map((t) =>
                t.id === incoming.thread_id
                  ? { ...t, last_message_at: incoming.sent_at }
                  : t
              )
              .sort(
                (a, b) =>
                  new Date(b.last_message_at ?? b.created_at).getTime() -
                  new Date(a.last_message_at ?? a.created_at).getTime()
              )
          );
          if (incoming.thread_id === activeId) {
            if (incoming.sender_id) {
              const { data: sender } = await supabase
                .from("users")
                .select("id, full_name, avatar_url")
                .eq("id", incoming.sender_id)
                .single();
              incoming.sender = sender ?? null;
            }
            setMessages((prev) =>
              prev.some((m) => m.id === incoming.id) ? prev : [...prev, incoming]
            );
          } else if (incoming.sender_type === "client") {
            setUnreadByThread((prev) => ({
              ...prev,
              [incoming.thread_id]: (prev[incoming.thread_id] ?? 0) + 1,
            }));
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [activeId, currentUser.id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  async function sendMessage(
    thread: ChatThread,
    content: string | null,
    messageType: MessageType = "text",
    metadata: Record<string, unknown> | null = null
  ) {
    const supabase = createClient();
    const { data, error: sendError } = await supabase
      .from("chat_messages")
      .insert({
        thread_id: thread.id,
        sender_id: currentUser.id,
        sender_type: "team",
        content,
        message_type: messageType,
        metadata,
      })
      .select("*, sender:users(id, full_name, avatar_url)")
      .single();

    if (sendError || !data) {
      setError(sendError?.message ?? "Message failed to send.");
      return;
    }

    await supabase
      .from("chat_threads")
      .update({ last_message_at: new Date().toISOString() })
      .eq("id", thread.id);

    setMessages((prev) =>
      prev.some((m) => m.id === data.id) ? prev : [...prev, data as ChatMessage]
    );

    await mirrorToSmsIfNeeded(thread, content, messageType, metadata);
  }

  /**
   * If the client's last message arrived via SMS (GHL webhook), mirror
   * this reply to their phone so the conversation continues over text.
   */
  async function mirrorToSmsIfNeeded(
    thread: ChatThread,
    content: string | null,
    messageType: MessageType,
    metadata: Record<string, unknown> | null
  ) {
    if (!content) return;
    if (messageType !== "text" && messageType !== "meet_link") return;

    const lastClientMessage = [...messages]
      .reverse()
      .find((m) => m.sender_type === "client");
    const source = (lastClientMessage?.metadata as { source?: string } | null)
      ?.source;
    if (source !== "sms") return;

    const smsBody =
      messageType === "meet_link"
        ? `${content}: ${(metadata as { url?: string } | null)?.url ?? ""}`
        : content;

    try {
      const res = await fetch("/api/chat/send-sms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ threadId: thread.id, message: smsBody }),
      });
      if (!res.ok) {
        const { error: smsError } = await res
          .json()
          .catch(() => ({ error: `HTTP ${res.status}` }));
        setError(`Message saved, but SMS mirror failed: ${smsError}`);
      }
    } catch {
      setError("Message saved, but SMS mirror failed: network error.");
    }
  }

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!active || !draft.trim() || sending) return;
    setError(null);
    setSending(true);
    const text = draft.trim();
    const supabase = createClient();

    if (text.startsWith("/ticket")) {
      // /ticket <title> — creates a chat-sourced ticket and drops a ticket card.
      const title = text.replace("/ticket", "").trim() || "Ticket from chat";
      const { data: ticket, error: ticketError } = await supabase
        .from("tickets")
        .insert({
          title,
          description: `Created from chat thread with ${active.client?.company_name ?? "client"}.`,
          category: "general",
          client_id: active.client_id,
          created_by: currentUser.id,
          source: "chat",
        })
        .select()
        .single();

      if (ticketError || !ticket) {
        setError(ticketError?.message ?? "Could not create the ticket.");
      } else {
        await Promise.all([
          logTicketActivity(supabase, {
            ticketId: ticket.id,
            userId: currentUser.id,
            action: "created",
            newValue: title,
          }),
          logAudit(supabase, {
            userId: currentUser.id,
            entityType: "ticket",
            entityId: ticket.id,
            action: "ticket_created",
            details: { title, source: "chat" },
          }),
        ]);
        await sendMessage(active, title, "ticket_card", {
          ticket_id: ticket.id,
          ticket_title: title,
          ticket_status: "open",
        });
      }
    } else if (text.startsWith("/meet")) {
      const url = text.replace("/meet", "").trim() || "https://meet.google.com/new";
      await sendMessage(active, "Join our Google Meet", "meet_link", { url });
    } else if (text.startsWith("/call")) {
      const note = text.replace("/call", "").trim() || "Call requested";
      await sendMessage(active, `📞 ${note}`, "text");
    } else {
      await sendMessage(active, text, "text");
    }

    setDraft("");
    setSending(false);
  }

  async function resolveThread(thread: ChatThread) {
    const supabase = createClient();
    const { error: updateError } = await supabase
      .from("chat_threads")
      .update({ status: "closed" })
      .eq("id", thread.id);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    setThreads((prev) =>
      prev.map((t) => (t.id === thread.id ? { ...t, status: "closed" } : t))
    );
    await logAudit(supabase, {
      userId: currentUser.id,
      entityType: "chat_thread",
      entityId: thread.id,
      action: "thread_resolved",
      details: { client: thread.client?.company_name },
    });
  }

  return (
    <div className="flex h-[calc(100vh-57px)] flex-1 md:h-[calc(100vh-53px)]">
      {/* Thread list */}
      <aside className="flex w-full max-w-xs shrink-0 flex-col border-r border-border sm:w-80">
        <div className="space-y-2.5 border-b border-border px-4 py-3.5">
          <div>
            <h1 className="text-base font-semibold tracking-tight">Chat</h1>
            <p className="text-xs text-muted-foreground">
              {threads.filter((t) => t.status === "active").length} active conversations
            </p>
          </div>
          <div className="flex rounded-md border border-border p-0.5">
            {(["active", "archived"] as const).map((view) => (
              <button
                key={view}
                onClick={() => setThreadView(view)}
                className={cn(
                  "flex-1 rounded px-2.5 py-1 text-xs font-medium capitalize transition-colors",
                  threadView === view
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {view}
              </button>
            ))}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {visibleThreads.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">
              {threadView === "active"
                ? "No active conversations."
                : "No archived conversations."}
            </p>
          ) : (
            visibleThreads.map((thread) => {
              const unread = unreadByThread[thread.id] ?? 0;
              return (
                <button
                  key={thread.id}
                  onClick={() => setActiveId(thread.id)}
                  className={cn(
                    "flex w-full items-center gap-3 border-b border-border/50 px-4 py-3 text-left transition-colors",
                    activeId === thread.id ? "bg-accent" : "hover:bg-accent/50"
                  )}
                >
                  <UserAvatar
                    name={thread.client?.company_name}
                    avatarUrl={thread.client?.logo_url}
                    className="size-9"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-sm font-medium">
                        {thread.client?.company_name ?? "Unknown client"}
                      </p>
                      <span className="shrink-0 text-[10px] text-muted-foreground">
                        {timeAgo(thread.last_message_at ?? thread.created_at)}
                      </span>
                    </div>
                    <div className="mt-0.5 flex items-center gap-1.5">
                      {thread.category && (
                        <Badge variant="outline" className="h-4 px-1.5 text-[10px]">
                          {thread.category}
                        </Badge>
                      )}
                      <span
                        className={cn(
                          "text-[11px]",
                          thread.status === "active"
                            ? "text-emerald-400"
                            : "text-muted-foreground"
                        )}
                      >
                        {thread.status === "active" ? "Active" : "Closed"}
                      </span>
                      {unread > 0 && (
                        <span className="ml-auto flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground">
                          {unread}
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </aside>

      {/* Chat panel */}
      <div className="hidden min-w-0 flex-1 flex-col sm:flex">
        {!active ? (
          <div className="flex flex-1 items-center justify-center p-8">
            <EmptyState
              icon={MessageSquare}
              title="Select a conversation"
              description="Pick a thread from the left to see the full history."
            />
          </div>
        ) : (
          <>
            <header className="flex items-center justify-between border-b border-border px-5 py-3">
              <div className="flex items-center gap-3">
                <UserAvatar
                  name={active.client?.company_name}
                  avatarUrl={active.client?.logo_url}
                  className="size-9"
                />
                <div>
                  <p className="text-sm font-semibold">
                    {active.client?.company_name ?? "Unknown client"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {active.category ?? "General"} ·{" "}
                    {active.status === "active" ? "Active" : "Closed"}
                  </p>
                </div>
              </div>
              {active.status === "active" && (
                <Button variant="outline" size="sm" onClick={() => resolveThread(active)}>
                  <CheckCircle2 className="size-4 text-emerald-400" /> Resolve
                </Button>
              )}
            </header>

            <div className="flex-1 space-y-4 overflow-y-auto p-5">
              {loadingMessages ? (
                <p className="text-center text-sm text-muted-foreground">Loading messages…</p>
              ) : messages.length === 0 ? (
                <EmptyState
                  icon={MessageSquare}
                  title="No messages in this thread"
                  description="Say hello to get things moving."
                />
              ) : (
                messages.map((m) => (
                  <MessageBubble
                    key={m.id}
                    message={m}
                    viewer="team"
                    ticketHrefBase="/dashboard/tickets"
                  />
                ))
              )}
              <div ref={bottomRef} />
            </div>

            <div className="relative border-t border-border p-4">
              {/* Slash command menu */}
              {showSlashMenu && matchingCommands.length > 0 && (
                <div className="absolute bottom-full left-4 mb-1 w-80 rounded-lg border border-border bg-popover p-1 shadow-lg">
                  {matchingCommands.map(({ cmd, hint, icon: Icon }) => (
                    <button
                      key={cmd}
                      onClick={() => setDraft(`${cmd} `)}
                      className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm hover:bg-accent"
                    >
                      <Icon className="size-4 text-primary" />
                      <span className="font-mono font-medium">{cmd}</span>
                      <span className="truncate text-xs text-muted-foreground">{hint}</span>
                    </button>
                  ))}
                </div>
              )}

              {/* Canned response picker */}
              {showCannedPicker && (
                <div className="absolute bottom-full left-4 mb-1 max-h-64 w-96 overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-lg">
                  {cannedResponses.length === 0 ? (
                    <p className="px-3 py-2 text-sm text-muted-foreground">
                      No canned responses yet — add them in Settings.
                    </p>
                  ) : (
                    cannedResponses.map((c) => (
                      <button
                        key={c.id}
                        onClick={() => setDraft(c.body)}
                        className="block w-full rounded-md px-3 py-2 text-left hover:bg-accent"
                      >
                        <p className="text-sm font-medium">{c.title}</p>
                        <p className="truncate text-xs text-muted-foreground">{c.body}</p>
                      </button>
                    ))
                  )}
                </div>
              )}

              <form onSubmit={handleSend} className="flex items-center gap-2">
                <Slash className="size-4 shrink-0 text-muted-foreground" />
                <Input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder={
                    active.status === "active"
                      ? "Message, or / for commands (/ticket, /meet, /canned, /call)…"
                      : "This thread is closed."
                  }
                  disabled={active.status !== "active"}
                  aria-label="Message"
                />
                <Button
                  type="submit"
                  size="icon"
                  disabled={sending || !draft.trim() || active.status !== "active"}
                >
                  <SendHorizonal className="size-4" />
                </Button>
              </form>
              {error && (
                <p className="mt-2 text-sm text-destructive" role="alert">
                  {error}
                </p>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
