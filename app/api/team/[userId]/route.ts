import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { UserRole } from "@/lib/types";

/**
 * DELETE /api/team/[userId] — remove an internal team member.
 * agency_owner / agency_admin only. You can't remove yourself or the
 * last agency_owner. Deletes the auth account; the public.users row
 * cascades, FKs null out (tickets/tasks keep their history), and
 * department headships clear automatically.
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  const { userId } = await params;
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

  const actorRole = actor?.role as UserRole | undefined;
  if (actorRole !== "agency_owner" && actorRole !== "agency_admin") {
    return NextResponse.json(
      { error: "Only owners and admins can remove team members" },
      { status: 403 }
    );
  }

  if (userId === user.id) {
    return NextResponse.json(
      { error: "You can't remove yourself." },
      { status: 400 }
    );
  }

  const admin = createAdminClient();

  const { data: target } = await admin
    .from("users")
    .select("id, email, full_name, role")
    .eq("id", userId)
    .maybeSingle();

  if (!target) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }
  if (target.role === "client") {
    return NextResponse.json(
      { error: "Client users are removed from their client's Team tab." },
      { status: 400 }
    );
  }

  if (target.role === "agency_owner") {
    const { count } = await admin
      .from("users")
      .select("id", { count: "exact", head: true })
      .eq("role", "agency_owner");
    if ((count ?? 0) <= 1) {
      return NextResponse.json(
        { error: "Can't remove the last agency owner." },
        { status: 400 }
      );
    }
  }

  // Audit before deletion — afterwards there's no user row to reference.
  await admin.from("audit_logs").insert({
    user_id: user.id,
    entity_type: "user",
    entity_id: target.id,
    action: "team_member_removed",
    details: {
      email: target.email,
      full_name: target.full_name,
      role: target.role,
    },
  });

  const { error: deleteError } = await admin.auth.admin.deleteUser(userId);
  if (deleteError) {
    return NextResponse.json({ error: deleteError.message }, { status: 500 });
  }

  return NextResponse.json({ removed: true });
}
