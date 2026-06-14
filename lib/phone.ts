import type { SupabaseClient } from "@supabase/supabase-js";
import type { Client } from "@/lib/types";

/** Strip formatting; compare on the last 10 digits (US numbers). */
export function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return digits.length > 10 ? digits.slice(-10) : digits;
}

export function phonesMatch(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  const na = normalizePhone(a);
  const nb = normalizePhone(b);
  return na.length >= 7 && na === nb;
}

/**
 * Find the client whose phone matches the given number.
 * Stored phone formats vary ("(555) 123-4567", "+15551234567"), so we
 * normalize in JS — client counts at agency scale make this cheap.
 */
export async function findClientByPhone(
  supabase: SupabaseClient,
  phone: string
): Promise<Client | null> {
  const { data, error } = await supabase
    .from("clients")
    .select("*")
    .not("phone", "is", null);

  if (error || !data) return null;
  return (
    (data as Client[]).find((c) => phonesMatch(c.phone, phone)) ?? null
  );
}

/**
 * Find the specific client user on a client's roster whose phone matches
 * the caller — used to attribute an inbound call/SMS to a person and set
 * the session's point of contact. Logs the roster + result so a missing
 * match (e.g. roster members with no phone on file) is diagnosable.
 */
export async function findContactUser(
  supabase: SupabaseClient,
  clientId: string,
  phone: string,
  name?: string | null
): Promise<{ id: string; full_name: string | null } | null> {
  const { data } = await supabase
    .from("client_users")
    .select("user:users(id, full_name, phone)")
    .eq("client_id", clientId);

  const members = (data ?? [])
    .map((row) => {
      const rel = row.user as unknown;
      return (Array.isArray(rel) ? rel[0] : rel) as {
        id: string;
        full_name: string | null;
        phone: string | null;
      } | null;
    })
    .filter((u): u is { id: string; full_name: string | null; phone: string | null } => !!u);

  // Primary: phone. Secondary: the name GHL gave us (roster members
  // often have no phone on file). Case/space-insensitive.
  let match = members.find((u) => phonesMatch(u.phone, phone));
  let via = "phone";
  if (!match && name?.trim()) {
    const target = name.trim().toLowerCase();
    match = members.find(
      (u) => (u.full_name ?? "").trim().toLowerCase() === target
    );
    if (match) via = "name";
  }

  console.log(
    `[poc-lookup] client=${clientId} caller=${phone} name=${name ?? "(none)"} ` +
      `roster=${JSON.stringify(members.map((m) => ({ name: m.full_name, phone: m.phone })))} ` +
      `→ ${match ? `${match.full_name} (${match.id}) via ${via}` : "NO MATCH"}`
  );
  return match ? { id: match.id, full_name: match.full_name } : null;
}
