"use client";

import { useEffect, useRef, useState } from "react";
import { MessageSquare, SendHorizonal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EmptyState } from "@/components/empty-state";
import { MessageBubble } from "@/components/chat/message-bubble";
import { createClient } from "@/lib/supabase/client";
import { logAudit } from "@/lib/audit";
import type { ChatMessage, ChatThread } from "@/lib/types";

const CATEGORIES = ["SEO", "GHL", "Software", "Billing", "General"];

export function PortalChat({
  userId,
  clientId,
  initialThread,
  initialMessages,
}: {
  userId: string;
  clientId: string;
  initialThread: ChatThread | null;
  initialMessages: ChatMessage[];
}) {
  const [thread, setThread] = useState(initialThread);
  const [messages, setMessages] = useState(initialMessages);
  const [draft, setDraft] = useState("");
  const [category, setCategory] = useState("General");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Realtime: append messages from the team as they arrive.
  useEffect(() => {
    if (!thread) return;
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
  }, [thread]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!draft.trim() || sending) return;
    setError(null);
    setSending(true);

    const supabase = createClient();
    let activeThread = thread;

    // First message opens the thread with the chosen category.
    if (!activeThread) {
      const { data: newThread, error: threadError } = await supabase
        .from("chat_threads")
        .insert({
          client_id: clientId,
          status: "active",
          category,
          last_message_at: new Date().toISOString(),
        })
        .select()
        .single();

      if (threadError || !newThread) {
        setError(threadError?.message ?? "Could not start the conversation.");
        setSending(false);
        return;
      }
      activeThread = newThread as ChatThread;
      setThread(activeThread);
      await logAudit(supabase, {
        userId,
        entityType: "chat_thread",
        entityId: activeThread.id,
        action: "thread_opened",
        details: { category },
      });
    }

    const { data: message, error: messageError } = await supabase
      .from("chat_messages")
      .insert({
        thread_id: activeThread.id,
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
      .eq("id", activeThread.id);

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
      <header className="flex items-center justify-between border-b border-border px-6 py-4">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Chat Support</h1>
          <p className="text-xs text-muted-foreground">
            {thread
              ? `${thread.category ?? "General"} · Active conversation`
              : "Start a conversation with your Bluejaypro team"}
          </p>
        </div>
        {!thread && (
          <div className="w-40">
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger>
                <SelectValue placeholder="Category" />
              </SelectTrigger>
              <SelectContent>
                {CATEGORIES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </header>

      <div className="flex-1 space-y-4 overflow-y-auto p-6">
        {messages.length === 0 ? (
          <EmptyState
            icon={MessageSquare}
            title="No messages yet"
            description={
              thread
                ? "Say hello — your team will reply right here."
                : "Pick a category and send your first message to open a thread."
            }
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
          placeholder={
            thread ? "Type a message…" : `Start a ${category} conversation…`
          }
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
