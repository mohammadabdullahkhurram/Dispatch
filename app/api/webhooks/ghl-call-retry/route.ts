import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCallRecordingFromConversation, getGhlContact } from "@/lib/ghl";
import { extractCallArtifacts, summaryToTitle } from "@/lib/ghl-call";

/**
 * GET /api/webhooks/ghl-call-retry?contactId=&ticketId=&threadId=
 *
 * Re-fetches the GHL contact and backfills a call's recording /
 * transcript / AI summary onto the ticket and the session's call_log
 * message, for cases where the original webhook fired before GHL
 * finished processing the call. Idempotent — only fills blanks.
 *
 * Triggered best-effort by the ghl-call webhook after a delay, but also
 * safe to call from a GHL "recording available" workflow or a cron.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const contactId = params.get("contactId");
  const ticketId = params.get("ticketId");
  const threadId = params.get("threadId");

  if (!contactId || !ticketId) {
    return NextResponse.json(
      { error: "Expected contactId and ticketId" },
      { status: 400 }
    );
  }

  const contact = await getGhlContact(contactId);
  if (!contact) {
    return NextResponse.json({ ok: false, reason: "contact not found" });
  }

  // Transcript + summary come from the contact record; the recording URL
  // comes from the Conversations API (the same clean path the webhook uses).
  const { transcript, aiSummary } = extractCallArtifacts(contact);
  const locationId =
    (typeof contact.locationId === "string" ? contact.locationId : null) ??
    process.env.GHL_LOCATION_ID ??
    null;
  const recordingUrl = locationId
    ? await getCallRecordingFromConversation(contactId, locationId)
    : null;
  console.log(
    `[ghl-call-retry] contact=${contactId} recording=${!!recordingUrl} transcript=${!!transcript} summary=${!!aiSummary}`
  );
  if (!recordingUrl && !transcript && !aiSummary) {
    return NextResponse.json({ ok: true, updated: false, reason: "still empty" });
  }

  const admin = createAdminClient();

  // Patch the ticket — only fill fields that are currently blank.
  const { data: ticket } = await admin
    .from("tickets")
    .select("id, title, description, voice_recording_url, transcription, ai_summary, category, created_at")
    .eq("id", ticketId)
    .maybeSingle();

  if (ticket) {
    const patch: Record<string, unknown> = {};
    if (recordingUrl && !ticket.voice_recording_url)
      patch.voice_recording_url = recordingUrl;
    if (transcript && !ticket.transcription) {
      patch.transcription = transcript;
      if (!ticket.description || ticket.description === "No transcript available")
        patch.description = transcript;
    }
    if (aiSummary && !ticket.ai_summary) {
      patch.ai_summary = aiSummary;
      // Upgrade the auto-generated "Support Call - …" title once we have
      // a real summary.
      if (/^Support Call - /.test(ticket.title))
        patch.title = summaryToTitle(aiSummary);
    }
    if (Object.keys(patch).length > 0) {
      await admin.from("tickets").update(patch).eq("id", ticketId);
    }
  }

  // Patch the session's call_log message metadata.
  if (threadId) {
    const { data: msg } = await admin
      .from("chat_messages")
      .select("id, metadata")
      .eq("thread_id", threadId)
      .eq("message_type", "call_log")
      .order("sent_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (msg) {
      const meta = (msg.metadata ?? {}) as Record<string, unknown>;
      const next = {
        ...meta,
        recording_url: meta.recording_url ?? recordingUrl,
        transcript: meta.transcript ?? (transcript || null),
        ai_summary: meta.ai_summary ?? aiSummary,
      };
      await admin
        .from("chat_messages")
        .update({ metadata: next })
        .eq("id", msg.id);
    }
  }

  return NextResponse.json({
    ok: true,
    updated: true,
    recording: !!recordingUrl,
    transcript: !!transcript,
    ai_summary: !!aiSummary,
  });
}
