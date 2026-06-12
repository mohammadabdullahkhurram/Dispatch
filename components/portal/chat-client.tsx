"use client";

import { useEffect, useRef, useState } from "react";
import { MessageSquare, SendHorizonal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/empty-state";
import { MessageBubble } from "@/components/chat/message-bubble";
import { createClient } from "@/lib/supabase/client";
import type { ChatMessage, ChatThread } from "@/lib/types";

/**
 * The client's persistent workspace chat with the Bluejaypro team.
 * Web-only; Dispatch Bot posts their ticket updates here.
 */
export function PortalChat({
  userId,
  thread,
  initialMessages,
}: {
  userId: string;
  thread: ChatThread;
  initialMessages: ChatMessage[];
}) {
  const [messages, setMessages] = useState(initialMessages);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Realtime: team replies and Dispatch Bot ticket updates.
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`portal-chat-${thread.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "chat_messages",
          filter: `thread_id=eq.${thread.id}`,
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
          setMessages((prev) =>
            prev.some((m) => m.id === incoming.id) ? prev : [...prev, incoming]
          );
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [thread.id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!draft.trim() || sending) return;
    setError(null);
    setSending(true);

    const supabase = createClient();
    const { data: message, error: messageError } = await supabase
      .from("chat_messages")
      .insert({
        thread_id: thread.id,
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
      .eq("id", thread.id);

    setMessages((prev) =>
      prev.some((m) => m.id === message.id)
        ? prev
        : [...prev, message as ChatMessage]
    );
    setDraft("");
    setSending(false);
  }

  return (
    <div className="flex h-[calc(100vh-57px)] flex-1 flex-col md:h-screen">
      <header className="border-b border-border px-6 py-4">
        <h1 className="text-lg font-semibold tracking-tight">Chat Support</h1>
        <p className="text-xs text-muted-foreground">
          Your ongoing conversation with the Bluejaypro team — ticket updates
          appear here automatically.
        </p>
      </header>

      <div className="flex-1 space-y-4 overflow-y-auto p-6">
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
        className="flex items-center gap-2 border-t border-border p-4"
      >
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
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
  );
}
