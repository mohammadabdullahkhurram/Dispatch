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
