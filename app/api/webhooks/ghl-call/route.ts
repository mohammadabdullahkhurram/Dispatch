import { after, NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { findClientByPhone, findContactUser } from "@/lib/phone";
import { getCallRecordingFromConversation, getGhlContact } from "@/lib/ghl";
import {
  deepFindField,
  extractCallArtifacts,
  extractCallerName,
  pick,
  priorityFromSummary,
  resolveCategory,
  summaryToTitle,
} from "@/lib/ghl-call";
import { slaDeadline } from "@/lib/sla";
import { formatDuration } from "@/lib/format";
import type { Priority } from "@/lib/types";

/**
 * GoHighLevel call webhook. GHL runs the IVR, voice AI, transcription,
 * and AI summarization — we receive the finished artifacts. Field names
 * vary by how the GHL workflow's custom-webhook action is mapped, so we
 * accept several aliases for each value and use whatever is present.
 *
 * Flow: resolve category → match client by phone → create a
 * phone-sourced ticket → open a session with a call_log → notify the
 * department head. When recording/transcript are missing (the webhook
 * can fire before GHL finishes processing), schedule a retry that
 * re-fetches them from the GHL contact and patches the ticket + message.
 */

// Allow the after() retry-scheduler a window to run (Hobby caps at 60s).
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;

  // Log the exact payload so the GHL field mapping is verifiable.
  console.error("GHL CALL PAYLOAD:", JSON.stringify(body));

  const contact = (body?.contact ?? {}) as Record<string, unknown>;
  // contactId from body.contact_id; locationId from body.location.id
  // (per GHL webhook payload), with fallbacks.
  const contactId = pick(body?.contact_id, body?.contactId, contact.id);
  const location = (body?.location ?? {}) as Record<string, unknown>;
  const locationId =
    pick(location.id, body?.locationId) ?? process.env.GHL_LOCATION_ID ?? null;

  const callerPhone = pick(
    body?.caller_phone,
    body?.phone,
    contact.phone,
    body?.contactPhone
  );
  let { recordingUrl, transcript, aiSummary } = extractCallArtifacts(
    body ?? {}
  );
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
  const timestamp = pick(body?.timestamp, body?.date_created, body?.dateAdded);
  const ghlCallerName = body ? extractCallerName(body) : null;
  const customData = (body?.customData ?? {}) as Record<string, unknown>;
  const callSid = pick(
    customData.call_sid,
    body?.call_sid,
    contact.call_sid,
    body ? deepFindField(body, /call[_\s-]?sid/i) : null
  );

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

  // Transcript / AI summary may not be in the webhook body if GHL fired
  // before finishing processing — backfill them from the contact record.
  if (contactId && (!transcript || !aiSummary)) {
    try {
      const fresh = await getGhlContact(contactId);
      if (fresh) {
        const art = extractCallArtifacts(fresh);
        if (!transcript) transcript = art.transcript;
        aiSummary = aiSummary ?? art.aiSummary;
      }
    } catch (e) {
      console.error("[ghl-call] contact backfill failed:", e);
    }
  }

  // Recording URL: when empty, fetch it from the GHL Conversations API
  // (search conversation → read messages → extract recording URL).
  if (!recordingUrl && contactId && locationId) {
    const result = await getCallRecordingFromConversation(contactId, locationId);
    if (result) recordingUrl = result;
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

  // Store the Twilio call SID for reference. Separate update so a
  // missing column (migration 016 not yet applied) can't break ticket
  // creation — the error is logged and ignored.
  if (callSid) {
    const { error: sidError } = await supabase
      .from("tickets")
      .update({ call_sid: callSid })
      .eq("id", ticket.id);
    if (sidError) {
      console.warn(
        `[ghl-call] call_sid not stored (apply migration 016): ${sidError.message}`
      );
    }
  }

  // Point of contact: match by phone, then by the GHL-provided name.
  const pocMatch = await findContactUser(
    supabase,
    client.id,
    callerPhone,
    ghlCallerName
  );
  const pocId = pocMatch?.id ?? null;
  // Display name: matched roster member → GHL contact name → client
  // primary contact → "Caller". Stored as the thread title so the
  // session shows "[name] · [company]" even with no roster match.
  const callerName =
    pocMatch?.full_name ?? ghlCallerName ?? client.contact_name ?? "Caller";

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
      title: callerName,
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
            call_sid: callSid,
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
        call_sid: callSid,
      },
    }),
    notifyDepartmentHead(supabase, matchedDepartment?.id ?? null, {
      ticketId: ticket.id,
      title,
      company: client.company_name,
      priority,
    }),
  ]);

  // If the recording or transcript still isn't here, GHL likely hasn't
  // finished processing. Schedule a one-shot retry that re-fetches from
  // the contact and patches the ticket + call_log message.
  // NOTE: self-scheduled delays are best-effort on serverless — the
  // robust trigger is GHL firing a second "recording available" webhook
  // (or a cron) hitting this same endpoint. See ghl-call-retry.
  if (contactId && session && (!recordingUrl || !transcript)) {
    const base = process.env.NEXT_PUBLIC_APP_URL ?? "";
    const retryUrl =
      `${base}/api/webhooks/ghl-call-retry?contactId=${encodeURIComponent(contactId)}` +
      `&ticketId=${ticket.id}&threadId=${session.id}`;
    after(async () => {
      await new Promise((r) => setTimeout(r, 45000));
      try {
        await fetch(retryUrl);
      } catch (e) {
        console.error("[ghl-call] retry trigger failed:", e);
      }
    });
  }

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
