import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { findClientByPhone, phonesMatch } from "@/lib/phone";
import { slaDeadline } from "@/lib/sla";
import { formatDuration } from "@/lib/format";
import type { Priority, TicketCategory } from "@/lib/types";

/**
 * GoHighLevel call webhook. GHL runs the IVR, voice AI, transcription,
 * and AI summarization — we receive the finished artifacts. Field names
 * vary by how the GHL workflow's custom-webhook action is mapped, so we
 * accept several aliases for each value and use whatever is present.
 *
 * Flow: resolve category → match client by phone → create a
 * phone-sourced ticket with GHL's summary → open a session with a
 * call_log → notify the department head.
 */

const IVR_CATEGORIES: Record<string, TicketCategory> = {
  "1": "seo",
  "2": "ghl",
  "3": "software",
  "4": "billing",
  "5": "general",
};
const VALID_CATEGORIES: TicketCategory[] = [
  "seo",
  "ghl",
  "software",
  "billing",
  "general",
];

/** First non-empty string among the candidates. */
function pick(...vals: unknown[]): string | null {
  for (const v of vals) {
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number") return String(v);
  }
  return null;
}

/**
 * GHL custom fields arrive in inconsistent shapes depending on workflow
 * config: a top-level key, nested under `contact`/`customData`, or as a
 * customField array of { id|key|name, value }. The key casing/spacing
 * also varies ("current_issue_category", "Current Issue Category", …).
 * Recursively hunt for a key matching `re` and return its value.
 */
function deepFindField(obj: unknown, re: RegExp, depth = 0): string | null {
  if (!obj || depth > 5) return null;
  if (Array.isArray(obj)) {
    for (const item of obj) {
      if (item && typeof item === "object") {
        const o = item as Record<string, unknown>;
        const keyish = String(o.key ?? o.name ?? o.id ?? "");
        if (re.test(keyish)) {
          const v = o.value ?? o.field_value ?? o.fieldValue;
          if ((typeof v === "string" || typeof v === "number") && String(v).trim())
            return String(v).trim();
        }
      }
      const nested = deepFindField(item, re, depth + 1);
      if (nested) return nested;
    }
    return null;
  }
  if (typeof obj === "object") {
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      if (
        re.test(k) &&
        (typeof v === "string" || typeof v === "number") &&
        String(v).trim()
      ) {
        return String(v).trim();
      }
      if (v && typeof v === "object") {
        const nested = deepFindField(v, re, depth + 1);
        if (nested) return nested;
      }
    }
  }
  return null;
}

/** Map an IVR digit or a category name to a valid category. */
function resolveCategory(raw: string | null): TicketCategory {
  if (!raw) return "general";
  if (IVR_CATEGORIES[raw]) return IVR_CATEGORIES[raw];
  const lower = raw.toLowerCase();
  return (VALID_CATEGORIES as string[]).includes(lower)
    ? (lower as TicketCategory)
    : "general";
}

/** Phone tickets default to medium; bump if the summary signals urgency. */
function priorityFromSummary(summary: string | null): Priority {
  if (!summary) return "medium";
  const t = summary.toLowerCase();
  if (/\b(urgent|emergency|asap|critical|immediately|down|outage)\b/.test(t))
    return "urgent";
  if (/\b(high priority|high-priority|important|escalat)\b/.test(t))
    return "high";
  if (/\b(low priority|whenever|no rush|not urgent)\b/.test(t)) return "low";
  return "medium";
}

/** First sentence of the AI summary, trimmed to a ticket-title length. */
function summaryToTitle(summary: string): string {
  const first = summary.split(/(?<=[.!?])\s/)[0]?.trim() || summary.trim();
  return first.length > 90 ? `${first.slice(0, 87)}…` : first;
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;

  // Log the exact payload so the GHL field mapping is verifiable.
  console.error("GHL CALL PAYLOAD:", JSON.stringify(body));

  const contact = (body?.contact ?? {}) as Record<string, unknown>;

  const callerPhone = pick(
    body?.caller_phone,
    body?.phone,
    contact.phone,
    body?.contactPhone
  );
  const recordingUrl = pick(
    body?.recording_url,
    body?.recordingUrl,
    body?.call_recording_url,
    body?.recordingURL
  );
  const transcript =
    pick(
      body?.transcript,
      body?.call_transcript,
      body?.body,
      body?.messageBody
    ) ?? "";
  const durationStr = pick(
    body?.duration,
    body?.call_duration,
    body?.callDuration
  );
  const categoryRaw =
    pick(
      body?.ivr_selection,
      body?.current_issue_category,
      contact.current_issue_category,
      (body?.customData as Record<string, unknown>)?.current_issue_category
    ) ??
    // Last resort: scan the whole payload for the IVR custom field
    // regardless of where/how GHL nested or cased it.
    (body ? deepFindField(body, /current[_\s-]?issue[_\s-]?category/i) : null);
  const aiSummary = pick(body?.ai_summary, body?.summary);
  const timestamp = pick(body?.timestamp, body?.date_created, body?.dateAdded);

  // Without a phone we can't attribute the call to a client — ack so
  // GHL doesn't retry-storm, but don't 400.
  if (!callerPhone) {
    console.warn("[ghl-call] no caller phone in payload — skipping");
    return NextResponse.json({ received: true, matched: false });
  }

  const supabase = createAdminClient();

  const client = await findClientByPhone(supabase, callerPhone);
  if (!client) {
    console.warn(`[ghl-call] No client matches phone ${callerPhone}`);
    return NextResponse.json({ received: true, matched: false });
  }

  const category = resolveCategory(categoryRaw);
  console.log(
    `[ghl-call] category: raw=${JSON.stringify(categoryRaw)} → resolved=${category}`
  );
  const priority = priorityFromSummary(aiSummary);

  // Title from the AI summary when present, else a dated label.
  const callDate = timestamp ? new Date(timestamp) : new Date();
  const dateLabel = Number.isNaN(callDate.getTime())
    ? new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    : callDate.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  const title = aiSummary
    ? summaryToTitle(aiSummary)
    : `Support Call - ${category.toUpperCase()} - ${dateLabel}`;

  // Description is the full transcript; the AI summary lives in its own
  // field. Placeholder when GHL hasn't sent a transcript (no AI step).
  const description = transcript || "No transcript available";

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
      description,
      category,
      priority,
      status: "open",
      source: "phone",
      client_id: client.id,
      department_id: matchedDepartment?.id ?? null,
      voice_recording_url: recordingUrl,
      transcription: transcript || null,
      ai_summary: aiSummary,
      sla_deadline: slaDeadline(priority),
      created_at: timestamp ?? undefined,
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

  // The caller becomes the session's point of contact when their
  // phone matches someone on the client's roster.
  const { data: roster } = await supabase
    .from("client_users")
    .select("user:users(id, full_name, phone)")
    .eq("client_id", client.id);
  const pocMatch = (roster ?? [])
    .map((row) => {
      const rel = row.user as unknown;
      return (Array.isArray(rel) ? rel[0] : rel) as {
        id: string;
        full_name: string | null;
        phone: string | null;
      } | null;
    })
    .find((u) => u && phonesMatch(u.phone, callerPhone));
  const pocId = pocMatch?.id ?? null;
  // Display name for the call_log: matched roster member, else the
  // client's primary contact.
  const callerName = pocMatch?.full_name ?? client.contact_name ?? null;

  // Each call opens a fresh support session linked to its ticket (it
  // auto-closes when the ticket resolves), seeded with a call_log
  // message carrying the recording. The workspace announcement comes
  // from the Dispatch Bot DB trigger.
  const { data: session } = await supabase
    .from("chat_threads")
    .insert({
      client_id: client.id,
      status: "active",
      category,
      chat_type: "session",
      linked_ticket_id: ticket.id,
      point_of_contact_id: pocId,
      last_message_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  const duration = durationStr != null ? Number(durationStr) : null;

  await Promise.all([
    session
      ? supabase.from("chat_messages").insert({
          thread_id: session.id,
          sender_id: pocId,
          sender_type: "client",
          content:
            `Inbound call from ${callerName ?? callerPhone}` +
            (duration != null && !Number.isNaN(duration)
              ? ` · ${formatDuration(duration)}`
              : ""),
          message_type: "call_log",
          metadata: {
            direction: "inbound",
            status: "completed",
            caller_name: callerName,
            phone: callerPhone,
            duration,
            recording_url: recordingUrl,
            transcript: transcript || null,
            ai_summary: aiSummary,
            ticket_id: ticket.id,
            category,
          },
        })
      : Promise.resolve(),
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
        ivr_selection: categoryRaw,
        has_ai_summary: !!aiSummary,
        duration: durationStr,
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
