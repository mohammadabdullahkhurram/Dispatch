import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { sendGhlSms } from "@/lib/ghl";
import { isTeamRole, type UserRole } from "@/lib/types";

/**
 * Mirrors a team chat reply to the client's phone via GHL SMS.
 * Called by the dashboard chat when the client's last message
 * arrived with metadata.source === "sms".
 *
 * Body: { threadId, message }
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();

  // Only signed-in team members may trigger outbound SMS.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from("users")
    .select("role")
    .eq("id", user.id)
    .single();

  if (!isTeamRole((profile?.role ?? null) as UserRole | null)) {
    return NextResponse.json({ error: "Team members only" }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as {
    threadId?: string;
    message?: string;
  } | null;

  if (!body?.threadId || !body.message?.trim()) {
    return NextResponse.json(
      { error: "Expected { threadId, message }" },
      { status: 400 }
    );
  }

  // Resolve the thread's client phone (RLS: team can read all threads).
  const { data: thread } = await supabase
    .from("chat_threads")
    .select("id, client:clients(id, phone)")
    .eq("id", body.threadId)
    .maybeSingle();

  // Supabase types to-one joins as a possible array; normalize.
  const clientRel = thread?.client as unknown;
  const client = (Array.isArray(clientRel) ? clientRel[0] : clientRel) as {
    id: string;
    phone: string | null;
  } | null;
  if (!client) {
    return NextResponse.json({ error: "Thread not found" }, { status: 404 });
  }
  if (!client.phone) {
    return NextResponse.json(
      { error: "Client has no phone number on file" },
      { status: 422 }
    );
  }

  // Prefer the GHL contact id captured on the inbound SMS.
  const { data: lastSms } = await supabase
    .from("chat_messages")
    .select("metadata")
    .eq("thread_id", body.threadId)
    .eq("sender_type", "client")
    .order("sent_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const contactId =
    (lastSms?.metadata as { contact_id?: string } | null)?.contact_id ?? null;

  const result = await sendGhlSms({
    message: body.message.trim(),
    contactId,
    phone: client.phone,
  });

  if (!result.ok) {
    console.error("[send-sms]", result.error);
    return NextResponse.json({ error: result.error }, { status: 502 });
  }

  await supabase.from("audit_logs").insert({
    user_id: user.id,
    entity_type: "chat_message",
    entity_id: body.threadId,
    action: "sms_mirrored",
    details: { client_id: client.id },
  });

  return NextResponse.json({ sent: true });
}
