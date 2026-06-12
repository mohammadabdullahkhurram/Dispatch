# GoHighLevel Integration Setup

Dispatch receives inbound SMS and call data from GoHighLevel (GHL) via
webhooks, and sends outbound SMS replies through the LeadConnector API.
GHL owns the IVR, voice AI, and transcription — Dispatch only consumes
the finished artifacts.

## 1. Environment variables

Add these to `.env.local` (and your Vercel project settings):

| Variable | Where to find it |
| --- | --- |
| `GHL_API_KEY` | GHL → Settings → Private Integrations → create a token with `conversations/message.write` and `contacts.readonly` scopes |
| `GHL_LOCATION_ID` | GHL → Settings → Business Profile (the sub-account/location id) |
| `GHL_PHONE_NUMBER` | The SMS-enabled number on the location, E.164 format (`+15551234567`) |

## 2. Webhook endpoints

Production base URL: `https://dispatch.loopflo.io`

| Purpose | Method | URL |
| --- | --- | --- |
| Inbound SMS | POST | `https://dispatch.loopflo.io/api/webhooks/ghl-sms` |
| Completed call | POST | `https://dispatch.loopflo.io/api/webhooks/ghl-call` |

These URLs are also shown (with copy buttons) in **Dashboard → Settings →
Integrations**.

## 3. Configure the inbound SMS workflow in GHL

1. Go to **Automation → Workflows → Create Workflow**.
2. Trigger: **Customer Replied** → filter to channel **SMS**.
3. Action: **Webhook (Custom Webhook)** → `POST https://dispatch.loopflo.io/api/webhooks/ghl-sms`.
4. Map the payload fields exactly:

```json
{
  "phone": "{{contact.phone}}",
  "message": "{{message.body}}",
  "contactId": "{{contact.id}}"
}
```

### What Dispatch does with it

1. Matches `phone` against `clients.phone` (last-10-digit comparison, so
   formatting differences don't matter).
2. Finds the client's active chat thread, or opens a new one.
3. Inserts the message as `sender_type: client` with
   `metadata.source: "sms"` — it appears live in **Dashboard → Chat**
   via Supabase realtime.
4. Unmatched numbers are acknowledged with `{ matched: false }` and
   logged, so GHL doesn't retry-storm.

## 4. Outbound SMS mirroring

When a team member replies in **Dashboard → Chat** and the client's most
recent message arrived via SMS, Dispatch automatically mirrors the reply
to the client's phone:

```
Dashboard chat reply
  → POST /api/chat/send-sms        (team auth required)
  → POST https://services.leadconnectorhq.com/conversations/messages
      { "type": "SMS", "contactId": "...", "message": "...", "fromNumber": GHL_PHONE_NUMBER }
```

The GHL `contactId` captured from the inbound webhook is reused; if it's
missing, Dispatch looks the contact up by phone via
`GET /contacts/?locationId={GHL_LOCATION_ID}&query={phone}`.

Meet links sent with `/meet` are mirrored as plain text
(`"Join our Google Meet: <url>"`). Ticket cards are not mirrored.

## 5. Call webhook

Configure the call workflow per [docs/ivr-setup.md](./ivr-setup.md). The
short version: after a call completes (IVR selection made, recording and
transcript ready), GHL posts to
`https://dispatch.loopflo.io/api/webhooks/ghl-call` and Dispatch
creates a triaged, phone-sourced ticket.

## 6. Test the connection

- **Dashboard → Settings → Integrations → Test connection** pings the
  SMS webhook endpoint.
- Or manually:

```bash
curl -X POST https://dispatch.loopflo.io/api/webhooks/ghl-sms \
  -H "Content-Type: application/json" \
  -d '{"phone": "+15551234567", "message": "Test from curl", "contactId": "test123"}'
```

A `200 { "received": true, "matched": true }` means the phone matched a
client and the message landed in their thread. `"matched": false` means
no client has that phone number — add it to the client record in
**Dashboard → Clients**.

## 7. Outbound calling & call logging

GHL exposes **no public API to dial a call** — outbound calls are placed
in GHL's own browser softphone (LC Phone / Twilio). The click-to-call
flow: the agent's browser connects first via WebRTC, then GHL bridges
out to the contact **from the location's number** (`GHL_PHONE_NUMBER`),
with recording and status tracked by GHL.

Dispatch integrates around that:

1. The **Call icon** in a chat session posts a `call_log` message
   ("Call initiated to …") and opens the contact in the GHL dialer
   (`app.gohighlevel.com/v2/location/{GHL_LOCATION_ID}/contacts/detail/{contactId}`)
   in a new tab. The agent clicks Call there. A floating widget in
   Dispatch shows the in-progress call.
2. A GHL workflow reports the outcome back. Create a workflow:
   trigger **Call Status** (fire on completed/no-answer as desired) →
   action **Webhook (Custom Webhook)**:

```
POST https://dispatch.loopflo.io/api/webhooks/ghl-call-log
```

```json
{
  "phone": "{{contact.phone}}",
  "direction": "{{call.direction}}",
  "call_status": "{{call.status}}",
  "duration": "{{call.duration}}",
  "recording_url": "{{call.recording_url}}"
}
```

Dispatch matches the phone to a client and posts a `call_log` message
(direction, status, duration, recording player) into their active
support session — covering both team callbacks and clients calling
back outside the IVR flow.

**Concurrency:** LC Phone numbers are Twilio-backed and handle many
simultaneous calls per number by default; the practical limit is agent
availability, not lines. Dispatch's call endpoints are stateless
per-request, so concurrent calls by different team members never
contend.

## Notes & hardening TODOs

- The webhook routes use the Supabase **service-role key** (they have no
  user session), so `SUPABASE_SERVICE_ROLE_KEY` must be set in Vercel.
- GHL custom webhooks don't sign payloads by default. For production,
  add a shared-secret query parameter (e.g. `?key=...`) to the webhook
  URLs in GHL and verify it in the route handlers.
