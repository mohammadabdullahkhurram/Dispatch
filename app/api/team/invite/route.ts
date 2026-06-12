import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendEmail } from "@/lib/ghl";
import { teamInviteEmail } from "@/lib/emails";
import { ROLE_LABELS, TEAM_ROLES, type UserRole } from "@/lib/types";

/**
 * POST /api/team/invite — invite an agency team member.
 * agency_owner / agency_admin only. Body: { email, role, department_id? }
 *
 * Creates the Supabase auth account with a temporary password (the
 * profile row comes from the handle_new_user trigger) and emails the
 * invitee their login link + credentials via GHL.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const { data: actor } = await supabase
    .from("users")
    .select("role, full_name")
    .eq("id", user.id)
    .single();

  const actorRole = actor?.role as UserRole | undefined;
  if (actorRole !== "agency_owner" && actorRole !== "agency_admin") {
    return NextResponse.json(
      { error: "Only owners and admins can invite team members" },
      { status: 403 }
    );
  }

  const body = (await request.json().catch(() => null)) as {
    email?: string;
    role?: UserRole;
    department_id?: string;
  } | null;

  const email = body?.email?.trim().toLowerCase();
  const role = body?.role as UserRole;
  const departmentId = body?.department_id || null;

  if (!email || !TEAM_ROLES.includes(role)) {
    return NextResponse.json(
      { error: "Expected { email, role } with a valid team role" },
      { status: 400 }
    );
  }

  const admin = createAdminClient();

  const { data: existing } = await admin
    .from("users")
    .select("id")
    .eq("email", email)
    .maybeSingle();
  if (existing) {
    return NextResponse.json(
      { error: "A user with this email already exists." },
      { status: 409 }
    );
  }

  const tempPassword = randomBytes(9).toString("base64url");
  const { data: created, error: createError } =
    await admin.auth.admin.createUser({
      email,
      password: tempPassword,
      email_confirm: true,
      user_metadata: { role },
    });

  if (createError || !created.user) {
    return NextResponse.json(
      { error: createError?.message ?? "Failed to create auth user" },
      { status: 500 }
    );
  }

  if (departmentId) {
    await admin
      .from("users")
      .update({ department_id: departmentId })
      .eq("id", created.user.id);
  }

  // Email the credentials via GHL. The account exists either way —
  // surface a warning so the admin can follow up manually.
  let emailWarning: string | null = null;
  try {
    const { subject, html } = teamInviteEmail({
      email,
      tempPassword,
      roleLabel: ROLE_LABELS[role],
      invitedByName: actor?.full_name ?? "Your team",
    });
    const sent = await sendEmail(email, subject, html);
    if (!sent.ok) emailWarning = sent.error ?? "Invite email failed to send.";
  } catch (error) {
    console.error("[team-invite] email send failed:", error);
    emailWarning = "GHL is not configured or unreachable — invite email not sent.";
  }

  await admin.from("audit_logs").insert({
    user_id: user.id,
    entity_type: "user",
    entity_id: created.user.id,
    action: "team_member_invited",
    details: { email, role, email_sent: !emailWarning },
  });

  const { data: member } = await admin
    .from("users")
    .select("*")
    .eq("id", created.user.id)
    .single();

  return NextResponse.json({ member, warning: emailWarning });
}
