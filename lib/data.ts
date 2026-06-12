import { createClient as createServerSupabase } from "@/lib/supabase/server";
import type { Client, ClientUserRole, UserProfile } from "@/lib/types";

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

/** Client users map to their clients row by email (legacy link). */
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

/**
 * Resolve the signed-in client user's client and their role on it.
 * Prefers the client_users link; falls back to the legacy email match
 * (treated as account_owner — the primary contact).
 */
export async function getClientContext(
  supabase: Awaited<ReturnType<typeof createServerSupabase>>,
  profile: UserProfile
): Promise<{ client: Client | null; clientRole: ClientUserRole | null }> {
  const { data: membership } = await supabase
    .from("client_users")
    .select("role, client:clients(*)")
    .eq("user_id", profile.id)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (membership?.client) {
    const rel = membership.client as unknown;
    const client = (Array.isArray(rel) ? rel[0] : rel) as Client;
    return { client, clientRole: membership.role as ClientUserRole };
  }

  const legacy = await getClientForProfile(supabase, profile);
  return { client: legacy, clientRole: legacy ? "account_owner" : null };
}
