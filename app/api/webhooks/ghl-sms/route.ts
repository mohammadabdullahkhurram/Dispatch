import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { findClientByPhone } from "@/lib/phone";
import {
  DISPATCH_TAG,
  getContactTags,
  searchContactByPhone,
} from "@/lib/ghl";

/**
 * GoHighLevel inbound SMS webhook.
 * Payload: { phone, message, contactId }
 *
 * Flow: verify the contact carries the "dispatch-user" tag in GHL →
 * match the sender to a client by phone → find or create their active
 * chat thread → append the message (sender_type: client,
 * metadata.source: "sms") so it shows up live in the team chat.
 */
export async function POST(request: NextRequest) {
  const payload = (await request.json().catch(() => null)) as {
    phone?: string;
    message?: string;
    contactId?: string;
  } | null;

  if (!payload?.phone || !payload.message) {
    return NextResponse.json(
      { error: "Expected { phone, message, contactId }" },
      { status: 400 }
    );
  }

  // Gate: only contacts explicitly tagged "dispatch-user" in GHL ever
  // reach Dispatch chat. Tag-check failures fail closed.
  let tags: string[] = [];
  try {
    if (payload.contactId) {
      tags = await getContactTags(payload.contactId);
    } else {
      tags = (await searchContactByPhone(payload.phone))?.tags ?? [];
    }
  } catch (error) {
    console.error("[ghl-sms] Tag check failed:", error);
    return NextResponse.json({
      received: true,
      matched: false,
      reason: "tag check failed",
    });
  }

  if (!tags.includes(DISPATCH_TAG)) {
    return NextResponse.json({
      received: true,
      matched: false,
      reason: "not a dispatch user",
    });
  }

  const supabase = createAdminClient();

  const client = await findClientByPhone(supabase, payload.phone);
  if (!client) {
    // Acknowledge so GHL doesn't retry-storm; log for triage.
    console.warn(`[ghl-sms] No client matches phone ${payload.phone}`);
    return NextResponse.json({ received: true, matched: false });
  }

  // Find the client's active thread, or open one for this SMS conversation.
  let { data: thread } = await supabase
    .from("chat_threads")
    .select("id")
    .eq("client_id", client.id)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!thread) {
    const { data: newThread, error: threadError } = await supabase
      .from("chat_threads")
      .insert({
        client_id: client.id,
        status: "active",
        category: "General",
        last_message_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (threadError || !newThread) {
      console.error("[ghl-sms] Thread create failed:", threadError?.message);
      return NextResponse.json(
        { error: "Failed to open chat thread" },
        { status: 500 }
      );
    }
    thread = newThread;
  }

  const { error: messageError } = await supabase.from("chat_messages").insert({
    thread_id: thread.id,
    sender_id: null, // SMS sender has no Dispatch user session
    sender_type: "client",
    content: payload.message,
    message_type: "text",
    metadata: {
      source: "sms",
      contact_id: payload.contactId ?? null,
      phone: payload.phone,
    },
  });

  if (messageError) {
    console.error("[ghl-sms] Message insert failed:", messageError.message);
    return NextResponse.json(
      { error: "Failed to store message" },
      { status: 500 }
    );
  }

  await Promise.all([
    supabase
      .from("chat_threads")
      .update({ last_message_at: new Date().toISOString() })
      .eq("id", thread.id),
    supabase.from("audit_logs").insert({
      user_id: null,
      entity_type: "chat_message",
      entity_id: thread.id,
      action: "sms_received",
      details: { client_id: client.id, phone: payload.phone },
    }),
  ]);

  return NextResponse.json({ received: true, matched: true });
}
