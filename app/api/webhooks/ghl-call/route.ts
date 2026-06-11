import { NextResponse, type NextRequest } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createAdminClient } from "@/lib/supabase/admin";
import { findClientByPhone } from "@/lib/phone";
import type { Priority, TicketCategory } from "@/lib/types";

/**
 * GoHighLevel call webhook. GHL runs the IVR, voice AI, and
 * transcription — we receive the finished artifacts:
 * { caller_phone, recording_url, transcript, ivr_selection, duration, timestamp }
 *
 * Flow: map IVR digit → category → match client by phone → Claude
 * summarizes/triages the transcript → create a phone-sourced ticket →
 * drop a ticket card in the client's chat thread → notify the
 * department head.
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

const CATEGORIES: TicketCategory[] = ["seo", "ghl", "software", "billing", "general"];
const PRIORITIES: Priority[] = ["low", "medium", "high", "urgent"];

interface CallTriage {
  summary: string;
  category: TicketCategory;
  priority: Priority;
  title: string;
}

/**
 * Ask Claude to summarize the call and confirm category/priority.
 * Note: the spec named claude-sonnet-4-20250514, but that model retires
 * 2026-06-15 — claude-sonnet-4-6 is its designated replacement.
 */
async function triageWithClaude(
  transcript: string,
  ivrCategory: TicketCategory
): Promise<CallTriage | null> {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn("[ghl-call] ANTHROPIC_API_KEY not set — skipping AI triage");
    return null;
  }

  const client = new Anthropic();

  try {
    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1024,
      system:
        "You triage support calls for Bluejaypro, a digital marketing agency. " +
        "Categories: seo (search rankings, content, backlinks), ghl (GoHighLevel CRM, " +
        "funnels, automations), software (websites, apps, technical bugs), billing " +
        "(invoices, payments, plans), general (anything else). " +
        "Priorities: urgent (business down, revenue blocked), high (major feature broken, " +
        "angry client), medium (standard request), low (minor question or cosmetic issue).",
      messages: [
        {
          role: "user",
          content:
            `A client called our support line and chose the "${ivrCategory}" IVR option. ` +
            `Triage this call transcript:\n\n<transcript>\n${transcript}\n</transcript>\n\n` +
            "Write a 2-3 sentence summary of the issue, a short ticket title, " +
            "the correct category (the IVR choice may be wrong), and a priority.",
        },
      ],
      output_config: {
        format: {
          type: "json_schema",
          schema: {
            type: "object",
            properties: {
              summary: {
                type: "string",
                description: "2-3 sentence summary of the caller's issue",
              },
              title: {
                type: "string",
                description: "Short ticket title, under 80 characters",
              },
              category: { type: "string", enum: CATEGORIES },
              priority: { type: "string", enum: PRIORITIES },
            },
            required: ["summary", "title", "category", "priority"],
            additionalProperties: false,
          },
        },
      },
    });

    if (response.stop_reason === "refusal") {
      console.warn("[ghl-call] Claude declined to triage this transcript");
      return null;
    }

    const text = response.content.find((b) => b.type === "text")?.text;
    if (!text) return null;
    return JSON.parse(text) as CallTriage;
  } catch (error) {
    console.error("[ghl-call] Claude triage failed:", error);
    return null;
  }
}

export async function POST(request: NextRequest) {
  const payload = (await request.json().catch(() => null)) as {
    caller_phone?: string;
    recording_url?: string;
    transcript?: string;
    ivr_selection?: string | number;
    duration?: number;
    timestamp?: string;
  } | null;

  if (!payload?.caller_phone) {
    return NextResponse.json(
      { error: "Expected { caller_phone, recording_url, transcript, ivr_selection, duration, timestamp }" },
      { status: 400 }
    );
  }

  const supabase = createAdminClient();

  const client = await findClientByPhone(supabase, payload.caller_phone);
  if (!client) {
    console.warn(`[ghl-call] No client matches phone ${payload.caller_phone}`);
    return NextResponse.json({ received: true, matched: false });
  }

  const ivrCategory =
    IVR_CATEGORIES[String(payload.ivr_selection ?? "")] ?? "general";
  const transcript = payload.transcript?.trim() ?? "";

  // AI triage, with a deterministic fallback if Claude is unavailable.
  const triage = transcript
    ? await triageWithClaude(transcript, ivrCategory)
    : null;

  const category = triage?.category ?? ivrCategory;
  const priority = triage?.priority ?? "medium";
  const title =
    triage?.title ??
    `Phone call from ${client.company_name} (${ivrCategory.toUpperCase()})`;
  const summary =
    triage?.summary ??
    (transcript
      ? `${transcript.slice(0, 280)}${transcript.length > 280 ? "…" : ""}`
      : "Voice call received — no transcript available.");

  const slaDeadline = new Date(
    Date.now() + SLA_HOURS[priority] * 3600_000
  ).toISOString();

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
      department_id: client.assigned_department_id,
      voice_recording_url: payload.recording_url ?? null,
      transcription: transcript || null,
      ai_summary: triage?.summary ?? null,
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

  // Post-creation side effects are best-effort — the ticket is the
  // source of truth and is already saved.
  await Promise.all([
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
        ai_triaged: !!triage,
        duration: payload.duration ?? null,
      },
    }),
    postTicketCard(supabase, client.id, ticket.id, title),
    notifyDepartmentHead(supabase, client.assigned_department_id, {
      ticketId: ticket.id,
      title,
      company: client.company_name,
      priority,
    }),
  ]);

  return NextResponse.json({ received: true, ticket_id: ticket.id });
}

/** Drop a ticket_card message into the client's active chat thread. */
async function postTicketCard(
  supabase: ReturnType<typeof createAdminClient>,
  clientId: string,
  ticketId: string,
  title: string
) {
  let { data: thread } = await supabase
    .from("chat_threads")
    .select("id")
    .eq("client_id", clientId)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!thread) {
    const { data: newThread } = await supabase
      .from("chat_threads")
      .insert({
        client_id: clientId,
        status: "active",
        category: "General",
        last_message_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    thread = newThread;
  }
  if (!thread) return;

  await supabase.from("chat_messages").insert({
    thread_id: thread.id,
    sender_id: null,
    sender_type: "team",
    content: title,
    message_type: "ticket_card",
    metadata: {
      ticket_id: ticketId,
      ticket_title: title,
      ticket_status: "open",
      source: "phone",
    },
  });
  await supabase
    .from("chat_threads")
    .update({ last_message_at: new Date().toISOString() })
    .eq("id", thread.id);
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
