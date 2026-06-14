import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { findClientByPhone, findContactUser } from "@/lib/phone";
import {
  DISPATCH_TAG,
  getContactTags,
  searchContactByPhone,
} from "@/lib/ghl";

/**
 * Pull the plain-text SMS body out of whatever shape GHL sends. The
 * message can arrive as a plain string, a nested object, or a
 * stringified JSON like `{"type":2,"body":"hello"}` depending on how
 * the GHL workflow's custom-webhook action is mapped — so dig for the
 * text instead of trusting one field.
 */
function coerceText(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    return coerceText(o.body ?? o.message ?? o.messageBody ?? o.text);
  }
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!s) return null;
  // A JSON-looking string: parse and dig, never store the raw JSON.
  if (
    (s.startsWith("{") && s.endsWith("}")) ||
    (s.startsWith("[") && s.endsWith("]"))
  ) {
    try {
      return coerceText(JSON.parse(s));
    } catch {
      return s; // looked like JSON but wasn't — treat as literal text
    }
  }
  return s;
}

function extractSmsText(payload: Record<string, unknown>): string | null {
  for (const key of ["message", "body", "messageBody", "text", "sms"]) {
    const t = coerceText(payload[key]);
    if (t) return t;
  }
  return null;
}

function extractPhone(payload: Record<string, unknown>): string | null {
  for (const key of ["phone", "phoneNumber", "from", "number"]) {
    const v = payload[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

/**
 * GoHighLevel inbound SMS webhook.
 * Payload (field names vary by workflow): a phone (`phone`/`from`/…)
 * and a message body (`message`/`body`/`messageBody`/… possibly nested
 * or JSON-stringified) plus an optional `contactId`.
 *
 * Flow: verify the contact carries the "dispatch-user" tag in GHL →
 * match the sender to a client by phone → find or create their active
 * chat thread → append the message (sender_type: client,
 * metadata.source: "sms") so it shows up live in the team chat.
 */
export async function POST(request: NextRequest) {
  const raw = (await request.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;

  // Log exactly what GHL sent so the field mapping is verifiable.
  console.log("[ghl-sms] payload:", JSON.stringify(raw));

  const phone = raw ? extractPhone(raw) : null;
  const message = raw ? extractSmsText(raw) : null;
  const contactId =
    typeof raw?.contactId === "string" ? raw.contactId : undefined;

  if (!phone || !message) {
    console.warn(
      `[ghl-sms] could not extract phone/message (phone=${!!phone}, message=${!!message})`
    );
    return NextResponse.json(
      { error: "Expected a phone and a message body" },
      { status: 400 }
    );
  }
  const payload = { phone, message, contactId };

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

  // Attribute the SMS to the specific person on the client's roster
  // whose phone matches — they become the message sender and the
  // session's point of contact.
  const senderId =
    (await findContactUser(supabase, client.id, payload.phone))?.id ?? null;

  // SMS goes to a support SESSION, never the workspace thread.
  // Reuse the client's active session or open a new one.
  let { data: thread } = await supabase
    .from("chat_threads")
    .select("id, point_of_contact_id")
    .eq("client_id", client.id)
    .eq("status", "active")
    .eq("chat_type", "session")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!thread) {
    const { data: newThread, error: threadError } = await supabase
      .from("chat_threads")
      .insert({
        client_id: client.id,
        status: "active",
        category: "general",
        chat_type: "session",
        point_of_contact_id: senderId,
        last_message_at: new Date().toISOString(),
      })
      .select("id, point_of_contact_id")
      .single();

    if (threadError || !newThread) {
      console.error("[ghl-sms] Session create failed:", threadError?.message);
      return NextResponse.json(
        { error: "Failed to open chat session" },
        { status: 500 }
      );
    }
    thread = newThread;
  } else if (!thread.point_of_contact_id && senderId) {
    await supabase
      .from("chat_threads")
      .update({ point_of_contact_id: senderId })
      .eq("id", thread.id);
  }

  const { error: messageError } = await supabase.from("chat_messages").insert({
    thread_id: thread.id,
    sender_id: senderId,
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
