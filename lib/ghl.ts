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

/**
 * Live check that the configured credentials actually work — fetches
 * one contact from the location. Returns the real API outcome.
 */
export async function testGhlConnection(): Promise<{
  ok: boolean;
  message: string;
}> {
  const locationId = process.env.GHL_LOCATION_ID;
  if (!process.env.GHL_API_KEY) {
    return { ok: false, message: "GHL_API_KEY is not set." };
  }
  if (!locationId) {
    return { ok: false, message: "GHL_LOCATION_ID is not set." };
  }

  try {
    const params = new URLSearchParams({ locationId, limit: "1" });
    const res = await fetch(`${GHL_API_BASE}/contacts/?${params}`, {
      headers: ghlHeaders(),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return {
        ok: false,
        message: `GHL responded ${res.status}: ${body.slice(0, 300) || res.statusText}`,
      };
    }

    const data = (await res.json()) as { contacts?: unknown[] };
    return {
      ok: true,
      message: `Connected — location reachable (${data.contacts?.length ?? 0} contact${data.contacts?.length === 1 ? "" : "s"} in test query).`,
    };
  } catch (error) {
    return {
      ok: false,
      message: `Could not reach GHL: ${error instanceof Error ? error.message : "unknown error"}`,
    };
  }
}

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
 * Send an email through GHL's conversations API. GHL email is
 * contact-centric, so we find-or-create the contact by address first.
 * Sends from GHL_FROM_EMAIL (falls back to the location default).
 */
export async function sendEmail(
  to: string,
  subject: string,
  htmlBody: string,
  options?: { contactName?: string }
): Promise<{ ok: boolean; error?: string }> {
  // Fail fast with a precise message when the env isn't configured —
  // these are the usual reasons "the email never arrived".
  const missing = ["GHL_API_KEY", "GHL_LOCATION_ID", "GHL_FROM_EMAIL"].filter(
    (key) => !process.env[key]
  );
  if (missing.length > 0) {
    const error = `Email not sent — missing env: ${missing.join(", ")}`;
    console.error(`[ghl-email] ${error}`);
    return { ok: false, error };
  }

  let contact: GhlContact | null;
  try {
    contact = await searchContactByEmail(to);
    if (!contact) {
      console.log(`[ghl-email] no GHL contact for ${to} — creating one`);
      contact = await createGhlContact({
        email: to,
        name: options?.contactName,
      });
    }
  } catch (error) {
    const message = `GHL contact lookup failed: ${error instanceof Error ? error.message : "unknown error"}`;
    console.error(`[ghl-email] ${message}`);
    return { ok: false, error: message };
  }
  if (!contact) {
    console.error(`[ghl-email] could not find or create a contact for ${to}`);
    return { ok: false, error: `No GHL contact found or created for ${to}` };
  }

  console.log(
    `[ghl-email] sending "${subject}" to ${to} (contact ${contact.id}) from ${process.env.GHL_FROM_EMAIL}`
  );

  // TEMP DEBUG — exact request (html omitted for size, API key masked)
  const url = `${GHL_API_BASE}/conversations/messages`;
  const payload = {
    type: "Email",
    contactId: contact.id,
    subject,
    html: htmlBody,
    emailTo: to,
    emailFrom: process.env.GHL_FROM_EMAIL,
  };
  const apiKey = process.env.GHL_API_KEY ?? "";
  console.log(`[ghl-email][debug] POST ${url}`);
  console.log(
    `[ghl-email][debug] auth: Bearer ${apiKey.slice(0, 4)}…${apiKey.slice(-4)} (len ${apiKey.length}), Version: ${GHL_API_VERSION}`
  );
  console.log(
    `[ghl-email][debug] payload: ${JSON.stringify({ ...payload, html: `<${htmlBody.length} chars>` })}`
  );

  const res = await fetch(url, {
    method: "POST",
    headers: ghlHeaders(),
    body: JSON.stringify(payload),
  });

  // TEMP DEBUG — full response, success or not
  const resBody = await res.text().catch(() => "");
  console.log(
    `[ghl-email][debug] response ${res.status} ${res.statusText}: ${resBody.slice(0, 500)}`
  );

  if (!res.ok) {
    const error = `GHL email send failed (${res.status}): ${resBody.slice(0, 300)}`;
    console.error(`[ghl-email] ${error}`);
    return { ok: false, error };
  }
  console.log(`[ghl-email] sent to ${to}`);
  return { ok: true };
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
