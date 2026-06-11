import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  addDispatchTag,
  createGhlContact,
  removeDispatchTag,
  searchContactByEmail,
} from "@/lib/ghl";
import { isTeamRole, type ClientUserRole, type UserRole } from "@/lib/types";

/** Returns the team member's user id, or null if not authorized. */
async function requireTeamMember(): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from("users")
    .select("role")
    .eq("id", user.id)
    .single();

  return isTeamRole((profile?.role ?? null) as UserRole | null)
    ? user.id
    : null;
}

/**
 * POST /api/clients/[id]/users — add a user under a client.
 * Body: { email, full_name, role: "owner" | "member" }
 *
 * Creates the Supabase auth user (profile row comes from the
 * handle_new_user trigger), links them via client_users, then tags
 * their GHL contact "dispatch-user" (creating the contact if needed)
 * and stores the GHL contact id on their user record.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const actorId = await requireTeamMember();
  if (!actorId) {
    return NextResponse.json({ error: "Team members only" }, { status: 403 });
  }

  const { id: clientId } = await params;
  const body = (await request.json().catch(() => null)) as {
    email?: string;
    full_name?: string;
    role?: ClientUserRole;
  } | null;

  const email = body?.email?.trim().toLowerCase();
  const fullName = body?.full_name?.trim();
  const role: ClientUserRole = body?.role === "owner" ? "owner" : "member";

  if (!email || !fullName) {
    return NextResponse.json(
      { error: "Expected { email, full_name, role }" },
      { status: 400 }
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

  // Reuse an existing account with this email, otherwise create one.
  let userId: string;
  const { data: existingUser } = await admin
    .from("users")
    .select("id")
    .eq("email", email)
    .maybeSingle();

  if (existingUser) {
    userId = existingUser.id;
    await admin.from("users").update({ full_name: fullName }).eq("id", userId);
  } else {
    const { data: created, error: createError } =
      await admin.auth.admin.createUser({
        email,
        email_confirm: true,
        user_metadata: { full_name: fullName, role: "client" },
      });

    if (createError || !created.user) {
      return NextResponse.json(
        { error: createError?.message ?? "Failed to create auth user" },
        { status: 500 }
      );
    }
    userId = created.user.id;
  }

  // Link the user to the client.
  const { data: membership, error: linkError } = await admin
    .from("client_users")
    .insert({ client_id: clientId, user_id: userId, role })
    .select("id, client_id, user_id, role, created_at")
    .single();

  if (linkError) {
    const conflict = linkError.code === "23505";
    return NextResponse.json(
      {
        error: conflict
          ? "This user is already on the client's team."
          : linkError.message,
      },
      { status: conflict ? 409 : 500 }
    );
  }

  // GHL: tag the contact "dispatch-user" so their SMS reaches Dispatch.
  // Best-effort — the Dispatch account exists either way.
  let ghlWarning: string | null = null;
  let ghlContactId: string | null = null;
  try {
    const existing = await searchContactByEmail(email);
    const contact =
      existing ?? (await createGhlContact({ email, name: fullName }));

    if (contact) {
      ghlContactId = contact.id;
      const tagged = await addDispatchTag(contact.id);
      if (!tagged) ghlWarning = "Could not add the dispatch-user tag in GHL.";
      await admin
        .from("users")
        .update({ ghl_contact_id: contact.id })
        .eq("id", userId);
    } else {
      ghlWarning = "Could not find or create a GHL contact for this email.";
    }
  } catch (error) {
    console.error("[client-users] GHL tagging failed:", error);
    ghlWarning = "GHL is not configured or unreachable — tag not applied.";
  }

  await admin.from("audit_logs").insert({
    user_id: actorId,
    entity_type: "client_user",
    entity_id: membership.id,
    action: "client_user_added",
    details: {
      client_id: clientId,
      email,
      role,
      ghl_contact_id: ghlContactId,
    },
  });

  const { data: user } = await admin
    .from("users")
    .select("id, email, full_name, avatar_url, ghl_contact_id")
    .eq("id", userId)
    .single();

  return NextResponse.json({
    member: { ...membership, user },
    warning: ghlWarning,
  });
}

/**
 * DELETE /api/clients/[id]/users?userId=... — remove a user from a
 * client: removes the "dispatch-user" tag in GHL and deletes the
 * client_users link. The auth account itself is kept.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const actorId = await requireTeamMember();
  if (!actorId) {
    return NextResponse.json({ error: "Team members only" }, { status: 403 });
  }

  const { id: clientId } = await params;
  const userId = request.nextUrl.searchParams.get("userId");
  if (!userId) {
    return NextResponse.json(
      { error: "Missing userId query parameter" },
      { status: 400 }
    );
  }

  const admin = createAdminClient();

  const { data: user } = await admin
    .from("users")
    .select("id, email, ghl_contact_id")
    .eq("id", userId)
    .maybeSingle();

  let ghlWarning: string | null = null;
  if (user?.ghl_contact_id) {
    try {
      const removed = await removeDispatchTag(user.ghl_contact_id);
      if (!removed) ghlWarning = "Could not remove the dispatch-user tag in GHL.";
    } catch (error) {
      console.error("[client-users] GHL untag failed:", error);
      ghlWarning = "GHL is not configured or unreachable — tag not removed.";
    }
  }

  const { error: deleteError } = await admin
    .from("client_users")
    .delete()
    .eq("client_id", clientId)
    .eq("user_id", userId);

  if (deleteError) {
    return NextResponse.json({ error: deleteError.message }, { status: 500 });
  }

  await admin.from("audit_logs").insert({
    user_id: actorId,
    entity_type: "client_user",
    entity_id: userId,
    action: "client_user_removed",
    details: { client_id: clientId, email: user?.email ?? null },
  });

  return NextResponse.json({ removed: true, warning: ghlWarning });
}
