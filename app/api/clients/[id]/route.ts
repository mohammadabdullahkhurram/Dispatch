import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { UserRole } from "@/lib/types";

/**
 * DELETE /api/clients/[id] — permanently delete a client.
 * agency_owner / agency_admin only.
 *
 * The workspace thread is marked is_deletable=false (013 trigger blocks
 * its deletion), so a plain client delete fails at the FK cascade with
 * "This thread cannot be deleted". We tear the chat down explicitly in
 * order: messages → mark threads deletable → threads → client (the rest
 * — tickets, checklist, documents, roster — cascade from the client).
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: clientId } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { data: actor } = await supabase
    .from("users")
    .select("role")
    .eq("id", user.id)
    .single();
  const role = actor?.role as UserRole | undefined;
  if (role !== "agency_owner" && role !== "agency_admin") {
    return NextResponse.json(
      { error: "Only owners and admins can delete clients" },
      { status: 403 }
    );
  }

  const admin = createAdminClient();

  const { data: client } = await admin
    .from("clients")
    .select("id, company_name")
    .eq("id", clientId)
    .maybeSingle();
  if (!client) {
    return NextResponse.json({ error: "Client not found" }, { status: 404 });
  }

  // 1. Messages in all of the client's threads.
  const { data: threads } = await admin
    .from("chat_threads")
    .select("id")
    .eq("client_id", clientId);
  const threadIds = (threads ?? []).map((t) => t.id);
  if (threadIds.length > 0) {
    const { error: msgError } = await admin
      .from("chat_messages")
      .delete()
      .in("thread_id", threadIds);
    if (msgError) {
      return NextResponse.json({ error: msgError.message }, { status: 500 });
    }
  }

  // 2. Make the workspace thread deletable, then 3. delete all threads.
  await admin
    .from("chat_threads")
    .update({ is_deletable: true })
    .eq("client_id", clientId);
  const { error: threadError } = await admin
    .from("chat_threads")
    .delete()
    .eq("client_id", clientId);
  if (threadError) {
    return NextResponse.json({ error: threadError.message }, { status: 500 });
  }

  // 4. The client — tickets, checklist items, documents, and roster
  //    links cascade from here.
  const { error: clientError } = await admin
    .from("clients")
    .delete()
    .eq("id", clientId);
  if (clientError) {
    return NextResponse.json({ error: clientError.message }, { status: 500 });
  }

  await admin.from("audit_logs").insert({
    user_id: user.id,
    entity_type: "client",
    entity_id: clientId,
    action: "client_deleted",
    details: { company_name: client.company_name },
  });

  return NextResponse.json({ deleted: true });
}
