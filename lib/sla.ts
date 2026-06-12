import type { Priority } from "@/lib/types";

/** Response-time targets per priority — hours from ticket creation. */
export const SLA_HOURS: Record<Priority, number> = {
  urgent: 2,
  high: 8,
  medium: 24,
  low: 72,
};

/** ISO timestamp of the SLA deadline for a ticket created now. */
export function slaDeadline(priority: Priority, from: Date = new Date()): string {
  return new Date(from.getTime() + SLA_HOURS[priority] * 3600_000).toISOString();
}
