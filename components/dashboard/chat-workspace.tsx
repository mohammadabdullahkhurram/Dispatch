"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Building2,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  MessageSquare,
  Plus,
  Search,
  SendHorizonal,
  Settings2,
  Slash,
  Ticket as TicketIcon,
  Trash2,
  UserPlus,
  Users,
  Video,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
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
import { Textarea } from "@/components/ui/textarea";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { EmptyState } from "@/components/empty-state";
import { ChatTextarea } from "@/components/chat/chat-textarea";
import { MessageBubble } from "@/components/chat/message-bubble";
import { PresenceDot, isOnline, usePresenceHeartbeat } from "@/components/chat/presence";
import {
  installAudioUnlock,
  notifyBrowser,
  playDing,
  requestNotificationPermission,
} from "@/components/chat/notify";
import { UserAvatar } from "@/components/user-avatar";
import { createClient } from "@/lib/supabase/client";
import { slaDeadline } from "@/lib/sla";
import { logAudit, logTicketActivity } from "@/lib/audit";
import { cn } from "@/lib/utils";
import {
  type CannedResponse,
  type ChatMessage,
  type ChatThread,
  type ChatType,
  type Client,
  type MessageType,
  type Priority,
  type TicketCategory,
  type UserProfile,
} from "@/lib/types";

const SLASH_COMMANDS = [
  { cmd: "/ticket", hint: "Create a ticket from this conversation", icon: TicketIcon },
  { cmd: "/meet", hint: "Send a Google Meet link", icon: Video },
  { cmd: "/canned", hint: "Insert a canned response", icon: MessageSquare },
];

type DirectoryUser = {
  id: string;
  full_name: string;
  avatar_url: string | null;
  last_seen: string | null;
  role: string;
};
type ClientUserLink = { client_id: string; user_id: string; role: string };
type TeamMemberOption = Pick<UserProfile, "id" | "full_name" | "avatar_url">;
type ClientOption = Pick<Client, "id" | "company_name" | "logo_url">;

type NewChatMode =
  | "menu"
  | "workspace_dm"
  | "workspace_group"
  | "internal_dm"
  | "internal_group";

const SELECT_COLS = `*,
  client:clients(id, company_name, contact_name, logo_url),
  poc:users!chat_threads_point_of_contact_id_fkey(id, full_name)`;

export function ChatWorkspace({
  currentUser,
  initialThreads,
  cannedResponses,
  teamMembers,
  clients,
  directory,
  clientUsers,
}: {
  currentUser: UserProfile;
  initialThreads: ChatThread[];
  cannedResponses: CannedResponse[];
  teamMembers: TeamMemberOption[];
  clients: ClientOption[];
  directory: DirectoryUser[];
  clientUsers: ClientUserLink[];
}) {
  usePresenceHeartbeat(currentUser.id);

  const [threads, setThreads] = useState(initialThreads);
  const [activeId, setActiveId] = useState<string | null>(
    initialThreads.find((t) => t.chat_type === "workspace")?.id ??
      initialThreads[0]?.id ??
      null
  );
  const [search, setSearch] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);
  // Mirrors the set of known thread ids so the realtime handler can
  // tell a genuinely-new session from a re-delivery without re-notifying.
  const threadIdsRef = useRef<Set<string>>(
    new Set(initialThreads.map((t) => t.id))
  );

  const isAdmin =
    currentUser.role === "agency_owner" || currentUser.role === "agency_admin";

  const dir = useMemo(
    () => Object.fromEntries(directory.map((u) => [u.id, u])),
    [directory]
  );

  // New Chat dialog
  const [newChatOpen, setNewChatOpen] = useState(false);
  const [newChatMode, setNewChatMode] = useState<NewChatMode>("menu");
  const [pickClientId, setPickClientId] = useState("");
  const [pickMemberId, setPickMemberId] = useState("");
  const [groupName, setGroupName] = useState("");
  const [groupMembers, setGroupMembers] = useState<Set<string>>(new Set());
  const [creatingChat, setCreatingChat] = useState(false);

  // Group management + delete dialogs
  const [manageOpen, setManageOpen] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [addMembers, setAddMembers] = useState<Set<string>>(new Set());
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteStep, setDeleteStep] = useState<1 | 2>(1);
  const [deleteConfirm, setDeleteConfirm] = useState("");

  // Quick actions (header icons)
  const [cannedOpen, setCannedOpen] = useState(false);
  const [ticketDialogOpen, setTicketDialogOpen] = useState(false);
  const [ticketDraft, setTicketDraft] = useState({
    title: "",
    description: "",
    category: "general" as TicketCategory,
    priority: "medium" as Priority,
  });
  const [ticketFile, setTicketFile] = useState<File | null>(null);
  const [quickBusy, setQuickBusy] = useState(false);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
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

  // ---- Display helpers -------------------------------------------------

  function otherParticipantId(thread: ChatThread): string | null {
    return (
      (thread.participant_ids ?? []).find((id) => id !== currentUser.id) ?? null
    );
  }

  function threadTitle(thread: ChatThread): string {
    switch (thread.chat_type) {
      case "workspace":
        return `${thread.client?.company_name ?? "Client"} Workspace`;
      case "group":
      case "internal_group":
        return thread.group_name ?? thread.title ?? "Group chat";
      case "dm":
      case "internal_dm": {
        const other = otherParticipantId(thread);
        return (other && dir[other]?.full_name) || "Direct message";
      }
      default: {
        // Session: "[Contact] · [Company]" from the matched client user.
        // No match → "Caller" for call sessions (they link a ticket),
        // "SMS" for text sessions.
        const company = thread.client?.company_name ?? "Client";
        const contact =
          thread.poc?.full_name ??
          (thread.point_of_contact_id
            ? dir[thread.point_of_contact_id]?.full_name
            : null) ??
          (thread.linked_ticket_id ? "Caller" : "SMS");
        return `${contact} · ${company}`;
      }
    }
  }

  // ---- Sidebar grouping ------------------------------------------------

  const q = search.trim().toLowerCase();
  function matchesSearch(thread: ChatThread): boolean {
    if (!q) return true;
    const names = (thread.participant_ids ?? [])
      .map((id) => dir[id]?.full_name ?? "")
      .join(" ");
    return (
      threadTitle(thread).toLowerCase().includes(q) ||
      (thread.client?.company_name ?? "").toLowerCase().includes(q) ||
      names.toLowerCase().includes(q)
    );
  }

  // Cheap to recompute each render; keeps the hook-dependency graph
  // simple (matchesSearch closes over threadTitle/dir).
  const visible = threads.filter(matchesSearch);

  // Workspace section grouped by client.
  const workspaceClients = useMemo(() => {
    const byClient = new Map<
      string,
      { company: string; workspace?: ChatThread; dms: ChatThread[]; groups: ChatThread[] }
    >();
    for (const c of clients) {
      byClient.set(c.id, { company: c.company_name, dms: [], groups: [] });
    }
    for (const t of visible) {
      if (!t.client_id) continue;
      if (!["workspace", "dm", "group"].includes(t.chat_type)) continue;
      const entry =
        byClient.get(t.client_id) ??
        byClient
          .set(t.client_id, {
            company: t.client?.company_name ?? "Client",
            dms: [],
            groups: [],
          })
          .get(t.client_id)!;
      if (t.chat_type === "workspace") entry.workspace = t;
      else if (t.chat_type === "dm") entry.dms.push(t);
      else entry.groups.push(t);
    }
    // Only clients that actually have a thread (or match search).
    return [...byClient.entries()]
      .filter(([, e]) => e.workspace || e.dms.length || e.groups.length)
      .sort((a, b) => a[1].company.localeCompare(b[1].company));
  }, [visible, clients]);

  const internalDms = visible.filter((t) => t.chat_type === "internal_dm");
  const internalGroups = visible.filter((t) => t.chat_type === "internal_group");
  const activeSessions = visible.filter(
    (t) => t.chat_type === "session" && t.status === "active"
  );
  const archivedSessions = visible.filter(
    (t) => t.chat_type === "session" && t.status === "closed"
  );

  function toggle(key: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }
  const isCollapsed = (key: string) => collapsed.has(key);

  // ---- Realtime + read tracking ---------------------------------------

  useEffect(() => {
    const supabase = createClient();
    supabase
      .from("chat_messages")
      .select("thread_id, sender_id, read_at")
      .is("read_at", null)
      .then(({ data }) => {
        const counts: Record<string, number> = {};
        for (const m of data ?? []) {
          if (m.sender_id && m.sender_id !== currentUser.id) {
            counts[m.thread_id] = (counts[m.thread_id] ?? 0) + 1;
          }
        }
        setUnreadByThread(counts);
      });
  }, [currentUser.id]);

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
          .neq("sender_id", currentUser.id)
          .is("read_at", null);
        setUnreadByThread((prev) => ({ ...prev, [activeId]: 0 }));
      });
    return () => {
      cancelled = true;
    };
  }, [activeId, currentUser.id]);

  useEffect(() => {
    const supabase = createClient();
    async function ingest(incoming: ChatMessage) {
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
        if (incoming.sender_id && !incoming.sender) {
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
        // Ding on an incoming message in the open thread (not my own).
        if (incoming.sender_id && incoming.sender_id !== currentUser.id) {
          playDing();
        }
      } else if (incoming.sender_id && incoming.sender_id !== currentUser.id) {
        setUnreadByThread((prev) => ({
          ...prev,
          [incoming.thread_id]: (prev[incoming.thread_id] ?? 0) + 1,
        }));
      }
    }

    const channel = supabase
      .channel("team-chat-messages")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "chat_messages" },
        (payload) => ingest(payload.new as ChatMessage)
      )
      .on("broadcast", { event: "new_message" }, ({ payload }) =>
        ingest(payload as ChatMessage)
      )
      .subscribe();
    channelRef.current = channel;
    return () => {
      channelRef.current = null;
      supabase.removeChannel(channel);
    };
  }, [activeId, currentUser.id]);

  // Dedicated, always-on subscription for NEW sessions. Kept on its own
  // channel and mounted once (no activeId dependency) so it never tears
  // down when the user switches threads — that churn is why new sessions
  // were being missed.
  useEffect(() => {
    const supabase = createClient();

    async function ingestThread(row: ChatThread) {
      if (row.chat_type !== "session") return;
      if (threadIdsRef.current.has(row.id)) return;
      threadIdsRef.current.add(row.id);

      const { data: full } = await supabase
        .from("chat_threads")
        .select(SELECT_COLS)
        .eq("id", row.id)
        .single();
      const thread = (full ?? row) as ChatThread;
      setThreads((prev) =>
        prev.some((t) => t.id === thread.id) ? prev : [thread, ...prev]
      );

      const company = thread.client?.company_name ?? "Client";
      const contact =
        thread.poc?.full_name ?? (thread.linked_ticket_id ? "Caller" : "SMS");
      playDing();
      notifyBrowser(
        "New session",
        `${company} - ${contact} started a new session`
      );
    }

    const channel = supabase
      .channel("new-sessions")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "chat_threads" },
        (payload) => ingestThread(payload.new as ChatThread)
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  // Keep the known-thread set in sync for the realtime de-dupe above.
  useEffect(() => {
    threadIdsRef.current = new Set(threads.map((t) => t.id));
  }, [threads]);

  // Ask for desktop-notification permission + unlock audio on first use.
  useEffect(() => {
    requestNotificationPermission();
    installAudioUnlock();
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  // ---- Sending ---------------------------------------------------------

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

  /** Mirror a reply to SMS only for SMS-sourced sessions. */
  async function mirrorToSmsIfNeeded(
    thread: ChatThread,
    content: string | null,
    messageType: MessageType,
    metadata: Record<string, unknown> | null
  ) {
    if (thread.chat_type !== "session") return;
    if (!content) return;
    if (messageType !== "text" && messageType !== "meet_link") return;

    const lastClientMessage = [...messages]
      .reverse()
      .find((m) => m.sender_type === "client");
    const source = (lastClientMessage?.metadata as { source?: string } | null)?.source;
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

  async function handleSend(e?: React.FormEvent) {
    e?.preventDefault();
    if (!active || !draft.trim() || sending) return;
    setError(null);
    setSending(true);
    const text = draft.trim();

    if (text.startsWith("/ticket")) {
      openTicketDialog(text.replace("/ticket", "").trim());
      setDraft("");
      setSending(false);
      return;
    } else if (text.startsWith("/meet")) {
      const url = text.replace("/meet", "").trim() || "https://meet.google.com/new";
      await sendMessage(active, "Join our Google Meet", "meet_link", { url });
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

  // ---- Ticket from chat ------------------------------------------------

  async function createTicketFromChat(input: {
    title: string;
    description: string;
    category: TicketCategory;
    priority: Priority;
    fileUrl: string | null;
  }) {
    if (!active) return false;
    const supabase = createClient();
    const baseDescription =
      input.description.trim() ||
      `Created from chat thread with ${active.client?.company_name ?? "client"}.`;

    const { data: ticket, error: ticketError } = await supabase
      .from("tickets")
      .insert({
        title: input.title,
        description: input.fileUrl
          ? `${baseDescription}\n\nAttachment: ${input.fileUrl}`
          : baseDescription,
        category: input.category,
        priority: input.priority,
        client_id: active.client_id,
        created_by: currentUser.id,
        source: "chat",
        sla_deadline: slaDeadline(input.priority),
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
        newValue: input.title,
      }),
      logAudit(supabase, {
        userId: currentUser.id,
        entityType: "ticket",
        entityId: ticket.id,
        action: "ticket_created",
        details: { title: input.title, source: "chat" },
      }),
    ]);

    if (active.chat_type !== "workspace") {
      await sendMessage(active, input.title, "ticket_card", {
        ticket_id: ticket.id,
        ticket_title: input.title,
        ticket_status: "open",
      });
      if (active.chat_type === "session") {
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

    // Workspace bot card is inserted by the DB trigger in the same
    // transaction — fetch + broadcast so it appears without a reload.
    if (active.client_id) {
      const { data: botMessage } = await supabase
        .from("chat_messages")
        .select("*")
        .eq("sender_type", "bot")
        .contains("metadata", { ticket_id: ticket.id })
        .order("sent_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (botMessage) {
        const bot = botMessage as ChatMessage;
        if (bot.thread_id === activeId) {
          setMessages((prev) =>
            prev.some((m) => m.id === bot.id) ? prev : [...prev, bot]
          );
        }
        channelRef.current?.send({
          type: "broadcast",
          event: "new_message",
          payload: bot,
        });
      }
    }
    return true;
  }

  function openTicketDialog(prefillTitle?: string) {
    const lastClient = [...messages]
      .reverse()
      .find((m) => m.sender_type === "client" && m.content);
    const valid = ["seo", "ghl", "software", "billing", "general"];
    setTicketDraft({
      title: prefillTitle || lastClient?.content?.slice(0, 80) || "",
      description: "",
      category: (valid.includes(active?.category ?? "")
        ? active!.category
        : "general") as TicketCategory,
      priority: "medium",
    });
    setTicketFile(null);
    setTicketDialogOpen(true);
  }

  async function submitQuickTicket(e: React.FormEvent) {
    e.preventDefault();
    if (!ticketDraft.title.trim() || quickBusy) return;
    setQuickBusy(true);
    setError(null);
    let fileUrl: string | null = null;
    if (ticketFile) {
      const supabase = createClient();
      const path = `tickets/${active?.client_id ?? "internal"}/${Date.now()}-${ticketFile.name}`;
      const { error: uploadError } = await supabase.storage
        .from("uploads")
        .upload(path, ticketFile);
      if (uploadError) {
        setError(`File upload failed: ${uploadError.message}`);
        setQuickBusy(false);
        return;
      }
      fileUrl = supabase.storage.from("uploads").getPublicUrl(path).data.publicUrl;
    }
    const ok = await createTicketFromChat({
      ...ticketDraft,
      title: ticketDraft.title.trim(),
      fileUrl,
    });
    if (ok) {
      setTicketDialogOpen(false);
      setTicketFile(null);
    }
    setQuickBusy(false);
  }

  async function quickMeet() {
    if (!active || quickBusy) return;
    setQuickBusy(true);
    await sendMessage(active, "Join our Google Meet", "meet_link", {
      url: "https://meet.google.com/new",
    });
    setQuickBusy(false);
  }

  // ---- Chat creation ---------------------------------------------------

  function resetNewChat() {
    setNewChatMode("menu");
    setPickClientId("");
    setPickMemberId("");
    setGroupName("");
    setGroupMembers(new Set());
  }

  async function insertThread(
    payload: Record<string, unknown>,
    auditAction: string
  ): Promise<ChatThread | null> {
    const supabase = createClient();
    const { data, error: createError } = await supabase
      .from("chat_threads")
      .insert(payload)
      .select(SELECT_COLS)
      .single();
    if (createError || !data) {
      setError(createError?.message ?? "Failed to create the chat.");
      return null;
    }
    await logAudit(supabase, {
      userId: currentUser.id,
      entityType: "chat_thread",
      entityId: data.id,
      action: auditAction,
    });
    setThreads((prev) => [data as ChatThread, ...prev]);
    setActiveId(data.id);
    setNewChatOpen(false);
    resetNewChat();
    return data as ChatThread;
  }

  /** Open or create a 1:1 DM (workspace or internal). */
  async function startDm(otherId: string, clientId: string | null, type: ChatType) {
    const pair = [currentUser.id, otherId].sort();
    const existing = threads.find(
      (t) =>
        t.chat_type === type &&
        (t.participant_ids ?? []).slice().sort().join(",") === pair.join(",")
    );
    if (existing) {
      setActiveId(existing.id);
      setNewChatOpen(false);
      resetNewChat();
      return;
    }
    setCreatingChat(true);
    setError(null);
    await insertThread(
      {
        client_id: clientId,
        status: "active",
        chat_type: type,
        category: type === "internal_dm" ? "internal" : "dm",
        participant_ids: pair,
        is_deletable: true,
        created_by: currentUser.id,
        last_message_at: new Date().toISOString(),
      },
      "dm_thread_created"
    );
    setCreatingChat(false);
  }

  /** Create a named group (workspace or internal). */
  async function startGroup(clientId: string | null, type: ChatType) {
    const name = groupName.trim();
    if (!name) return;
    const participants = Array.from(new Set([...groupMembers, currentUser.id]));
    setCreatingChat(true);
    setError(null);
    await insertThread(
      {
        client_id: clientId,
        status: "active",
        chat_type: type,
        category: type === "internal_group" ? "internal" : "group",
        group_name: name,
        title: name,
        group_owner_id: currentUser.id,
        participant_ids: participants,
        is_deletable: true,
        created_by: currentUser.id,
        last_message_at: new Date().toISOString(),
      },
      "group_thread_created"
    );
    setCreatingChat(false);
  }

  // ---- Group management + delete --------------------------------------

  const canManageActive =
    !!active &&
    (active.chat_type === "group" || active.chat_type === "internal_group") &&
    (active.group_owner_id === currentUser.id || isAdmin);

  function openManage() {
    if (!active) return;
    setRenameValue(active.group_name ?? "");
    setAddMembers(new Set());
    setManageOpen(true);
  }

  async function saveGroup() {
    if (!active) return;
    const supabase = createClient();
    const newParticipants = Array.from(
      new Set([...(active.participant_ids ?? []), ...addMembers])
    );
    const patch = {
      group_name: renameValue.trim() || active.group_name,
      title: renameValue.trim() || active.group_name,
      participant_ids: newParticipants,
    };
    const { error: updateError } = await supabase
      .from("chat_threads")
      .update(patch)
      .eq("id", active.id);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    setThreads((prev) =>
      prev.map((t) => (t.id === active.id ? { ...t, ...patch } : t))
    );
    setManageOpen(false);
  }

  async function removeMember(memberId: string) {
    if (!active) return;
    const supabase = createClient();
    const next = (active.participant_ids ?? []).filter((id) => id !== memberId);
    const { error: updateError } = await supabase
      .from("chat_threads")
      .update({ participant_ids: next })
      .eq("id", active.id);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    setThreads((prev) =>
      prev.map((t) => (t.id === active.id ? { ...t, participant_ids: next } : t))
    );
  }

  async function deleteThread() {
    if (!active || deleteConfirm !== "Delete") return;
    const supabase = createClient();
    const { error: deleteError } = await supabase
      .from("chat_threads")
      .delete()
      .eq("id", active.id);
    if (deleteError) {
      setError(deleteError.message);
      return;
    }
    await logAudit(supabase, {
      userId: currentUser.id,
      entityType: "chat_thread",
      entityId: active.id,
      action: "chat_thread_deleted",
      details: { type: active.chat_type, name: threadTitle(active) },
    });
    setThreads((prev) => prev.filter((t) => t.id !== active.id));
    setActiveId(null);
    setDeleteOpen(false);
    setDeleteStep(1);
    setDeleteConfirm("");
  }

  // ---- Slash / canned --------------------------------------------------

  const showSlashMenu = draft.startsWith("/") && !draft.includes(" ");
  const matchingCommands = SLASH_COMMANDS.filter((c) =>
    c.cmd.startsWith(draft.toLowerCase())
  );
  const showCannedPicker = cannedOpen || draft.toLowerCase().startsWith("/canned");

  // Members of the chosen client for the group/DM pickers.
  const clientRoster = (clientId: string) =>
    clientUsers
      .filter((cu) => cu.client_id === clientId)
      .map((cu) => dir[cu.user_id])
      .filter(Boolean);

  return (
    <div className="flex h-[calc(100vh-57px)] flex-1 overflow-hidden md:h-[calc(100vh-57px)]">
      {/* Sidebar */}
      <aside className="flex w-full max-w-xs shrink-0 flex-col border-r border-border sm:w-[300px]">
        <div className="space-y-2.5 border-b border-border px-4 py-3.5">
          <div className="flex items-center justify-between">
            <h1 className="text-base font-semibold tracking-tight">Chat</h1>
            <Button
              size="sm"
              onClick={() => {
                resetNewChat();
                setNewChatOpen(true);
              }}
            >
              <Plus className="size-4" /> New
            </Button>
          </div>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search chats…"
              className="h-8 pl-8"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto py-2">
          {/* WORKSPACE */}
          <SectionHeader
            label="Workspace"
            collapsed={isCollapsed("sec:workspace")}
            onToggle={() => toggle("sec:workspace")}
            onAdd={() => {
              resetNewChat();
              setNewChatMode("workspace_dm");
              setNewChatOpen(true);
            }}
          />
          {!isCollapsed("sec:workspace") &&
            (workspaceClients.length === 0 ? (
              <EmptyHint text="No client chats yet." />
            ) : (
              workspaceClients.map(([clientId, e]) => {
                const key = `client:${clientId}`;
                return (
                  <div key={clientId}>
                    <button
                      onClick={() => toggle(key)}
                      className="flex w-full items-center gap-1.5 px-3 py-1.5 text-left text-xs font-medium text-muted-foreground hover:text-foreground"
                    >
                      {isCollapsed(key) ? (
                        <ChevronRight className="size-3.5" />
                      ) : (
                        <ChevronDown className="size-3.5" />
                      )}
                      <Building2 className="size-3.5" />
                      <span className="truncate">{e.company}</span>
                    </button>
                    {!isCollapsed(key) && (
                      <div className="pl-2">
                        {e.workspace && (
                          <ThreadRow
                            thread={e.workspace}
                            label={threadTitle(e.workspace)}
                            active={activeId === e.workspace.id}
                            unread={unreadByThread[e.workspace.id] ?? 0}
                            icon={<Users className="size-3.5 text-primary" />}
                            onClick={() => setActiveId(e.workspace!.id)}
                          />
                        )}
                        {e.dms.map((t) => (
                          <DmRow
                            key={t.id}
                            label={threadTitle(t)}
                            user={dir[otherParticipantId(t) ?? ""]}
                            active={activeId === t.id}
                            unread={unreadByThread[t.id] ?? 0}
                            onClick={() => setActiveId(t.id)}
                          />
                        ))}
                        {e.groups.map((t) => (
                          <ThreadRow
                            key={t.id}
                            thread={t}
                            label={threadTitle(t)}
                            active={activeId === t.id}
                            unread={unreadByThread[t.id] ?? 0}
                            icon={<Users className="size-3.5 text-muted-foreground" />}
                            badge={`${(t.participant_ids ?? []).length}`}
                            onClick={() => setActiveId(t.id)}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                );
              })
            ))}

          {/* INTERNAL */}
          <SectionHeader
            label="Internal"
            collapsed={isCollapsed("sec:internal")}
            onToggle={() => toggle("sec:internal")}
            onAdd={() => {
              resetNewChat();
              setNewChatMode("internal_dm");
              setNewChatOpen(true);
            }}
          />
          {!isCollapsed("sec:internal") && (
            <div className="pl-2">
              {internalDms.length === 0 && internalGroups.length === 0 && (
                <EmptyHint text="No internal chats yet." />
              )}
              {internalDms.map((t) => (
                <DmRow
                  key={t.id}
                  label={threadTitle(t)}
                  user={dir[otherParticipantId(t) ?? ""]}
                  active={activeId === t.id}
                  unread={unreadByThread[t.id] ?? 0}
                  onClick={() => setActiveId(t.id)}
                />
              ))}
              {internalGroups.map((t) => (
                <ThreadRow
                  key={t.id}
                  thread={t}
                  label={threadTitle(t)}
                  active={activeId === t.id}
                  unread={unreadByThread[t.id] ?? 0}
                  icon={<Users className="size-3.5 text-muted-foreground" />}
                  badge={`${(t.participant_ids ?? []).length}`}
                  onClick={() => setActiveId(t.id)}
                />
              ))}
            </div>
          )}

          {/* SESSIONS */}
          <SectionHeader
            label="Sessions"
            collapsed={isCollapsed("sec:sessions")}
            onToggle={() => toggle("sec:sessions")}
          />
          {!isCollapsed("sec:sessions") && (
            <div className="pl-2">
              {activeSessions.length === 0 && (
                <EmptyHint text="No active sessions." />
              )}
              {activeSessions.map((t) => (
                <ThreadRow
                  key={t.id}
                  thread={t}
                  label={threadTitle(t)}
                  sublabel={t.category ?? undefined}
                  active={activeId === t.id}
                  unread={unreadByThread[t.id] ?? 0}
                  icon={<MessageSquare className="size-3.5 text-emerald-500" />}
                  onClick={() => setActiveId(t.id)}
                />
              ))}
              {archivedSessions.length > 0 && (
                <>
                  <button
                    onClick={() => toggle("sessions:archived")}
                    className="flex w-full items-center gap-1.5 px-3 py-1.5 text-left text-[11px] font-medium uppercase tracking-wide text-muted-foreground hover:text-foreground"
                  >
                    {isCollapsed("sessions:archived") ? (
                      <ChevronRight className="size-3" />
                    ) : (
                      <ChevronDown className="size-3" />
                    )}
                    Archived ({archivedSessions.length})
                  </button>
                  {!isCollapsed("sessions:archived") &&
                    archivedSessions.map((t) => (
                      <ThreadRow
                        key={t.id}
                        thread={t}
                        label={threadTitle(t)}
                        sublabel="Closed"
                        active={activeId === t.id}
                        unread={0}
                        icon={<MessageSquare className="size-3.5 text-muted-foreground" />}
                        onClick={() => setActiveId(t.id)}
                      />
                    ))}
                </>
              )}
            </div>
          )}
        </div>
      </aside>

      {/* Chat panel */}
      <div className="hidden min-h-0 min-w-0 flex-1 flex-col overflow-hidden sm:flex">
        {!active ? (
          <div className="flex flex-1 items-center justify-center p-8">
            <EmptyState
              icon={MessageSquare}
              title="Select a conversation"
              description="Pick a chat from the left, or start a new one."
            />
          </div>
        ) : (
          <>
            <ChatHeader
              thread={active}
              title={threadTitle(active)}
              dir={dir}
              quickBusy={quickBusy}
              canManage={canManageActive}
              onTicket={() => openTicketDialog()}
              onMeet={quickMeet}
              onCanned={() => setCannedOpen((v) => !v)}
              onResolve={() => resolveThread(active)}
              onManage={openManage}
              onDelete={() => {
                setDeleteStep(1);
                setDeleteConfirm("");
                setDeleteOpen(true);
              }}
              otherParticipantId={otherParticipantId}
            />

            <div className="flex-1 space-y-4 overflow-y-auto p-5">
              {loadingMessages ? (
                <p className="text-center text-sm text-muted-foreground">
                  Loading messages…
                </p>
              ) : messages.length === 0 ? (
                <EmptyState
                  icon={MessageSquare}
                  title="No messages yet"
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
                      <span className="truncate text-xs text-muted-foreground">
                        {hint}
                      </span>
                    </button>
                  ))}
                </div>
              )}

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

              <form onSubmit={handleSend} className="flex items-end gap-2">
                <Slash className="mb-2.5 size-4 shrink-0 text-muted-foreground" />
                <ChatTextarea
                  ref={inputRef}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onSend={handleSend}
                  placeholder={
                    active.status === "active"
                      ? "Message, or / for commands (/ticket, /meet, /canned)…"
                      : "This session is closed."
                  }
                  disabled={active.chat_type === "session" && active.status !== "active"}
                  aria-label="Message"
                />
                <Button
                  type="submit"
                  size="icon"
                  disabled={
                    sending ||
                    !draft.trim() ||
                    (active.chat_type === "session" && active.status !== "active")
                  }
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

      {/* New Chat dialog */}
      <Dialog
        open={newChatOpen}
        onOpenChange={(o) => {
          setNewChatOpen(o);
          if (!o) resetNewChat();
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New chat</DialogTitle>
            <DialogDescription>
              {newChatMode === "menu"
                ? "What kind of conversation do you want to start?"
                : "Pick who's in the conversation."}
            </DialogDescription>
          </DialogHeader>

          {newChatMode === "menu" && (
            <div className="grid gap-2">
              {(
                [
                  ["workspace_dm", "Workspace DM", "1:1 with a client team member"],
                  ["workspace_group", "Workspace Group", "Client users + your team"],
                  ["internal_dm", "Internal DM", "1:1 with a teammate"],
                  ["internal_group", "Internal Group", "Team-only group"],
                ] as const
              ).map(([mode, title, hint]) => (
                <button
                  key={mode}
                  onClick={() => setNewChatMode(mode)}
                  className="flex items-center justify-between rounded-lg border border-border p-3 text-left transition-colors hover:border-border-hover hover:bg-accent/50"
                >
                  <span>
                    <span className="block text-sm font-medium">{title}</span>
                    <span className="block text-xs text-muted-foreground">{hint}</span>
                  </span>
                  <ChevronRight className="size-4 text-muted-foreground" />
                </button>
              ))}
            </div>
          )}

          {/* Workspace DM */}
          {newChatMode === "workspace_dm" && (
            <div className="space-y-3">
              <ClientPicker value={pickClientId} onChange={setPickClientId} clients={clients} />
              {pickClientId && (
                <MemberPicker
                  label="Client team member"
                  users={clientRoster(pickClientId)}
                  value={pickMemberId}
                  onChange={setPickMemberId}
                />
              )}
              <Button
                className="w-full"
                disabled={!pickMemberId || creatingChat}
                onClick={() => startDm(pickMemberId, pickClientId, "dm")}
              >
                {creatingChat ? "Opening…" : "Start DM"}
              </Button>
            </div>
          )}

          {/* Workspace Group */}
          {newChatMode === "workspace_group" && (
            <div className="space-y-3">
              <ClientPicker value={pickClientId} onChange={setPickClientId} clients={clients} />
              <Input
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                placeholder="Group name"
              />
              {pickClientId && (
                <MemberCheckList
                  title="Members"
                  users={[
                    ...clientRoster(pickClientId),
                    ...teamMembers
                      .filter((m) => m.id !== currentUser.id)
                      .map((m) => dir[m.id])
                      .filter(Boolean),
                  ]}
                  selected={groupMembers}
                  onToggle={(id, on) =>
                    setGroupMembers((prev) => {
                      const next = new Set(prev);
                      if (on) next.add(id);
                      else next.delete(id);
                      return next;
                    })
                  }
                />
              )}
              <Button
                className="w-full"
                disabled={!pickClientId || !groupName.trim() || groupMembers.size === 0 || creatingChat}
                onClick={() => startGroup(pickClientId, "group")}
              >
                {creatingChat ? "Creating…" : "Create group"}
              </Button>
            </div>
          )}

          {/* Internal DM */}
          {newChatMode === "internal_dm" && (
            <div className="space-y-3">
              <MemberPicker
                label="Teammate"
                users={teamMembers
                  .filter((m) => m.id !== currentUser.id)
                  .map((m) => dir[m.id])
                  .filter(Boolean)}
                value={pickMemberId}
                onChange={setPickMemberId}
              />
              <Button
                className="w-full"
                disabled={!pickMemberId || creatingChat}
                onClick={() => startDm(pickMemberId, null, "internal_dm")}
              >
                {creatingChat ? "Opening…" : "Start DM"}
              </Button>
            </div>
          )}

          {/* Internal Group */}
          {newChatMode === "internal_group" && (
            <div className="space-y-3">
              <Input
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                placeholder="Group name"
              />
              <MemberCheckList
                title="Team members"
                users={teamMembers
                  .filter((m) => m.id !== currentUser.id)
                  .map((m) => dir[m.id])
                  .filter(Boolean)}
                selected={groupMembers}
                onToggle={(id, on) =>
                  setGroupMembers((prev) => {
                    const next = new Set(prev);
                    if (on) next.add(id);
                    else next.delete(id);
                    return next;
                  })
                }
              />
              <Button
                className="w-full"
                disabled={!groupName.trim() || groupMembers.size === 0 || creatingChat}
                onClick={() => startGroup(null, "internal_group")}
              >
                {creatingChat ? "Creating…" : "Create group"}
              </Button>
            </div>
          )}

          {newChatMode !== "menu" && (
            <Button variant="ghost" size="sm" onClick={resetNewChat}>
              ← Back
            </Button>
          )}
        </DialogContent>
      </Dialog>

      {/* Manage group dialog */}
      <Dialog open={manageOpen} onOpenChange={setManageOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Manage group</DialogTitle>
            <DialogDescription>Rename or change who&apos;s in this group.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="rename">Group name</Label>
              <Input
                id="rename"
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Members</Label>
              <ul className="max-h-40 space-y-1 overflow-y-auto rounded-md border border-border p-1.5">
                {(active?.participant_ids ?? []).map((id) => {
                  const u = dir[id];
                  return (
                    <li key={id} className="flex items-center gap-2 px-1.5 py-1">
                      <UserAvatar
                        name={u?.full_name ?? "User"}
                        avatarUrl={u?.avatar_url}
                        className="size-6"
                      />
                      <span className="flex-1 truncate text-sm">
                        {u?.full_name ?? "User"}
                        {id === active?.group_owner_id && (
                          <span className="ml-1 text-xs text-muted-foreground">(owner)</span>
                        )}
                      </span>
                      {id !== currentUser.id && id !== active?.group_owner_id && (
                        <button
                          onClick={() => removeMember(id)}
                          className="rounded p-1 text-muted-foreground hover:text-destructive"
                          aria-label="Remove member"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
            {active && (
              <MemberCheckList
                title="Add members"
                users={(active.chat_type === "internal_group"
                  ? teamMembers.map((m) => dir[m.id])
                  : [
                      ...(active.client_id ? clientRoster(active.client_id) : []),
                      ...teamMembers.map((m) => dir[m.id]),
                    ]
                )
                  .filter(Boolean)
                  .filter((u) => !(active.participant_ids ?? []).includes(u!.id))}
                selected={addMembers}
                onToggle={(id, on) =>
                  setAddMembers((prev) => {
                    const next = new Set(prev);
                    if (on) next.add(id);
                    else next.delete(id);
                    return next;
                  })
                }
              />
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setManageOpen(false)}>
              Cancel
            </Button>
            <Button onClick={saveGroup}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete dialog — double confirm */}
      <Dialog
        open={deleteOpen}
        onOpenChange={(o) => {
          setDeleteOpen(o);
          if (!o) {
            setDeleteStep(1);
            setDeleteConfirm("");
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete this chat?</DialogTitle>
            <DialogDescription>
              {deleteStep === 1
                ? "This will permanently delete all messages in this conversation. This cannot be undone."
                : `Type "Delete" to permanently remove "${active ? threadTitle(active) : ""}".`}
            </DialogDescription>
          </DialogHeader>
          {deleteStep === 2 && (
            <Input
              value={deleteConfirm}
              onChange={(e) => setDeleteConfirm(e.target.value)}
              placeholder="Delete"
              autoFocus
            />
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteOpen(false)}>
              Cancel
            </Button>
            {deleteStep === 1 ? (
              <Button variant="destructive" onClick={() => setDeleteStep(2)}>
                Continue
              </Button>
            ) : (
              <Button
                variant="destructive"
                disabled={deleteConfirm !== "Delete"}
                onClick={deleteThread}
              >
                Delete permanently
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Quick-action: create ticket from chat */}
      <Dialog open={ticketDialogOpen} onOpenChange={setTicketDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create ticket</DialogTitle>
            <DialogDescription>
              Files a ticket{active?.client?.company_name ? ` for ${active.client.company_name}` : ""} and posts the card to chat.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submitQuickTicket} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="qt-title">Title</Label>
              <Input
                id="qt-title"
                required
                value={ticketDraft.title}
                onChange={(e) => setTicketDraft({ ...ticketDraft, title: e.target.value })}
                placeholder="Summary of the issue"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="qt-desc">Description</Label>
              <Textarea
                id="qt-desc"
                rows={3}
                value={ticketDraft.description}
                onChange={(e) =>
                  setTicketDraft({ ...ticketDraft, description: e.target.value })
                }
                placeholder="What's going on? Defaults to a note about this chat."
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label>Category</Label>
                <Select
                  value={ticketDraft.category}
                  onValueChange={(v) =>
                    setTicketDraft({ ...ticketDraft, category: v as TicketCategory })
                  }
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
                  value={ticketDraft.priority}
                  onValueChange={(v) =>
                    setTicketDraft({ ...ticketDraft, priority: v as Priority })
                  }
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
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="qt-file">Attachment (optional)</Label>
              <Input
                id="qt-file"
                type="file"
                onChange={(e) => setTicketFile(e.target.files?.[0] ?? null)}
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button
              type="submit"
              className="w-full"
              disabled={quickBusy || !ticketDraft.title.trim()}
            >
              {quickBusy ? "Creating…" : "Create ticket"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---- Small presentational pieces ---------------------------------------

function SectionHeader({
  label,
  collapsed,
  onToggle,
  onAdd,
}: {
  label: string;
  collapsed: boolean;
  onToggle: () => void;
  onAdd?: () => void;
}) {
  return (
    <div className="flex items-center justify-between px-2 pt-3">
      <button
        onClick={onToggle}
        className="section-label flex items-center gap-1 px-1 py-1 hover:text-foreground"
      >
        {collapsed ? <ChevronRight className="size-3" /> : <ChevronDown className="size-3" />}
        {label}
      </button>
      {onAdd && (
        <button
          onClick={onAdd}
          className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label={`New ${label} chat`}
        >
          <Plus className="size-3.5" />
        </button>
      )}
    </div>
  );
}

function EmptyHint({ text }: { text: string }) {
  return <p className="px-4 py-2 text-xs text-muted-foreground">{text}</p>;
}

function UnreadBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="ml-auto flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground">
      {count}
    </span>
  );
}

function ThreadRow({
  label,
  sublabel,
  active,
  unread,
  icon,
  badge,
  onClick,
}: {
  thread: ChatThread;
  label: string;
  sublabel?: string;
  active: boolean;
  unread: number;
  icon: React.ReactNode;
  badge?: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-left text-sm transition-colors",
        active ? "bg-primary/10 text-foreground" : "hover:bg-accent/60"
      )}
    >
      {icon}
      <span className="min-w-0 flex-1 truncate">
        {label}
        {sublabel && (
          <span className="ml-1 text-[11px] text-muted-foreground">· {sublabel}</span>
        )}
      </span>
      {badge && (
        <Badge variant="outline" className="h-4 px-1.5 text-[10px]">
          {badge}
        </Badge>
      )}
      <UnreadBadge count={unread} />
    </button>
  );
}

function DmRow({
  label,
  user,
  active,
  unread,
  onClick,
}: {
  label: string;
  user?: DirectoryUser;
  active: boolean;
  unread: number;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-left text-sm transition-colors",
        active ? "bg-primary/10 text-foreground" : "hover:bg-accent/60"
      )}
    >
      <span className="relative">
        <UserAvatar
          name={user?.full_name ?? label}
          avatarUrl={user?.avatar_url}
          className="size-6"
        />
        <PresenceDot online={isOnline(user?.last_seen)} />
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <UnreadBadge count={unread} />
    </button>
  );
}

function ChatHeader({
  thread,
  title,
  dir,
  quickBusy,
  canManage,
  onTicket,
  onMeet,
  onCanned,
  onResolve,
  onManage,
  onDelete,
  otherParticipantId,
}: {
  thread: ChatThread;
  title: string;
  dir: Record<string, DirectoryUser>;
  quickBusy: boolean;
  canManage: boolean;
  onTicket: () => void;
  onMeet: () => void;
  onCanned: () => void;
  onResolve: () => void;
  onManage: () => void;
  onDelete: () => void;
  otherParticipantId: (t: ChatThread) => string | null;
}) {
  const isGroup =
    thread.chat_type === "group" || thread.chat_type === "internal_group";
  const isDm = thread.chat_type === "dm" || thread.chat_type === "internal_dm";
  const isSession = thread.chat_type === "session";
  const other = isDm ? dir[otherParticipantId(thread) ?? ""] : undefined;
  const members = (thread.participant_ids ?? []).map((id) => dir[id]).filter(Boolean);

  return (
    <header className="flex items-center justify-between gap-3 border-b border-border px-5 py-3">
      <div className="flex min-w-0 items-center gap-3">
        {isDm ? (
          <span className="relative">
            <UserAvatar
              name={other?.full_name ?? title}
              avatarUrl={other?.avatar_url}
              className="size-9"
            />
            <PresenceDot online={isOnline(other?.last_seen)} />
          </span>
        ) : (
          <UserAvatar
            name={title}
            avatarUrl={thread.client?.logo_url}
            className="size-9"
          />
        )}
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{title}</p>
          <p className="text-xs text-muted-foreground">
            {isGroup
              ? `${members.length} member${members.length === 1 ? "" : "s"}`
              : isDm
                ? isOnline(other?.last_seen)
                  ? "Online"
                  : "Offline"
                : thread.chat_type === "workspace"
                  ? "Workspace · always on"
                  : `${thread.category ?? "general"} session · ${thread.status === "active" ? "Active" : "Closed"}`}
          </p>
        </div>
        {isGroup && (
          <div className="ml-1 hidden -space-x-2 sm:flex">
            {members.slice(0, 4).map((m) => (
              <UserAvatar
                key={m!.id}
                name={m!.full_name}
                avatarUrl={m!.avatar_url}
                className="size-6 ring-2 ring-background"
              />
            ))}
          </div>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1">
        {(thread.client_id || isSession) && thread.status === "active" && (
          <>
            <Button variant="ghost" size="icon" title="Create ticket" onClick={onTicket} disabled={quickBusy}>
              <TicketIcon className="size-4 text-muted-foreground" />
            </Button>
            <Button variant="ghost" size="icon" title="Send a Google Meet link" onClick={onMeet} disabled={quickBusy}>
              <Video className="size-4 text-muted-foreground" />
            </Button>
            <Button variant="ghost" size="icon" title="Insert a canned response" onClick={onCanned}>
              <MessageSquare className="size-4 text-muted-foreground" />
            </Button>
          </>
        )}
        {canManage && (
          <Button variant="ghost" size="icon" title="Manage group" onClick={onManage}>
            <Settings2 className="size-4 text-muted-foreground" />
          </Button>
        )}
        {isSession && thread.status === "active" && (
          <Button variant="outline" size="sm" className="ml-1" onClick={onResolve}>
            <CheckCircle2 className="size-4 text-emerald-600 dark:text-emerald-400" /> Resolve
          </Button>
        )}
        {thread.is_deletable && (
          <Button variant="ghost" size="icon" title="Delete chat" onClick={onDelete}>
            <Trash2 className="size-4 text-muted-foreground" />
          </Button>
        )}
      </div>
    </header>
  );
}

function ClientPicker({
  value,
  onChange,
  clients,
}: {
  value: string;
  onChange: (v: string) => void;
  clients: ClientOption[];
}) {
  return (
    <Select value={value} onValueChange={onChange}>
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
  );
}

function MemberPicker({
  label,
  users,
  value,
  onChange,
}: {
  label: string;
  users: (DirectoryUser | undefined)[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger>
        <SelectValue placeholder={label} />
      </SelectTrigger>
      <SelectContent>
        {users.filter(Boolean).map((u) => (
          <SelectItem key={u!.id} value={u!.id}>
            {u!.full_name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function MemberCheckList({
  title,
  users,
  selected,
  onToggle,
}: {
  title: string;
  users: (DirectoryUser | undefined)[];
  selected: Set<string>;
  onToggle: (id: string, on: boolean) => void;
}) {
  const list = users.filter(Boolean) as DirectoryUser[];
  return (
    <div className="space-y-1.5">
      <Label>{title}</Label>
      <div className="max-h-48 space-y-1 overflow-y-auto rounded-md border border-border p-2">
        {list.length === 0 ? (
          <p className="flex items-center gap-2 px-2 py-1.5 text-sm text-muted-foreground">
            <UserPlus className="size-4" /> No one to add.
          </p>
        ) : (
          list.map((u) => (
            <label
              key={u.id}
              className="flex cursor-pointer items-center gap-2.5 rounded px-2 py-1.5 hover:bg-accent/50"
            >
              <Checkbox
                checked={selected.has(u.id)}
                onCheckedChange={(v) => onToggle(u.id, v === true)}
              />
              <UserAvatar name={u.full_name} avatarUrl={u.avatar_url} className="size-6" />
              <span className="text-sm">{u.full_name}</span>
            </label>
          ))
        )}
      </div>
    </div>
  );
}
