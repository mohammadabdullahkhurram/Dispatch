"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { MessageSquare, SendHorizonal, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ChatTextarea } from "@/components/chat/chat-textarea";
import { EmptyState } from "@/components/empty-state";
import { MessageBubble } from "@/components/chat/message-bubble";
import { UserAvatar } from "@/components/user-avatar";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import type { ChatMessage, ChatThread } from "@/lib/types";

type DmContact = { id: string; full_name: string; avatar_url: string | null };

/**
 * The client's chat hub: the persistent workspace thread with the
 * Bluejaypro team, plus any direct messages they're part of.
 */
export function PortalChat({
  userId,
  thread,
  initialMessages,
  dmThreads = [],
  dmContacts = [],
}: {
  userId: string;
  thread: ChatThread;
  initialMessages: ChatMessage[];
  dmThreads?: ChatThread[];
  dmContacts?: DmContact[];
}) {
  const [activeId, setActiveId] = useState(thread.id);
  const [messagesByThread, setMessagesByThread] = useState<
    Record<string, ChatMessage[]>
  >({ [thread.id]: initialMessages });
  const [loadedIds, setLoadedIds] = useState<Set<string>>(
    new Set([thread.id])
  );
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const contactById = useMemo(
    () => Object.fromEntries(dmContacts.map((c) => [c.id, c])),
    [dmContacts]
  );

  const isWorkspace = activeId === thread.id;
  const activeDm = dmThreads.find((t) => t.id === activeId) ?? null;
  const activeDmContact = activeDm
    ? (activeDm.participant_ids ?? [])
        .filter((id) => id !== userId)
        .map((id) => contactById[id])
        .find(Boolean)
    : null;
  const messages = messagesByThread[activeId] ?? [];

  // Lazy-load DM history the first time a thread is opened.
  useEffect(() => {
    if (loadedIds.has(activeId)) return;
    const supabase = createClient();
    let cancelled = false;
    supabase
      .from("chat_messages")
      .select("*, sender:users(id, full_name, avatar_url)")
      .eq("thread_id", activeId)
      .order("sent_at", { ascending: true })
      .then(({ data }) => {
        if (cancelled) return;
        setMessagesByThread((prev) => ({
          ...prev,
          [activeId]: (data ?? []) as ChatMessage[],
        }));
        setLoadedIds((prev) => new Set(prev).add(activeId));
      });
    return () => {
      cancelled = true;
    };
  }, [activeId, loadedIds]);

  // Realtime inserts for the active thread (team replies, bot updates).
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`portal-chat-${activeId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "chat_messages",
          filter: `thread_id=eq.${activeId}`,
        },
        async (payload) => {
          const incoming = payload.new as ChatMessage;
          if (incoming.sender_id) {
            const { data: sender } = await supabase
              .from("users")
              .select("id, full_name, avatar_url")
              .eq("id", incoming.sender_id)
              .single();
            incoming.sender = sender ?? null;
          }
          setMessagesByThread((prev) => {
            const list = prev[incoming.thread_id] ?? [];
            if (list.some((m) => m.id === incoming.id)) return prev;
            return { ...prev, [incoming.thread_id]: [...list, incoming] };
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [activeId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, activeId]);

  async function send(e?: React.FormEvent) {
    e?.preventDefault();
    if (!draft.trim() || sending) return;
    setError(null);
    setSending(true);

    const supabase = createClient();
    const { data: message, error: messageError } = await supabase
      .from("chat_messages")
      .insert({
        thread_id: activeId,
        sender_id: userId,
        sender_type: "client",
        content: draft.trim(),
        message_type: "text",
      })
      .select("*, sender:users(id, full_name, avatar_url)")
      .single();

    if (messageError || !message) {
      setError(messageError?.message ?? "Message failed to send.");
      setSending(false);
      return;
    }

    await supabase
      .from("chat_threads")
      .update({ last_message_at: new Date().toISOString() })
      .eq("id", activeId);

    setMessagesByThread((prev) => {
      const list = prev[activeId] ?? [];
      if (list.some((m) => m.id === message.id)) return prev;
      return { ...prev, [activeId]: [...list, message as ChatMessage] };
    });
    setDraft("");
    setSending(false);
  }

  return (
    <div className="flex h-[calc(100vh-57px)] flex-1 overflow-hidden md:h-[calc(100vh-57px)]">
      {/* Thread list */}
      <aside className="hidden w-[280px] shrink-0 flex-col border-r border-border sm:flex">
        <div className="border-b border-border px-4 py-3.5">
          <h1 className="text-base font-semibold tracking-tight">Chat</h1>
          <p className="text-xs text-muted-foreground">
            Your conversations with the team.
          </p>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          <p className="section-label px-2 pb-1 pt-1">Support</p>
          <button
            onClick={() => setActiveId(thread.id)}
            className={cn(
              "flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left transition-colors",
              isWorkspace
                ? "bg-primary/10"
                : "hover:bg-foreground/[0.04] dark:hover:bg-white/[0.03]"
            )}
          >
            <span className="flex size-8 items-center justify-center rounded-full bg-primary/15">
              <Users className="size-4 text-primary" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">
                Bluejaypro Team
              </span>
              <span className="block truncate text-xs text-muted-foreground">
                Workspace chat — always on
              </span>
            </span>
          </button>

          {dmThreads.length > 0 && (
            <>
              <p className="section-label px-2 pb-1 pt-4">Direct Messages</p>
              {dmThreads.map((t) => {
                const other = (t.participant_ids ?? [])
                  .filter((id) => id !== userId)
                  .map((id) => contactById[id])
                  .find(Boolean);
                return (
                  <button
                    key={t.id}
                    onClick={() => setActiveId(t.id)}
                    className={cn(
                      "flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left transition-colors",
                      activeId === t.id
                        ? "bg-primary/10"
                        : "hover:bg-foreground/[0.04] dark:hover:bg-white/[0.03]"
                    )}
                  >
                    <UserAvatar
                      name={other?.full_name ?? "Team member"}
                      avatarUrl={other?.avatar_url}
                      className="size-8"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        {other?.full_name ?? "Team member"}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        Direct message
                      </span>
                    </span>
                  </button>
                );
              })}
            </>
          )}
        </div>
      </aside>

      {/* Chat area */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <header className="border-b border-border px-6 py-4">
          <h2 className="text-lg font-semibold tracking-tight">
            {isWorkspace
              ? "Chat Support"
              : (activeDmContact?.full_name ?? "Direct message")}
          </h2>
          <p className="text-xs text-muted-foreground">
            {isWorkspace
              ? "Your ongoing conversation with the Bluejaypro team — ticket updates appear here automatically."
              : "Private conversation with your Bluejaypro contact."}
          </p>
        </header>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-6">
          {messages.length === 0 ? (
            <EmptyState
              icon={MessageSquare}
              title="No messages yet"
              description="Say hello — your team will reply right here."
            />
          ) : (
            messages.map((m) => (
              <MessageBubble
                key={m.id}
                message={m}
                viewer="client"
                ticketHrefBase="/portal/tickets"
              />
            ))
          )}
          <div ref={bottomRef} />
        </div>

        <form
          onSubmit={send}
          className="flex items-end gap-2 border-t border-border p-4"
        >
          <ChatTextarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onSend={send}
            placeholder="Type a message…"
            aria-label="Message"
          />
          <Button type="submit" size="icon" disabled={sending || !draft.trim()}>
            <SendHorizonal className="size-4" />
          </Button>
        </form>
        {error && (
          <p className="px-4 pb-3 text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
