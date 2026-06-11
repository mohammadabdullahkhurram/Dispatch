import { createClient as createServerSupabase } from "@/lib/supabase/server";
import type { Client, UserProfile } from "@/lib/types";

/**
 * Server-side helpers for the signed-in user. The proxy guarantees an
 * authenticated session on /portal and /dashboard routes.
 */
export async function getCurrentProfile(): Promise<{
  supabase: Awaited<ReturnType<typeof createServerSupabase>>;
  profile: UserProfile | null;
}> {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { supabase, profile: null };

  const { data: profile } = await supabase
    .from("users")
    .select("*")
    .eq("id", user.id)
    .single();

  return { supabase, profile: (profile as UserProfile) ?? null };
}

/** Client users map to their clients row by email. */
export async function getClientForProfile(
  supabase: Awaited<ReturnType<typeof createServerSupabase>>,
  profile: UserProfile
): Promise<Client | null> {
  const { data } = await supabase
    .from("clients")
    .select("*")
    .eq("email", profile.email)
    .maybeSingle();
  return (data as Client) ?? null;
}
