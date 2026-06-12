"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  CheckCircle2,
  MessageSquare,
  Phone,
  Plus,
  SendHorizonal,
  Slash,
  Ticket as TicketIcon,
  Users,
  Video,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
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
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/empty-state";
import { MessageBubble } from "@/components/chat/message-bubble";
import { UserAvatar } from "@/components/user-avatar";
import { createClient } from "@/lib/supabase/client";
import { logAudit, logTicketActivity } from "@/lib/audit";
import { formatDuration, timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";
import type {
  CannedResponse,
  ChatMessage,
  ChatThread,
  Client,
  MessageType,
  UserProfile,
} from "@/lib/types";

const SLASH_COMMANDS = [
  { cmd: "/ticket", hint: "Create a ticket from this conversation", icon: TicketIcon },
  { cmd: "/meet", hint: "Send a Google Meet link", icon: Video },
  { cmd: "/canned", hint: "Insert a canned response", icon: MessageSquare },
  { cmd: "/call", hint: "Log a phone call note", icon: Phone },
];

type TeamMemberOption = Pick<UserProfile, "id" | "full_name" | "avatar_url">;
type ClientOption = Pick<Client, "id" | "company_name" | "logo_url">;

/** Display name for a thread — internal threads use their title. */
function threadName(thread: ChatThread): string {
  if (thread.category === "internal") {
    return thread.title ?? "Internal chat";
  }
  return thread.client?.company_name ?? "Unknown client";
}

export function ChatWorkspace({
  currentUser,
  initialThreads,
  cannedResponses,
  teamMembers,
  clients,
}: {
  currentUser: UserProfile;
  initialThreads: ChatThread[];
  cannedResponses: CannedResponse[];
  teamMembers: TeamMemberOption[];
  clients: ClientOption[];
}) {
  const [threads, setThreads] = useState(initialThreads);
  const [threadView, setThreadView] = useState<"active" | "archived">("active");
  const [chatScope, setChatScope] = useState<"workspace" | "sessions" | "internal">(
    "workspace"
  );
  const [activeId, setActiveId] = useState<string | null>(
    initialThreads.find((t) => t.category === "workspace")?.id ?? null
  );
  const inputRef = useRef<HTMLInputElement>(null);

  // New Chat dialog
  const [newChatOpen, setNewChatOpen] = useState(false);
  const [selectedMembers, setSelectedMembers] = useState<Set<string>>(new Set());
  const [selectedClientId, setSelectedClientId] = useState("");
  const [sessionCategory, setSessionCategory] = useState("general");
  const [creatingChat, setCreatingChat] = useState(false);

  // Quick actions (header icons)
  const [cannedOpen, setCannedOpen] = useState(false);
  const [ticketDialogOpen, setTicketDialogOpen] = useState(false);
  const [ticketTitle, setTicketTitle] = useState("");
  const [quickBusy, setQuickBusy] = useState(false);
  const [activeCall, setActiveCall] = useState<{
    contactName: string;
    startedAt: number;
  } | null>(null);
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

  // Workspace threads are permanent (no archive concept); sessions and
  // internal threads split into active/archived.
  const visibleThreads = useMemo(
    () =>
      threads.filter((t) => {
        const scopeMatch =
          chatScope === "workspace"
            ? t.category === "workspace"
            : chatScope === "internal"
              ? t.category === "internal"
              : t.category !== "workspace" && t.category !== "internal";
        if (!scopeMatch) return false;
        if (chatScope === "workspace") return true;
        return threadView === "active"
          ? t.status === "active"
          : t.status === "closed";
      }),
    [threads, threadView, chatScope]
  );

  // Header contact: the most recent client sender we can name, falling
  // back to the client's primary contact.
  const activeContactName = useMemo(() => {
    const lastNamedSender = [...messages]
      .reverse()
      .find((m) => m.sender_type === "client" && m.sender?.full_name);
    return lastNamedSender?.sender?.full_name ?? active?.client?.contact_name ?? null;
  }, [messages, active]);

  const showSlashMenu = draft.startsWith("/") && !draft.includes(" ");
  const matchingCommands = SLASH_COMMANDS.filter((c) => c.cmd.startsWith(draft.toLowerCase()));
  const showCannedPicker =
    cannedOpen || draft.toLowerCase().startsWith("/canned");

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

  // The widget hides itself when the call's completion log arrives
  // from the ghl-call-log webhook (derived, not an effect).
  const callFinished = useMemo(() => {
    if (!activeCall) return false;
    return messages.some((m) => {
      if (m.message_type !== "call_log") return false;
      const meta = (m.metadata ?? {}) as { status?: string };
      return (
        !!meta.status &&
        meta.status !== "initiated" &&
        new Date(m.sent_at).getTime() >= activeCall.startedAt
      );
    });
  }, [messages, activeCall]);
  const showCallWidget = !!activeCall && !callFinished;

  // Tick the call widget's elapsed timer once a second.
  const [, setCallTick] = useState(0);
  useEffect(() => {
    if (!showCallWidget) return;
    const interval = setInterval(() => setCallTick((n) => n + 1), 1000);
    return () => clearInterval(interval);
  }, [showCallWidget]);

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
    // Only support sessions mirror to SMS — workspace and internal
    // threads are web-only.
    if (thread.category === "workspace" || thread.category === "internal") return;
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

    if (text.startsWith("/ticket")) {
      // /ticket <title> — creates a chat-sourced ticket and drops a ticket card.
      await createTicketFromChat(text.replace("/ticket", "").trim() || "Ticket from chat");
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

  /** Shared by the /ticket command and the quick-action dialog. */
  async function createTicketFromChat(title: string) {
    if (!active) return false;
    const supabase = createClient();

    // Session threads keep their issue category on the ticket.
    const validCategories = ["seo", "ghl", "software", "billing", "general"];
    const category = validCategories.includes(active.category ?? "")
      ? active.category
      : "general";

    const { data: ticket, error: ticketError } = await supabase
      .from("tickets")
      .insert({
        title,
        description: `Created from chat thread with ${active.client?.company_name ?? "client"}.`,
        category,
        client_id: active.client_id,
        created_by: currentUser.id,
        source: "chat",
      })
      .select()
      .single();

    if (ticketError || !ticket) {
      setError(ticketError?.message ?? "Could not create the ticket.");
      return false;
    }

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

    if (active.category === "workspace") {
      // Dispatch Bot announces it here via the DB trigger — no manual
      // card, or we'd double-post.
    } else {
      await sendMessage(active, title, "ticket_card", {
        ticket_id: ticket.id,
        ticket_title: title,
        ticket_status: "open",
      });
      // Sessions link to the ticket so they auto-close on resolve.
      if (active.category !== "internal") {
        await supabase
          .from("chat_threads")
          .update({ linked_ticket_id: ticket.id })
          .eq("id", active.id);
        setThreads((prev) =>
          prev.map((t) =>
            t.id === active.id ? { ...t, linked_ticket_id: ticket.id } : t
          )
        );
      }
    }
    return true;
  }

  // --- Header quick actions: act immediately, no command typing. ---

  /** Sends a Meet link card right away. */
  async function quickMeet() {
    if (!active || quickBusy) return;
    setQuickBusy(true);
    await sendMessage(active, "Join our Google Meet", "meet_link", {
      url: "https://meet.google.com/new",
    });
    setQuickBusy(false);
  }

  /** Opens the create-ticket dialog, title prefilled from chat context. */
  function quickTicket() {
    const lastClient = [...messages]
      .reverse()
      .find((m) => m.sender_type === "client" && m.content);
    setTicketTitle(lastClient?.content?.slice(0, 80) ?? "");
    setTicketDialogOpen(true);
  }

  async function submitQuickTicket(e: React.FormEvent) {
    e.preventDefault();
    if (!ticketTitle.trim() || quickBusy) return;
    setQuickBusy(true);
    const ok = await createTicketFromChat(ticketTitle.trim());
    if (ok) {
      setTicketDialogOpen(false);
      setTicketTitle("");
    }
    setQuickBusy(false);
  }

  /**
   * Call the client: posts a call_log to the thread and opens the GHL
   * dialer deep link (GHL has no remote-dial API — the agent's browser
   * softphone connects first, then GHL bridges to the client from the
   * Dispatch number). Status/duration/recording arrive later via the
   * ghl-call-log webhook.
   */
  async function quickCall() {
    if (!active || quickBusy) return;
    setQuickBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/calls/initiate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ threadId: active.id }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        url?: string;
        contactName?: string;
        error?: string;
      };
      if (!res.ok || !data.url) {
        setError(data.error ?? `Call setup failed (HTTP ${res.status}).`);
      } else {
        setActiveCall({
          contactName: data.contactName ?? "client",
          startedAt: Date.now(),
        });
        window.open(data.url, "_blank", "noopener");
      }
    } catch {
      setError("Call setup failed: network error.");
    }
    setQuickBusy(false);
  }

  /** Internal: reuse the thread with this exact participant set, or create one. */
  async function startInternalChat() {
    const participants = Array.from(
      new Set([...selectedMembers, currentUser.id])
    ).sort();
    if (participants.length < 2) return;
    setCreatingChat(true);
    setError(null);

    const existing = threads.find(
      (t) =>
        t.category === "internal" &&
        t.participant_ids &&
        [...t.participant_ids].sort().join(",") === participants.join(",")
    );
    if (existing) {
      setChatScope("internal");
      setThreadView(existing.status === "active" ? "active" : "archived");
      setActiveId(existing.id);
      setNewChatOpen(false);
      setCreatingChat(false);
      return;
    }

    const supabase = createClient();
    const others = teamMembers.filter((m) => selectedMembers.has(m.id));
    const title = others.map((m) => m.full_name.split(" ")[0]).join(", ");

    const { data: thread, error: createError } = await supabase
      .from("chat_threads")
      .insert({
        client_id: null,
        status: "active",
        category: "internal",
        title: title || "Internal chat",
        participant_ids: participants,
        created_by: currentUser.id,
        last_message_at: new Date().toISOString(),
      })
      .select("*")
      .single();

    if (createError || !thread) {
      setError(createError?.message ?? "Failed to start the chat.");
      setCreatingChat(false);
      return;
    }

    await logAudit(supabase, {
      userId: currentUser.id,
      entityType: "chat_thread",
      entityId: thread.id,
      action: "internal_thread_created",
      details: { participants },
    });

    setThreads((prev) => [thread as ChatThread, ...prev]);
    setChatScope("internal");
    setThreadView("active");
    setActiveId(thread.id);
    setSelectedMembers(new Set());
    setNewChatOpen(false);
    setCreatingChat(false);
  }

  /** Workspace: open the client's persistent thread (create if missing). */
  async function openWorkspaceChat() {
    if (!selectedClientId) return;
    setCreatingChat(true);
    setError(null);

    const existing = threads.find(
      (t) => t.client_id === selectedClientId && t.category === "workspace"
    );
    if (existing) {
      setChatScope("workspace");
      setActiveId(existing.id);
      setNewChatOpen(false);
      setCreatingChat(false);
      return;
    }

    const supabase = createClient();
    const { data: thread, error: createError } = await supabase
      .from("chat_threads")
      .insert({
        client_id: selectedClientId,
        status: "active",
        category: "workspace",
        created_by: currentUser.id,
      })
      .select("*, client:clients(id, company_name, contact_name, logo_url)")
      .single();

    if (createError || !thread) {
      setError(createError?.message ?? "Failed to open the workspace chat.");
      setCreatingChat(false);
      return;
    }

    setThreads((prev) => [thread as ChatThread, ...prev]);
    setChatScope("workspace");
    setActiveId(thread.id);
    setSelectedClientId("");
    setNewChatOpen(false);
    setCreatingChat(false);
  }

  /** Sessions: start a new issue-scoped session for a client. */
  async function startSessionChat() {
    if (!selectedClientId) return;
    setCreatingChat(true);
    setError(null);

    const supabase = createClient();
    const { data: thread, error: createError } = await supabase
      .from("chat_threads")
      .insert({
        client_id: selectedClientId,
        status: "active",
        category: sessionCategory,
        created_by: currentUser.id,
        last_message_at: new Date().toISOString(),
      })
      .select("*, client:clients(id, company_name, contact_name, logo_url)")
      .single();

    if (createError || !thread) {
      setError(createError?.message ?? "Failed to start the session.");
      setCreatingChat(false);
      return;
    }

    setThreads((prev) => [thread as ChatThread, ...prev]);
    setChatScope("sessions");
    setThreadView("active");
    setActiveId(thread.id);
    setSelectedClientId("");
    setNewChatOpen(false);
    setCreatingChat(false);
  }

  return (
    <div className="flex h-[calc(100vh-57px)] flex-1 md:h-[calc(100vh-53px)]">
      {/* Thread list */}
      <aside className="flex w-full max-w-xs shrink-0 flex-col border-r border-border sm:w-80">
        <div className="space-y-2.5 border-b border-border px-4 py-3.5">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-base font-semibold tracking-tight">Chat</h1>
              <p className="text-xs text-muted-foreground">
                {threads.filter((t) => t.status === "active").length} active conversations
              </p>
            </div>
            <Button size="sm" onClick={() => setNewChatOpen(true)}>
              <Plus className="size-4" /> New Chat
            </Button>
          </div>
          <div className="flex rounded-md border border-border p-0.5">
            {(
              [
                { key: "workspace", label: "Workspace" },
                { key: "sessions", label: "Sessions" },
                { key: "internal", label: "Internal" },
              ] as const
            ).map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setChatScope(key)}
                className={cn(
                  "flex-1 rounded px-2.5 py-1 text-xs font-medium transition-colors",
                  chatScope === key
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {label}
              </button>
            ))}
          </div>
          {chatScope !== "workspace" && (
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
          )}
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
                    name={threadName(thread)}
                    avatarUrl={thread.client?.logo_url}
                    className="size-9"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-sm font-medium">
                        {threadName(thread)}
                      </p>
                      <span className="shrink-0 text-[10px] text-muted-foreground">
                        {timeAgo(thread.last_message_at ?? thread.created_at)}
                      </span>
                    </div>
                    <div className="mt-0.5 flex items-center gap-1.5">
                      {thread.category === "workspace" ? (
                        <span className="text-[11px] text-muted-foreground">
                          Workspace
                        </span>
                      ) : (
                        <>
                          {thread.category && thread.category !== "internal" && (
                            <Badge variant="outline" className="h-4 px-1.5 text-[10px]">
                              {thread.category}
                            </Badge>
                          )}
                          {thread.linked_ticket_id && (
                            <TicketIcon
                              className="size-3 text-primary"
                              aria-label="Linked ticket"
                            />
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
                        </>
                      )}
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
            <header className="flex items-center justify-between gap-3 border-b border-border px-5 py-3">
              <div className="flex min-w-0 items-center gap-3">
                <UserAvatar
                  name={threadName(active)}
                  avatarUrl={active.client?.logo_url}
                  className="size-9"
                />
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">
                    {active.category === "internal"
                      ? threadName(active)
                      : activeContactName
                        ? `${activeContactName} · ${active.client?.company_name ?? "Unknown client"}`
                        : (active.client?.company_name ?? "Unknown client")}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {active.category === "workspace"
                      ? "Workspace · Always active"
                      : active.category === "internal"
                        ? `Internal team · ${active.status === "active" ? "Active" : "Closed"}`
                        : `${active.category ?? "general"} session · ${active.status === "active" ? "Active" : "Closed"}`}
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {active.status === "active" && (
                  <>
                    {/* Quick actions — immediate, no command typing. */}
                    <Button
                      variant="ghost"
                      size="icon"
                      title="Create ticket from this chat"
                      aria-label="Create ticket from this chat"
                      onClick={quickTicket}
                      disabled={quickBusy}
                    >
                      <TicketIcon className="size-4 text-muted-foreground" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      title="Send a Google Meet link"
                      aria-label="Send a Google Meet link"
                      onClick={quickMeet}
                      disabled={quickBusy}
                    >
                      <Video className="size-4 text-muted-foreground" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      title="Insert a canned response"
                      aria-label="Insert a canned response"
                      onClick={() => setCannedOpen((v) => !v)}
                    >
                      <MessageSquare className="size-4 text-muted-foreground" />
                    </Button>
                    {active.category !== "internal" && (
                      <Button
                        variant="ghost"
                        size="icon"
                        title="Call this client via the GHL dialer"
                        aria-label="Call this client via the GHL dialer"
                        onClick={quickCall}
                        disabled={quickBusy}
                      >
                        <Phone className="size-4 text-muted-foreground" />
                      </Button>
                    )}
                    {active.category !== "workspace" && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="ml-1"
                        onClick={() => resolveThread(active)}
                      >
                        <CheckCircle2 className="size-4 text-emerald-400" /> Resolve
                      </Button>
                    )}
                  </>
                )}
              </div>
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
                    clientCompany={active.client?.company_name}
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
                        onClick={() => {
                          // Insert for review — sent when the agent hits enter.
                          setDraft(c.body);
                          setCannedOpen(false);
                          inputRef.current?.focus();
                        }}
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
                  ref={inputRef}
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

      {/* Floating call status widget */}
      {showCallWidget && activeCall && (
        <div className="fixed bottom-5 right-5 z-50 flex items-center gap-3 rounded-xl border border-border bg-card p-3.5 shadow-lg">
          <span className="relative flex size-9 items-center justify-center rounded-full bg-emerald-500/15">
            <Phone className="size-4 text-emerald-400" />
            <span className="absolute inset-0 animate-ping rounded-full bg-emerald-500/20" />
          </span>
          <div className="leading-tight">
            <p className="text-sm font-medium">
              Call with {activeCall.contactName}
            </p>
            <p className="text-xs tabular-nums text-muted-foreground">
              {formatDuration(
                Math.floor((Date.now() - activeCall.startedAt) / 1000)
              )}{" "}
              · complete it in the GHL dialer tab
            </p>
          </div>
          <button
            onClick={() => setActiveCall(null)}
            className="ml-1 rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label="Dismiss call status"
          >
            ✕
          </button>
        </div>
      )}

      {/* Quick-action: create ticket from chat context */}
      <Dialog open={ticketDialogOpen} onOpenChange={setTicketDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create ticket</DialogTitle>
            <DialogDescription>
              {active
                ? `Files a ${active.category === "workspace" || active.category === "internal" ? "general" : (active.category ?? "general")} ticket for ${threadName(active)} and posts the card to chat.`
                : "Files a ticket from this conversation."}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submitQuickTicket} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="qt-title">Title</Label>
              <Input
                id="qt-title"
                required
                value={ticketTitle}
                onChange={(e) => setTicketTitle(e.target.value)}
                placeholder="Summary of the issue"
              />
            </div>
            <Button
              type="submit"
              className="w-full"
              disabled={quickBusy || !ticketTitle.trim()}
            >
              {quickBusy ? "Creating…" : "Create ticket"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      {/* New Chat dialog — mode follows the current scope toggle. */}
      <Dialog open={newChatOpen} onOpenChange={setNewChatOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {chatScope === "internal"
                ? "New internal chat"
                : chatScope === "sessions"
                  ? "New support session"
                  : "Open workspace chat"}
            </DialogTitle>
            <DialogDescription>
              {chatScope === "internal"
                ? "Pick teammates — reopens the existing thread if you've chatted before."
                : chatScope === "sessions"
                  ? "Starts a new issue-scoped session for a client."
                  : "Every client has one persistent workspace chat."}
            </DialogDescription>
          </DialogHeader>

          {chatScope === "internal" ? (
            <div className="space-y-3">
              <div className="max-h-64 space-y-1 overflow-y-auto rounded-md border border-border p-2">
                {teamMembers
                  .filter((m) => m.id !== currentUser.id)
                  .map((member) => (
                    <label
                      key={member.id}
                      className="flex cursor-pointer items-center gap-2.5 rounded px-2 py-1.5 hover:bg-accent/50"
                    >
                      <Checkbox
                        checked={selectedMembers.has(member.id)}
                        onCheckedChange={(v) => {
                          setSelectedMembers((prev) => {
                            const next = new Set(prev);
                            if (v === true) next.add(member.id);
                            else next.delete(member.id);
                            return next;
                          });
                        }}
                      />
                      <UserAvatar
                        name={member.full_name}
                        avatarUrl={member.avatar_url}
                        className="size-6"
                      />
                      <span className="text-sm">{member.full_name}</span>
                    </label>
                  ))}
                {teamMembers.length <= 1 && (
                  <p className="flex items-center gap-2 px-2 py-1.5 text-sm text-muted-foreground">
                    <Users className="size-4" /> No other team members yet.
                  </p>
                )}
              </div>
              <Button
                className="w-full"
                onClick={startInternalChat}
                disabled={creatingChat || selectedMembers.size === 0}
              >
                {creatingChat
                  ? "Starting…"
                  : `Start chat with ${selectedMembers.size} ${selectedMembers.size === 1 ? "person" : "people"}`}
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              <Select value={selectedClientId} onValueChange={setSelectedClientId}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose a client" />
                </SelectTrigger>
                <SelectContent>
                  {clients.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.company_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {chatScope === "sessions" && (
                <Select value={sessionCategory} onValueChange={setSessionCategory}>
                  <SelectTrigger>
                    <SelectValue placeholder="Category" />
                  </SelectTrigger>
                  <SelectContent>
                    {["seo", "ghl", "software", "billing", "general"].map((c) => (
                      <SelectItem key={c} value={c}>
                        {c.toUpperCase()}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <Button
                className="w-full"
                onClick={
                  chatScope === "sessions" ? startSessionChat : openWorkspaceChat
                }
                disabled={creatingChat || !selectedClientId}
              >
                {creatingChat
                  ? "Opening…"
                  : chatScope === "sessions"
                    ? "Start session"
                    : "Open workspace"}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
