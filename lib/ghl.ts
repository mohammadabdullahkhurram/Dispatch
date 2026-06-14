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
  email?: string | null;
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
    contacts?: Array<{ id: string; tags?: string[]; email?: string | null }>;
  };
  const contact = data.contacts?.[0];
  return contact
    ? { id: contact.id, tags: contact.tags ?? [], email: contact.email ?? null }
    : null;
}

/**
 * Ensure a contact has an email on record. GHL's email send rejects
 * with 400 "Contact has no email" when the contact record lacks one
 * (e.g. a phone-only lead created from SMS), even if emailTo is set.
 */
export async function ensureContactEmail(
  contactId: string,
  email: string
): Promise<boolean> {
  const res = await fetch(`${GHL_API_BASE}/contacts/${contactId}`, {
    method: "PUT",
    headers: ghlHeaders(),
    body: JSON.stringify({ email }),
  });
  if (!res.ok) {
    console.error(
      `[ghl-email] could not set email on contact ${contactId}: ${res.status}`
    );
  }
  return res.ok;
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

  const data = (await res.json()) as {
    contact?: { id: string; email?: string | null };
  };
  return data.contact
    ? { id: data.contact.id, tags: [], email: data.contact.email ?? input.email ?? null }
    : null;
}

/**
 * Fetch the full GHL contact record (including custom fields). Used to
 * backfill a call's recording/transcript when the webhook fired before
 * GHL finished processing them.
 */
export async function getGhlContact(
  contactId: string
): Promise<Record<string, unknown> | null> {
  const res = await fetch(`${GHL_API_BASE}/contacts/${contactId}`, {
    headers: ghlHeaders(),
  });
  if (!res.ok) {
    console.error(`[ghl] contact fetch failed: ${res.status}`);
    return null;
  }
  const data = (await res.json()) as { contact?: Record<string, unknown> };
  return data.contact ?? null;
}

/** Pull a recording URL out of a GHL conversation message, whatever
 *  shape it's in (top-level, meta, attachments). */
function recordingFromMessage(m: Record<string, unknown>): string | null {
  const direct =
    m.recordingUrl ??
    m.recording_url ??
    m.url ??
    (m.meta as Record<string, unknown> | undefined)?.recordingUrl ??
    ((m.meta as Record<string, unknown> | undefined)?.call as
      | Record<string, unknown>
      | undefined)?.recordingUrl;
  if (typeof direct === "string" && /^https?:\/\//.test(direct)) return direct;

  const attachments = m.attachments;
  if (Array.isArray(attachments)) {
    for (const a of attachments) {
      const url = typeof a === "string" ? a : (a as Record<string, unknown>)?.url;
      if (typeof url === "string" && /^https?:\/\//.test(url)) return url;
    }
  }
  if (typeof m.body === "string" && /^https?:\/\/\S+$/.test(m.body.trim()))
    return m.body.trim();
  return null;
}

/**
 * Retrieve a call recording URL via the GHL Conversations API (no
 * Twilio): find the contact's conversation, then scan its messages for
 * a call/recording entry and extract the URL. Logs what it sees so the
 * extraction can be tuned to GHL's actual shape.
 */
export async function getCallRecordingUrl(
  contactId: string,
  locationId: string
): Promise<string | null> {
  try {
    const searchRes = await fetch(
      `${GHL_API_BASE}/conversations/search?contactId=${encodeURIComponent(contactId)}&locationId=${encodeURIComponent(locationId)}`,
      { headers: ghlHeaders() }
    );
    if (!searchRes.ok) {
      console.error(`[ghl-recording] conversation search failed: ${searchRes.status}`);
      return null;
    }
    const searchData = (await searchRes.json()) as {
      conversations?: Array<{ id?: string }>;
    };
    console.log(
      `[ghl-recording] conversations/search → ${JSON.stringify(searchData).slice(0, 400)}`
    );
    const conversations = searchData.conversations ?? [];

    for (const conv of conversations) {
      if (!conv.id) continue;
      const msgRes = await fetch(
        `${GHL_API_BASE}/conversations/${conv.id}/messages`,
        { headers: ghlHeaders() }
      );
      if (!msgRes.ok) {
        const body = await msgRes.text().catch(() => "");
        if (msgRes.status === 401 || /scope/i.test(body)) {
          console.error(
            "[ghl-recording] messages read rejected (401): the GHL_API_KEY " +
              "token needs the 'conversations/message.readonly' scope. " +
              "Recreate the Private Integration Token with it added."
          );
        } else {
          console.error(
            `[ghl-recording] messages fetch failed for ${conv.id}: ${msgRes.status} ${body.slice(0, 150)}`
          );
        }
        continue;
      }
      const msgData = (await msgRes.json()) as {
        messages?: { messages?: unknown[] } | unknown[];
      };
      console.log(
        `[ghl-recording] messages(${conv.id}) → ${JSON.stringify(msgData).slice(0, 800)}`
      );
      const raw = msgData.messages;
      const messages: unknown[] = Array.isArray(raw)
        ? raw
        : ((raw as { messages?: unknown[] } | undefined)?.messages ?? []);

      for (const item of messages) {
        if (!item || typeof item !== "object") continue;
        const m = item as Record<string, unknown>;
        const kind = String(m.messageType ?? m.type ?? "").toLowerCase();
        if (kind.includes("call") || kind.includes("recording")) {
          const url = recordingFromMessage(m);
          if (url) {
            console.log(`[ghl-recording] found recording URL: ${url}`);
            return url;
          }
        }
      }
    }
    console.log("[ghl-recording] no recording URL found in conversations");
    return null;
  } catch (error) {
    console.error("[ghl-recording] lookup threw:", error);
    return null;
  }
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

  // GHL rejects the send (400 "Contact has no email") unless the
  // contact record itself carries the address — a phone-only lead
  // (e.g. created from inbound SMS) won't. Backfill it before sending.
  if (!contact.email || contact.email.toLowerCase() !== to.toLowerCase()) {
    console.log(
      `[ghl-email] contact ${contact.id} email on record = ${contact.email ?? "(none)"}; setting to ${to}`
    );
    await ensureContactEmail(contact.id, to);
  }

  console.log(
    `[ghl-email] sending "${subject}" to ${to} (contact ${contact.id}) from ${process.env.GHL_FROM_EMAIL}`
  );

  // Canonical LeadConnector "send email" message: POST /conversations/
  // messages with type "Email". GHL wants both `html` (rich body) and a
  // plain-text `message` fallback; emailTo defaults to the contact but
  // we set it explicitly. Requires the GHL_API_KEY token to carry the
  // `conversations/message.write` scope.
  const url = `${GHL_API_BASE}/conversations/messages`;
  const payload = {
    type: "Email",
    contactId: contact.id,
    subject,
    html: htmlBody,
    message: htmlToText(htmlBody),
    emailTo: to,
    emailFrom: process.env.GHL_FROM_EMAIL,
  };
  const apiKey = process.env.GHL_API_KEY ?? "";
  console.log(`[ghl-email][debug] POST ${url}`);
  console.log(
    `[ghl-email][debug] auth: Bearer ${apiKey.slice(0, 4)}…${apiKey.slice(-4)} (len ${apiKey.length}), Version: ${GHL_API_VERSION}`
  );
  console.log(
    `[ghl-email][debug] payload: ${JSON.stringify({ ...payload, html: `<${htmlBody.length} chars>`, message: `<${payload.message.length} chars>` })}`
  );

  const res = await fetch(url, {
    method: "POST",
    headers: ghlHeaders(),
    body: JSON.stringify(payload),
  });

  const resBody = await res.text().catch(() => "");
  console.log(
    `[ghl-email][debug] response ${res.status} ${res.statusText}: ${resBody.slice(0, 500)}`
  );

  if (!res.ok) {
    // 401/403 here is a token-scope problem, not a payload problem —
    // give the exact remediation so it isn't mistaken for a code bug.
    const scopeIssue =
      res.status === 401 ||
      res.status === 403 ||
      /scope/i.test(resBody);
    const error = scopeIssue
      ? `GHL email rejected (${res.status}): the GHL_API_KEY token lacks the "conversations/message.write" scope. ` +
        `Private Integration Token scopes can't be edited — create a new token in GHL ` +
        `(Settings → Private Integrations) with conversations/message.write, contacts.readonly, ` +
        `and contacts.write, then update GHL_API_KEY. Also confirm the location has an email ` +
        `sending service connected. Raw: ${resBody.slice(0, 200)}`
      : `GHL email send failed (${res.status}): ${resBody.slice(0, 300)}`;
    console.error(`[ghl-email] ${error}`);
    return { ok: false, error };
  }
  console.log(`[ghl-email] sent to ${to}`);
  return { ok: true };
}

/** Minimal HTML→text for the plain-text email part. */
function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&mdash;/g, "—")
    .replace(/&rarr;/g, "→")
    .replace(/&ldquo;|&rdquo;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
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
