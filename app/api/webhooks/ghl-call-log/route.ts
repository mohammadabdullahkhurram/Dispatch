import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { findClientByPhone } from "@/lib/phone";
import { formatDuration } from "@/lib/format";

/**
 * GHL "Call Status" workflow webhook — logs completed calls (both
 * directions: team calling out via the GHL dialer, clients calling
 * back) into the client's active support session as a call_log
 * message with duration and recording.
 *
 * Payload: { phone, direction, call_status, duration, recording_url }
 */
export async function POST(request: NextRequest) {
  const payload = (await request.json().catch(() => null)) as {
    phone?: string;
    direction?: string;
    call_status?: string;
    duration?: number | string;
    recording_url?: string;
  } | null;

  if (!payload?.phone) {
    return NextResponse.json(
      { error: "Expected { phone, direction, call_status, duration, recording_url }" },
      { status: 400 }
    );
  }

  const supabase = createAdminClient();

  const client = await findClientByPhone(supabase, payload.phone);
  if (!client) {
    console.warn(`[ghl-call-log] No client matches phone ${payload.phone}`);
    return NextResponse.json({ received: true, matched: false });
  }

  // Land in the active session, or open one for this call thread.
  let { data: thread } = await supabase
    .from("chat_threads")
    .select("id")
    .eq("client_id", client.id)
    .eq("status", "active")
    .not("category", "in", '("workspace","internal")')
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!thread) {
    const { data: newThread } = await supabase
      .from("chat_threads")
      .insert({
        client_id: client.id,
        status: "active",
        category: "general",
        last_message_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    thread = newThread;
  }
  if (!thread) {
    return NextResponse.json(
      { error: "Failed to open chat session" },
      { status: 500 }
    );
  }

  const direction = payload.direction === "inbound" ? "inbound" : "outbound";
  const status = payload.call_status ?? "completed";
  const duration =
    payload.duration != null ? Number(payload.duration) : null;

  const content =
    `${direction === "inbound" ? "Inbound" : "Outbound"} call · ${status}` +
    (duration != null && !Number.isNaN(duration)
      ? ` · ${formatDuration(duration)}`
      : "");

  await supabase.from("chat_messages").insert({
    thread_id: thread.id,
    sender_id: null,
    // Inbound calls read as the client reaching out; outbound as team.
    sender_type: direction === "inbound" ? "client" : "team",
    content,
    message_type: "call_log",
    metadata: {
      direction,
      status,
      duration,
      recording_url: payload.recording_url ?? null,
      phone: payload.phone,
    },
  });

  await Promise.all([
    supabase
      .from("chat_threads")
      .update({ last_message_at: new Date().toISOString() })
      .eq("id", thread.id),
    supabase.from("audit_logs").insert({
      user_id: null,
      entity_type: "chat_thread",
      entity_id: thread.id,
      action: "call_logged",
      details: { client_id: client.id, direction, status, duration },
    }),
  ]);

  return NextResponse.json({ received: true, matched: true });
}
