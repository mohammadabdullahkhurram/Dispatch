# IVR & Call Pipeline Setup

GHL answers the phone, runs the IVR menu and voice AI, records the call,
and transcribes it. When the call ends, GHL posts everything to Dispatch,
which creates a triaged support ticket automatically.

## 1. IVR menu → ticket category

Build the IVR in **GHL → Phone System → IVR** with this menu. The digit
the caller presses maps directly to a Dispatch ticket category:

| Digit | Prompt | Dispatch category |
| --- | --- | --- |
| 1 | "For SEO and content questions, press 1" | `seo` |
| 2 | "For CRM, funnels, and automations, press 2" | `ghl` |
| 3 | "For website or technical issues, press 3" | `software` |
| 4 | "For billing and invoices, press 4" | `billing` |
| 5 | "For anything else, press 5" | `general` |

Unrecognized or missing digits fall back to `general`.

After the menu, route the caller to the voice AI agent (or voicemail).
Enable **call recording** and **transcription** on the phone number —
Dispatch consumes both but generates neither.

## 2. Post-call webhook

Create a workflow: trigger **Call Status → Completed**, action
**Webhook (Custom Webhook)**:

```
POST https://dispatch-navy.vercel.app/api/webhooks/ghl-call
```

Payload mapping:

```json
{
  "caller_phone": "{{contact.phone}}",
  "recording_url": "{{call.recording_url}}",
  "transcript": "{{call.transcription}}",
  "ivr_selection": "{{call.ivr_selection}}",
  "duration": "{{call.duration}}",
  "timestamp": "{{call.ended_at}}"
}
```

> Field tokens vary by GHL plan/version — match whatever your workflow
> builder exposes for the recording URL, transcript text, and the IVR
> digit. The names on the left are what Dispatch expects.

## 3. What Dispatch does on receipt

1. **Client match** — `caller_phone` against `clients.phone`
   (last-10-digit comparison). Unknown callers are acknowledged and
   logged, not ticketed.
2. **AI triage** — the transcript is sent to Claude
   (`claude-sonnet-4-6`) which returns structured JSON: a 2–3 sentence
   issue summary, a short title, a confirmed category (it may override
   the IVR digit if the caller pressed the wrong one), and a suggested
   priority (`low` / `medium` / `high` / `urgent`). If `ANTHROPIC_API_KEY`
   isn't set or the call fails, Dispatch falls back to the IVR category,
   `medium` priority, and a truncated transcript as the summary.
3. **Ticket creation** — a ticket is inserted with `source: "phone"`,
   `status: "open"`, the recording URL, full transcription, AI summary,
   the client's assigned department, and an SLA deadline from priority
   (urgent 4h / high 8h / medium 24h / low 48h).
4. **Chat card** — a `ticket_card` message is posted into the client's
   active chat thread (opened if needed), so both the client portal and
   team chat show the new ticket inline.
5. **Notification** — the head of the client's assigned department gets
   a notification linking to the ticket queue.
6. **Audit trail** — entries are written to `ticket_activity_log`
   (`created_from_call`) and `audit_logs` (`ticket_created`, with the
   IVR digit, call duration, and whether AI triage ran).

The ticket appears in **Dashboard → Tickets** (Open column) with the
recording playable and the transcript readable in the detail slide-over.

## 4. Test without a real call

```bash
curl -X POST https://dispatch-navy.vercel.app/api/webhooks/ghl-call \
  -H "Content-Type: application/json" \
  -d '{
    "caller_phone": "+15551234567",
    "recording_url": "https://example.com/recording.mp3",
    "transcript": "Hi, this is Jane from Acme. Our checkout page has been throwing errors since this morning and we are losing orders. Please call me back as soon as possible.",
    "ivr_selection": "3",
    "duration": 95,
    "timestamp": "2026-06-11T15:30:00Z"
  }'
```

Expected: `200 { "received": true, "ticket_id": "..." }`, a new
high/urgent `software` ticket for the matched client, a ticket card in
their chat thread, and a notification for the department head.
