import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { ghlContactDeepLink, lookupGhlContactByPhone } from "@/lib/ghl";
import { isTeamRole, type UserRole } from "@/lib/types";

/**
 * Initiate a call to the client on a chat thread.
 *
 * GHL exposes no public dial API, so "initiate" means: resolve the
 * contact's GHL id, post a call_log message to the thread, and return
 * the GHL dialer deep link for the browser to open. The agent
 * completes the call in GHL's softphone (their browser leg connects
 * first, then GHL bridges to the client FROM the Dispatch number).
 * Real status/duration/recording flows back via the ghl-call-log
 * webhook. Stateless and per-request — concurrent calls by multiple
 * team members don't contend on anything in Dispatch.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from("users")
    .select("role, full_name")
    .eq("id", user.id)
    .single();
  if (!isTeamRole((profile?.role ?? null) as UserRole | null)) {
    return NextResponse.json({ error: "Team members only" }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as {
    threadId?: string;
  } | null;
  if (!body?.threadId) {
    return NextResponse.json(
      { error: "Expected { threadId }" },
      { status: 400 }
    );
  }

  const { data: thread } = await supabase
    .from("chat_threads")
    .select("id, client_id, client:clients(id, company_name, contact_name, phone)")
    .eq("id", body.threadId)
    .maybeSingle();

  const clientRel = thread?.client as unknown;
  const client = (Array.isArray(clientRel) ? clientRel[0] : clientRel) as {
    id: string;
    company_name: string;
    contact_name: string;
    phone: string | null;
  } | null;

  if (!thread || !client) {
    return NextResponse.json(
      { error: "This thread has no client to call." },
      { status: 422 }
    );
  }

  // Resolve the GHL contact: the person who last texted in, then any
  // roster member with a GHL link, then a lookup by the client phone.
  let contactId: string | null = null;
  let contactName = client.contact_name;

  const { data: lastClientMsg } = await supabase
    .from("chat_messages")
    .select("metadata, sender:users(full_name)")
    .eq("thread_id", thread.id)
    .eq("sender_type", "client")
    .order("sent_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const msgMeta = (lastClientMsg?.metadata ?? {}) as { contact_id?: string };
  if (msgMeta.contact_id) {
    contactId = msgMeta.contact_id;
    const senderRel = lastClientMsg?.sender as unknown;
    const sender = (Array.isArray(senderRel) ? senderRel[0] : senderRel) as {
      full_name?: string;
    } | null;
    if (sender?.full_name) contactName = sender.full_name;
  }

  if (!contactId) {
    const { data: roster } = await supabase
      .from("client_users")
      .select("user:users(full_name, ghl_contact_id)")
      .eq("client_id", client.id);
    const linked = (roster ?? [])
      .map((row) => {
        const rel = row.user as unknown;
        return (Array.isArray(rel) ? rel[0] : rel) as {
          full_name: string;
          ghl_contact_id: string | null;
        } | null;
      })
      .find((u) => u?.ghl_contact_id);
    if (linked) {
      contactId = linked.ghl_contact_id;
      contactName = linked.full_name;
    }
  }

  if (!contactId && client.phone) {
    try {
      contactId = await lookupGhlContactByPhone(client.phone);
    } catch (error) {
      console.error("[calls/initiate] GHL lookup failed:", error);
    }
  }

  if (!contactId) {
    return NextResponse.json(
      { error: "No GHL contact found for this client — add their phone or GHL link first." },
      { status: 404 }
    );
  }

  const url = ghlContactDeepLink(contactId);
  if (!url) {
    return NextResponse.json(
      { error: "GHL_LOCATION_ID is not configured." },
      { status: 500 }
    );
  }

  // Log the initiation into the thread; the workflow webhook will
  // follow up with the completed status/duration/recording.
  await supabase.from("chat_messages").insert({
    thread_id: thread.id,
    sender_id: user.id,
    sender_type: "team",
    content: `Call initiated to ${contactName}`,
    message_type: "call_log",
    metadata: {
      status: "initiated",
      direction: "outbound",
      contact_id: contactId,
      contact_name: contactName,
    },
  });
  await supabase
    .from("chat_threads")
    .update({ last_message_at: new Date().toISOString() })
    .eq("id", thread.id);
  await supabase.from("audit_logs").insert({
    user_id: user.id,
    entity_type: "chat_thread",
    entity_id: thread.id,
    action: "call_initiated",
    details: { client_id: client.id, contact_name: contactName },
  });

  return NextResponse.json({ url, contactName });
}
