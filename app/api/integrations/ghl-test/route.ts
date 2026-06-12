import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { testGhlConnection } from "@/lib/ghl";
import { isTeamRole, type UserRole } from "@/lib/types";

/** Team-only: verify the GHL env credentials with a live API call. */
export async function POST() {
  const supabase = await createClient();
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

  const result = await testGhlConnection();
  return NextResponse.json(result);
}
