# IVR & Call Pipeline Setup

GHL answers the phone, runs the IVR menu and voice AI, records the call,
transcribes it, and generates the AI summary. When the call ends, GHL
posts everything to Dispatch, which creates a support ticket
automatically.

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
  "ai_summary": "{{call.ai_summary}}",
  "ivr_selection": "{{call.ivr_selection}}",
  "duration": "{{call.duration}}",
  "timestamp": "{{call.ended_at}}"
}
```

> Field tokens vary by GHL plan/version — match whatever your workflow
> builder exposes for the recording URL, transcript text, AI summary,
> and the IVR digit. The names on the left are what Dispatch expects.

## 3. What Dispatch does on receipt

1. **Client match** — `caller_phone` against `clients.phone`
   (last-10-digit comparison). Unknown callers are acknowledged and
   logged, not ticketed.
2. **Summary** — GHL's `ai_summary` is saved on the ticket and used as
   its description. If GHL sends no summary, Dispatch falls back to the
   first 500 characters of the transcript.
3. **Ticket creation** — a ticket is inserted with `source: "phone"`,
   `status: "open"`, `medium` priority (24h SLA), the IVR category, the
   recording URL, full transcription, the AI summary, and the client's
   assigned department.
4. **Chat card** — a `ticket_card` message is posted into the client's
   active chat thread (opened if needed), so both the client portal and
   team chat show the new ticket inline.
5. **Notification** — the head of the client's assigned department gets
   a notification linking to the ticket queue.
6. **Audit trail** — entries are written to `ticket_activity_log`
   (`created_from_call`) and `audit_logs` (`ticket_created`, with the
   IVR digit, call duration, and whether GHL sent an AI summary).

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
    "ai_summary": "Jane from Acme reports their checkout page has been erroring since this morning and they are losing orders. She requests an urgent callback.",
    "ivr_selection": "3",
    "duration": 95,
    "timestamp": "2026-06-11T15:30:00Z"
  }'
```

Expected: `200 { "received": true, "ticket_id": "..." }`, a new
`software` ticket for the matched client with GHL's summary as the
description, a ticket card in their chat thread, and a notification for
the department head.
