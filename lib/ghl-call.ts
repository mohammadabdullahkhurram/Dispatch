import type { Priority, TicketCategory } from "@/lib/types";

/**
 * Shared parsing for GHL call data — field names and nesting vary by
 * workflow, and recording/transcript may be absent on the first webhook
 * and present on a later contact re-fetch. Used by the ghl-call webhook
 * and the ghl-call-retry endpoint.
 */

const IVR_CATEGORIES: Record<string, TicketCategory> = {
  "1": "seo",
  "2": "ghl",
  "3": "software",
  "4": "billing",
  "5": "general",
};
const VALID_CATEGORIES: TicketCategory[] = [
  "seo",
  "ghl",
  "software",
  "billing",
  "general",
];

/** First non-empty string among the candidates. */
export function pick(...vals: unknown[]): string | null {
  for (const v of vals) {
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number") return String(v);
  }
  return null;
}

/**
 * Recursively hunt for a key matching `re` and return its value. Handles
 * top-level keys, nested objects, and customField arrays of
 * { id|key|name, value }. Key casing/spacing varies, so callers pass a
 * permissive regex.
 */
export function deepFindField(obj: unknown, re: RegExp, depth = 0): string | null {
  if (!obj || depth > 5) return null;
  if (Array.isArray(obj)) {
    for (const item of obj) {
      if (item && typeof item === "object") {
        const o = item as Record<string, unknown>;
        const keyish = String(o.key ?? o.name ?? o.id ?? "");
        if (re.test(keyish)) {
          const v = o.value ?? o.field_value ?? o.fieldValue;
          if ((typeof v === "string" || typeof v === "number") && String(v).trim())
            return String(v).trim();
        }
      }
      const nested = deepFindField(item, re, depth + 1);
      if (nested) return nested;
    }
    return null;
  }
  if (typeof obj === "object") {
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      if (
        re.test(k) &&
        (typeof v === "string" || typeof v === "number") &&
        String(v).trim()
      ) {
        return String(v).trim();
      }
      if (v && typeof v === "object") {
        const nested = deepFindField(v, re, depth + 1);
        if (nested) return nested;
      }
    }
  }
  return null;
}

/** Map an IVR digit or a category name to a valid category. */
export function resolveCategory(raw: string | null): TicketCategory {
  if (!raw) return "general";
  if (IVR_CATEGORIES[raw]) return IVR_CATEGORIES[raw];
  const lower = raw.toLowerCase();
  return (VALID_CATEGORIES as string[]).includes(lower)
    ? (lower as TicketCategory)
    : "general";
}

/** Phone tickets default to medium; bump if the summary signals urgency. */
export function priorityFromSummary(summary: string | null): Priority {
  if (!summary) return "medium";
  const t = summary.toLowerCase();
  if (/\b(urgent|emergency|asap|critical|immediately|down|outage)\b/.test(t))
    return "urgent";
  if (/\b(high priority|high-priority|important|escalat)\b/.test(t))
    return "high";
  if (/\b(low priority|whenever|no rush|not urgent)\b/.test(t)) return "low";
  return "medium";
}

/** First sentence of the AI summary, trimmed to a ticket-title length. */
export function summaryToTitle(summary: string): string {
  const first = summary.split(/(?<=[.!?])\s/)[0]?.trim() || summary.trim();
  return first.length > 90 ? `${first.slice(0, 87)}…` : first;
}

/** Caller display name from a GHL payload/contact. */
export function extractCallerName(
  body: Record<string, unknown>
): string | null {
  const contact = (body.contact ?? {}) as Record<string, unknown>;
  const full = pick(body.full_name, body.fullName, contact.full_name, contact.fullName, contact.name);
  if (full) return full;
  const first = pick(body.first_name, body.firstName, contact.first_name, contact.firstName);
  const last = pick(body.last_name, body.lastName, contact.last_name, contact.lastName);
  const joined = [first, last].filter(Boolean).join(" ").trim();
  return joined || null;
}

/** Recording / transcript / AI summary from a payload or contact record. */
export function extractCallArtifacts(source: Record<string, unknown>): {
  recordingUrl: string | null;
  transcript: string;
  aiSummary: string | null;
} {
  const contact = (source.contact ?? {}) as Record<string, unknown>;
  const recordingUrl =
    pick(
      source.recording_url,
      source.recordingUrl,
      source.call_recording_url,
      source.recordingURL,
      contact.last_call_recording_url,
      source.last_call_recording_url
    ) ?? deepFindField(source, /recording[_\s-]?url|call[_\s-]?recording/i);
  const transcript =
    (pick(
      source.transcript,
      source.call_transcript,
      source.body,
      source.messageBody
    ) ?? deepFindField(source, /transcript/i)) ??
    "";
  const aiSummary =
    pick(source.ai_summary, source.summary) ??
    deepFindField(source, /ai[_\s-]?summary|call[_\s-]?summary/i);
  return { recordingUrl, transcript, aiSummary };
}
