import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { findClientByPhone } from "@/lib/phone";
import type { Priority, TicketCategory } from "@/lib/types";

/**
 * GoHighLevel call webhook. GHL runs the IVR, voice AI, transcription,
 * and AI summarization — we receive the finished artifacts:
 * { caller_phone, recording_url, transcript, ai_summary, ivr_selection,
 *   duration, timestamp }
 *
 * Flow: map IVR digit → category → match client by phone → create a
 * phone-sourced ticket with GHL's summary → drop a ticket card in the
 * client's chat thread → notify the department head.
 */

const IVR_CATEGORIES: Record<string, TicketCategory> = {
  "1": "seo",
  "2": "ghl",
  "3": "software",
  "4": "billing",
  "5": "general",
};

// Same priority→SLA mapping the web portal uses.
const SLA_HOURS: Record<Priority, number> = {
  urgent: 4,
  high: 8,
  medium: 24,
  low: 48,
};

export async function POST(request: NextRequest) {
  const payload = (await request.json().catch(() => null)) as {
    caller_phone?: string;
    recording_url?: string;
    transcript?: string;
    ai_summary?: string;
    ivr_selection?: string | number;
    duration?: number;
    timestamp?: string;
  } | null;

  if (!payload?.caller_phone) {
    return NextResponse.json(
      { error: "Expected { caller_phone, recording_url, transcript, ai_summary, ivr_selection, duration, timestamp }" },
      { status: 400 }
    );
  }

  const supabase = createAdminClient();

  const client = await findClientByPhone(supabase, payload.caller_phone);
  if (!client) {
    console.warn(`[ghl-call] No client matches phone ${payload.caller_phone}`);
    return NextResponse.json({ received: true, matched: false });
  }

  const category =
    IVR_CATEGORIES[String(payload.ivr_selection ?? "")] ?? "general";
  const priority: Priority = "medium";
  const transcript = payload.transcript?.trim() ?? "";
  const aiSummary = payload.ai_summary?.trim() || null;

  // GHL's AI summary is the ticket description; fall back to the first
  // 500 characters of the transcript when it's missing.
  const summary =
    aiSummary ??
    (transcript
      ? `${transcript.slice(0, 500)}${transcript.length > 500 ? "…" : ""}`
      : "Voice call received — no transcript available.");

  const title = `Phone call from ${client.company_name} (${category.toUpperCase()})`;

  const slaDeadline = new Date(
    Date.now() + SLA_HOURS[priority] * 3600_000
  ).toISOString();

  // Tickets route to departments per issue, not per client: match a
  // department whose name contains the ticket category (e.g. "SEO",
  // "Billing"). No match → unrouted, triaged from the open queue.
  const { data: matchedDepartment } = await supabase
    .from("departments")
    .select("id")
    .ilike("name", `%${category}%`)
    .limit(1)
    .maybeSingle();

  const { data: ticket, error: ticketError } = await supabase
    .from("tickets")
    .insert({
      title,
      description: summary,
      category,
      priority,
      status: "open",
      source: "phone",
      client_id: client.id,
      department_id: matchedDepartment?.id ?? null,
      voice_recording_url: payload.recording_url ?? null,
      transcription: transcript || null,
      ai_summary: aiSummary,
      sla_deadline: slaDeadline,
      created_at: payload.timestamp ?? undefined,
    })
    .select("id, title, status")
    .single();

  if (ticketError || !ticket) {
    console.error("[ghl-call] Ticket insert failed:", ticketError?.message);
    return NextResponse.json(
      { error: "Failed to create ticket" },
      { status: 500 }
    );
  }

  // Each call opens a fresh support session linked to its ticket, so
  // the session auto-closes when the ticket resolves. The workspace
  // announcement comes from the Dispatch Bot DB trigger.
  await Promise.all([
    supabase.from("chat_threads").insert({
      client_id: client.id,
      status: "active",
      category,
      linked_ticket_id: ticket.id,
      last_message_at: new Date().toISOString(),
    }),
    supabase.from("ticket_activity_log").insert({
      ticket_id: ticket.id,
      user_id: null,
      action: "created_from_call",
      new_value: title,
    }),
    supabase.from("audit_logs").insert({
      user_id: null,
      entity_type: "ticket",
      entity_id: ticket.id,
      action: "ticket_created",
      details: {
        source: "phone",
        client_id: client.id,
        ivr_selection: payload.ivr_selection ?? null,
        has_ai_summary: !!aiSummary,
        duration: payload.duration ?? null,
      },
    }),
    notifyDepartmentHead(supabase, matchedDepartment?.id ?? null, {
      ticketId: ticket.id,
      title,
      company: client.company_name,
      priority,
    }),
  ]);

  return NextResponse.json({ received: true, ticket_id: ticket.id });
}

/** Notify the head of the client's assigned department. */
async function notifyDepartmentHead(
  supabase: ReturnType<typeof createAdminClient>,
  departmentId: string | null,
  ticket: { ticketId: string; title: string; company: string; priority: Priority }
) {
  if (!departmentId) return;

  const { data: department } = await supabase
    .from("departments")
    .select("head_user_id")
    .eq("id", departmentId)
    .maybeSingle();

  if (!department?.head_user_id) return;

  await supabase.from("notifications").insert({
    user_id: department.head_user_id,
    type: "ticket",
    title: `New ${ticket.priority} priority call ticket`,
    body: `${ticket.company}: ${ticket.title}`,
    link: "/dashboard/tickets",
  });
}
