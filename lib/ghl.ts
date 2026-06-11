/**
 * GoHighLevel (LeadConnector) API helpers — server-only.
 * Docs: https://highlevel.stoplight.io/docs/integrations
 */

const GHL_API_BASE = "https://services.leadconnectorhq.com";
const GHL_API_VERSION = "2021-04-15";

function ghlHeaders() {
  const apiKey = process.env.GHL_API_KEY;
  if (!apiKey) throw new Error("GHL_API_KEY is not configured");
  return {
    Authorization: `Bearer ${apiKey}`,
    Version: GHL_API_VERSION,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

/** Tag that marks a GHL contact as a Dispatch chat user. */
export const DISPATCH_TAG = "dispatch-user";

export interface GhlContact {
  id: string;
  tags: string[];
}

/** Search contacts in our location by any query (phone, email, name). */
async function searchContacts(query: string): Promise<GhlContact | null> {
  const locationId = process.env.GHL_LOCATION_ID;
  if (!locationId) throw new Error("GHL_LOCATION_ID is not configured");

  const params = new URLSearchParams({ locationId, query });
  const res = await fetch(`${GHL_API_BASE}/contacts/?${params}`, {
    headers: ghlHeaders(),
  });

  if (!res.ok) {
    console.error(`GHL contact search failed: ${res.status}`);
    return null;
  }

  const data = (await res.json()) as {
    contacts?: Array<{ id: string; tags?: string[] }>;
  };
  const contact = data.contacts?.[0];
  return contact ? { id: contact.id, tags: contact.tags ?? [] } : null;
}

/** Find a GHL contact by phone number. */
export async function searchContactByPhone(
  phone: string
): Promise<GhlContact | null> {
  return searchContacts(phone);
}

/** Find a GHL contact by email. */
export async function searchContactByEmail(
  email: string
): Promise<GhlContact | null> {
  return searchContacts(email);
}

/** Back-compat: contact id by phone (used by outbound SMS). */
export async function lookupGhlContactByPhone(
  phone: string
): Promise<string | null> {
  return (await searchContactByPhone(phone))?.id ?? null;
}

/** Create a contact in our location. */
export async function createGhlContact(input: {
  email?: string;
  phone?: string;
  name?: string;
}): Promise<GhlContact | null> {
  const locationId = process.env.GHL_LOCATION_ID;
  if (!locationId) throw new Error("GHL_LOCATION_ID is not configured");

  const res = await fetch(`${GHL_API_BASE}/contacts/`, {
    method: "POST",
    headers: ghlHeaders(),
    body: JSON.stringify({
      locationId,
      email: input.email,
      phone: input.phone,
      name: input.name,
    }),
  });

  if (!res.ok) {
    console.error(`GHL contact create failed: ${res.status}`);
    return null;
  }

  const data = (await res.json()) as { contact?: { id: string } };
  return data.contact ? { id: data.contact.id, tags: [] } : null;
}

/** Return the tags on a GHL contact. */
export async function getContactTags(contactId: string): Promise<string[]> {
  const res = await fetch(`${GHL_API_BASE}/contacts/${contactId}`, {
    headers: ghlHeaders(),
  });

  if (!res.ok) {
    console.error(`GHL contact fetch failed: ${res.status}`);
    return [];
  }

  const data = (await res.json()) as { contact?: { tags?: string[] } };
  return data.contact?.tags ?? [];
}

/** Add the "dispatch-user" tag to a contact. */
export async function addDispatchTag(contactId: string): Promise<boolean> {
  const res = await fetch(`${GHL_API_BASE}/contacts/${contactId}/tags`, {
    method: "POST",
    headers: ghlHeaders(),
    body: JSON.stringify({ tags: [DISPATCH_TAG] }),
  });
  if (!res.ok) console.error(`GHL add tag failed: ${res.status}`);
  return res.ok;
}

/** Remove the "dispatch-user" tag from a contact. */
export async function removeDispatchTag(contactId: string): Promise<boolean> {
  const res = await fetch(`${GHL_API_BASE}/contacts/${contactId}/tags`, {
    method: "DELETE",
    headers: ghlHeaders(),
    body: JSON.stringify({ tags: [DISPATCH_TAG] }),
  });
  if (!res.ok) console.error(`GHL remove tag failed: ${res.status}`);
  return res.ok;
}

/**
 * Send an outbound SMS through GHL. Needs the GHL contact id —
 * pass one from inbound webhook metadata, or we look it up by phone.
 */
export async function sendGhlSms(options: {
  message: string;
  contactId?: string | null;
  phone?: string | null;
}): Promise<{ ok: boolean; error?: string }> {
  let contactId = options.contactId ?? null;

  if (!contactId && options.phone) {
    contactId = await lookupGhlContactByPhone(options.phone);
  }
  if (!contactId) {
    return { ok: false, error: "No GHL contact found for this client" };
  }

  const res = await fetch(`${GHL_API_BASE}/conversations/messages`, {
    method: "POST",
    headers: ghlHeaders(),
    body: JSON.stringify({
      type: "SMS",
      contactId,
      message: options.message,
      fromNumber: process.env.GHL_PHONE_NUMBER,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    return { ok: false, error: `GHL send failed (${res.status}): ${body}` };
  }
  return { ok: true };
}
