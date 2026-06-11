import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Best-effort writers for audit_logs and ticket_activity_log.
 * Failures are logged, never thrown — auditing must not break the action.
 */

export async function logAudit(
  supabase: SupabaseClient,
  entry: {
    userId: string;
    entityType: string;
    entityId?: string | null;
    action: string;
    details?: Record<string, unknown>;
  }
) {
  const { error } = await supabase.from("audit_logs").insert({
    user_id: entry.userId,
    entity_type: entry.entityType,
    entity_id: entry.entityId ?? null,
    action: entry.action,
    details: entry.details ?? null,
  });
  if (error) console.error("audit_logs insert failed:", error.message);
}

export async function logTicketActivity(
  supabase: SupabaseClient,
  entry: {
    ticketId: string;
    userId: string;
    action: string;
    oldValue?: string | null;
    newValue?: string | null;
  }
) {
  const { error } = await supabase.from("ticket_activity_log").insert({
    ticket_id: entry.ticketId,
    user_id: entry.userId,
    action: entry.action,
    old_value: entry.oldValue ?? null,
    new_value: entry.newValue ?? null,
  });
  if (error) console.error("ticket_activity_log insert failed:", error.message);
}
