# Dispatch

**Bluejaypro's internal operations platform** — client management, ticketing, chat (web + SMS + calls via GoHighLevel), tasks, and notifications in one workspace with light/dark themes. Clients get a self-service portal; the agency team gets a full operations dashboard.

**Live:** https://dispatch.loopflo.io

## How It Works

**Bluejaypro** is a digital marketing agency; **Loopflo** is its GoHighLevel (GHL) agency account, which provides the telephony layer — the support number (+1 888 853-5324), SMS, IVR call handling, transcription/AI summaries, and transactional email sending. **Dispatch** is the internal platform that ties it together: every client interaction (web chat, SMS, phone call, ticket) lands in one place, gets routed to the right department, and is tracked against SLAs.

There are two kinds of users. The **agency team** works in `/dashboard`: a ticket kanban, task manager, multi-channel chat, client profiles, and settings. **Clients** work in `/portal`: they submit and track tickets, chat with the team (the same conversation continues over SMS if they text the support line), follow their onboarding checklist, see the tasks being done for them, and manage their brand kit and team roster. Role-based routing in `proxy.ts` keeps each side in its own area, and Postgres RLS enforces the same boundaries at the data layer.

A typical flow: a client texts the support number → GHL's workflow posts to Dispatch's SMS webhook → the message appears in the team chat in realtime (and the team's reply is mirrored back as SMS). Or they call → GHL's IVR routes by digit, records, transcribes, and summarizes → Dispatch creates a phone-sourced ticket with an SLA deadline and notifies the department head.

## Tech Stack

| Layer | Technology |
| --- | --- |
| Framework | Next.js **16.2.9** (App Router, Turbopack) + React 19 + TypeScript |
| Styling | Tailwind CSS v4, shadcn/ui (Radix, Nova preset), lucide-react, next-themes |
| Backend | Supabase — Postgres, Auth, Storage, Realtime, RLS |
| Telephony/SMS/Email | GoHighLevel (LeadConnector API + workflow webhooks) |
| Hosting | Vercel (incl. cron for time-based notifications) |

> **Note:** this Next.js version renamed `middleware.ts` to **`proxy.ts`** — route protection lives there.

## Architecture

```
dispatch/
├── proxy.ts                     # Auth + role-based routing (Next 16's middleware)
├── vercel.json                  # Cron: /api/cron/notifications every 15 min
├── app/
│   ├── (auth)/
│   │   ├── login/               # Split-screen login (animated brand panel) + forgot password
│   │   └── reset-password/      # Recovery-token password reset
│   ├── (client)/portal/         # Client portal (role-gated nav, theme toggle)
│   │   ├── page.tsx             # Overview: stats, onboarding, recent tickets
│   │   ├── tickets/             # Submit + track tickets (SLA countdown)
│   │   ├── tasks/               # Read-only task list with status filter
│   │   ├── chat/                # Workspace chat + Direct Messages
│   │   └── profile/             # Company info, My Account, Team, Checklist,
│   │                            #   Documents, Branding (tab-gated by role)
│   ├── (team)/dashboard/        # Team workspace (theme toggle + notification bell)
│   │   ├── page.tsx             # Stat cards w/ trends, timeline activity, my tasks
│   │   ├── clients/             # Searchable list + 8-tab client profile (hero header)
│   │   ├── tickets/             # Kanban (Open/In Progress/Escalated/Resolved)
│   │   ├── tasks/               # Kanban/list, filters, comments
│   │   ├── chat/                # Workspace / Sessions / Internal chat + DMs
│   │   ├── notifications/       # Realtime list, filters, mark-all-read
│   │   └── settings/            # Two-column settings + profile + checklist templates
│   └── api/
│       ├── webhooks/ghl-sms/      # Inbound SMS (tag-gated) → session chat
│       ├── webhooks/ghl-call/     # Completed IVR call → ticket + session + call_log
│       ├── chat/send-sms/         # Mirror team reply to SMS via GHL
│       ├── clients/               # Create client + portal account + onboarding email
│       ├── clients/[id]/users/    # Add/remove client users (+ GHL tagging + onboarding email)
│       ├── cron/notifications/    # Time-based checks (SLA breach, task due/overdue)
│       ├── integrations/ghl-test/ # Live GHL credential check
│       ├── team/invite/           # Create team account + emailed credentials
│       └── team/[userId]/         # Remove internal team member
├── components/                  # ui/ (shadcn + dispatch-logo), dashboard/, portal/, chat/, shared
├── lib/                         # supabase clients, ghl.ts (SMS + email), emails.ts,
│                                #   sla.ts, phone.ts, audit.ts, types.ts, format.ts
├── supabase/migrations/         # 001–012 (see Migrations)
├── scripts/                     # reset_test_data.sql + run-reset.mjs (wipe test
│                                #   data, keep users/departments/templates)
└── docs/                        # ghl-setup.md, ivr-setup.md
```

**Route groups:** `(auth)` is public; `(client)` and `(team)` are fenced by `proxy.ts`, which refreshes the Supabase session, reads the user's role, and keeps clients in `/portal` and team members in `/dashboard`.

**Database (16 tables):** `users` (mirrors `auth.users`, role enum), `departments`, `clients` (+ status, branding jsonb), `client_users` (multi-user roster, 4 roles), `client_checklist_items`, `checklist_templates`, `client_documents`, `tickets` (+ SLA, transcription, AI summary), `ticket_activity_log`, `tasks`, `task_comments`, `chat_threads` (workspace/session/internal/dm), `chat_messages` (text/ticket_card/recording/meet_link/call_log), `notifications` (+ entity dedupe), `audit_logs`, `canned_responses`, `app_settings`. Everything is under RLS: team-wide access via `is_team_member()`, client access scoped through `current_client_id()`. DB triggers handle: new-user profile creation, new-client workspace thread + checklist application, Dispatch Bot ticket announcements, linked-session auto-close, SLA-deadline backstop, and all event notifications (so every creation path is covered).

## Roles & Permissions

### Agency team (`users.role`)

| Capability | agency_owner | agency_admin | agency_manager | department_head | department_member |
| --- | :-: | :-: | :-: | :-: | :-: |
| Dashboard, tickets, tasks, chat, clients | ✅ | ✅ | ✅ | ✅ | ✅ |
| Create/edit clients, checklists, canned responses | ✅ | ✅ | ✅ | ✅ | ✅ |
| Toggle client active/inactive | ✅ | ✅ | ✅ | ❌ | ❌ |
| Delete clients / workspace chats | ✅ | ✅ | ❌ | ❌ | ❌ |
| Invite / remove team members, change roles | ✅ | ✅ | ❌ | ❌ | ❌ |
| Read Audit Log (RLS-enforced) | ✅ | ✅ | ❌ | ❌ | ❌ |
| See all DM threads (non-participant) | ✅ | ✅ | ❌ | ❌ | ❌ |
| Receive escalation fallback notifications | ✅ | ✅ | ❌ | ❌ | ❌ |
| Department-head notifications (SLA breach, escalation, overdue tasks) | — | — | — | ✅ (own dept) | ❌ |

Guards: you can't remove yourself, the last `agency_owner` can't be removed, and client users are removed from their client's Team tab instead.

### Client portal (`client_users.role`)

| Capability | account_owner | account_admin | office_member | contractor |
| --- | :-: | :-: | :-: | :-: |
| Overview, tickets, tasks, chat | ✅ | ✅ | ✅ | ✅ |
| Billing-category tickets visible | ✅ | ✅ | ❌ | ❌ |
| Checklist, Documents, Branding tabs | ✅ | ✅ | ❌ | ❌ |
| Edit company info / brand kit / logo | ✅ | ✅ | ❌ | ❌ |
| Manage client team roster | ✅ | ✅ | ❌ | ❌ |
| Receives the onboarding welcome email | ✅ | ❌ | ❌ | ❌ |

All client roles are read-only on tasks (no internal comments exposed) and can send/receive in the workspace chat and any DM they're a participant of.

## Chat Architecture

Four thread types live in `chat_threads.category`:

| Type | `category` | Created by | Who sees it | Example |
| --- | --- | --- | --- | --- |
| **Workspace** | `workspace` | Automatically with the client | Whole team + all client users | The permanent "Acme Co. ↔ Bluejaypro" room; Dispatch Bot posts ticket updates here |
| **Session** | issue category (`seo`, `billing`, …) | Web ticket, inbound SMS/call, or team | Whole team + client users | A client texts about an invoice → a `billing` session opens, linked to its ticket, and auto-closes when the ticket resolves |
| **DM** | `dm` | Team member from the workspace Members list | The two participants + agency owners/admins | An account manager pings Acme's office manager 1-on-1; the client replies from Portal → Chat → Direct Messages |
| **Internal** | `internal` | Team member | Selected team participants only | "SEO squad" group thread — clients never see it |

Sessions are the only SMS-bridged type: a team reply mirrors out as SMS when the client's last inbound message arrived via SMS. Workspace, DM, and internal threads are web-only. Each session carries a **point of contact** — the client user who submitted the ticket or whose phone matched the SMS/call.

## Features

### Authentication & Roles
- ✅ Login with role-based redirect (clients → `/portal`, team → `/dashboard`)
- ✅ Team invites (Settings → Team): creates the Supabase account with a temp password and emails login credentials via GHL
- ✅ Client onboarding email: adding an `account_owner` sends the portal URL, credentials, and support number
- ✅ Password reset flow (forgot-password email → `/reset-password`, handled by Supabase)
- ✅ Profile settings (avatar upload, name, phone, password change) for team and clients
- ✅ Inactive-client lockout at login and in the portal layout

### Design System
- ✅ Light/dark themes (next-themes, dark default) with toggle in both layouts and on login
- ✅ Token-driven palette in `globals.css` (near-black surfaces, electric blue accent, semantic success/warning/danger)
- ✅ Dispatch logo component (geometric D mark; full / icon / wordmark variants) + SVG favicon
- ✅ Geist throughout; tight-tracked semibold headings, 1.6 body line-height, uppercase section labels
- ✅ Consistent components: bordered cards that brighten on hover, pill badges, striped tables with uppercase headers, kanban cards with priority borders, chat bubbles with hover-reveal timestamps

### Client Management
- ✅ Create clients via `POST /api/clients` — one call creates the row (checklist templates + workspace chat fire by trigger), the contact's portal account as `account_owner` with a 12-char temporary password, the GHL contact + `dispatch-user` tag, and sends the onboarding email (welcome, portal URL, credentials, support number); every step is traced with `[clients]` / `[ghl-email]` logs
- ✅ Edit / delete clients (role-gated, audit-logged)
- ✅ Client profile with hero header (logo, quick stats) and **8 underline tabs**: Overview, Team, Tickets, Tasks, Chat History, Documents, Checklist, Branding
- ✅ Active/inactive status (closes sessions, blocks portal access; reactivation restores)
- ✅ Multi-user per client with the four roles; SMS sender matching by user phone
- ✅ Client self-service team management (account_owner/account_admin via portal Team tab)
- ✅ Checklist templates (manager CRUD, apply-to-clients, auto-applied to new clients)
- ✅ **Brand kit editing** — up to 5 brand colors (pickers, stored as a hex array) + primary/secondary fonts, editable from both the team profile and the portal Branding tab; logo upload included

### Ticket System
- ✅ Web submission from the portal (category, priority, file upload)
- ✅ Team kanban with filters, priority-colored cards, and a create dialog
- ✅ **SLA on every path** — urgent 2h / high 8h / medium 24h / low 72h from creation; set by the kanban dialog, `/ticket` chat command, portal submission, and call webhook, with a DB before-insert trigger as backstop; live countdown pulses red when breached
- ✅ Assign/assign-to-me, escalate, status changes, resolve with notes; per-ticket activity log
- ✅ Tickets from chat — `/ticket` and the header icon open the **full form** (title, description, category prefilled from the session, priority, file attachment) with the SLA set from priority; sessions link and auto-close on resolve
- 🔧 Voice/phone tickets: webhook fully built; the GHL IVR workflow itself is still being configured (see GHL Workflow Status)

### Chat System
- ✅ Workspace / Sessions / DMs / Internal (see Chat Architecture above)
- ✅ Workspaces are **company-named** (never a contact person) and carry the **whole team as participants** — new team members join all workspaces automatically (012 trigger + invite-flow fallback), and the Members list shows every client user with their role (no point-of-contact in workspace context; POC remains a session concept)
- ✅ **Portal DM view** — clients see a Direct Messages section beside their workspace chat and can send/receive in 1-on-1 threads
- ✅ Dispatch Bot ticket announcements (DB triggers, centered bot styling) — cards appear **instantly**: trigger-inserted messages are re-broadcast over the shared realtime channel since same-transaction inserts don't reach the creating tab via `postgres_changes`
- ✅ SMS ↔ chat bridge (inbound tag-gated webhook; outbound mirroring for SMS-sourced sessions)
- ✅ Slash commands + icon shortcuts: `/ticket`, `/meet`, `/canned`; auto-expanding input (Shift+Enter for newline)
- ✅ **No in-app calling** — by design; live conversations use Google Meet links, inbound IVR calls log as `call_log` messages
- ✅ Realtime via Supabase (messages, unread badges, notification bell)
- 🔧 Read receipts: `read_at` tracked, unread counts shown — no per-message "seen" UI
- ❌ Typing indicators

### Task Manager
- ✅ Create tasks per department/client; kanban + list views; assignment, priority, due dates
- ✅ Linked tickets and comment threads
- ✅ **Portal task visibility** — clients see a read-only table (title, status, priority, due date, team member) with a status filter; internal comments stay internal

### Notifications
- ✅ Realtime bell + full notifications page (type filters, mark-all-read, click-to-navigate)
- ✅ **Event triggers (DB-level, all creation paths):** `ticket_assigned` (assignee), `ticket_escalated` (department head, owner/admin fallback), `ticket_resolved` (creator, portal link for clients), `new_chat_message` (client messages → team; DMs → team participants only), plus the existing phone-ticket department-head notification
- ✅ **Time-based triggers:** `sla_breach` (assignee + department head), `task_due_soon` (assignee, 24h ahead), `task_overdue` (assignee + department head) — deduped per entity+user, run by Vercel cron every 15 min and on dashboard page loads as backstop
- ❌ Email notifications for in-app events (transactional email exists for invites/onboarding only)

### Settings
- ✅ Two-column layout: General, Team (invite with real emails, roles, removal guards), Departments, Integrations (env status incl. `GHL_FROM_EMAIL`, webhook URLs, live test), Canned Responses, **Audit Log with pagination** (pages of 50, Load more, total count), Checklist Templates

### GHL Integration
- ✅ Inbound SMS webhook — **tag-gated**: only contacts tagged `dispatch-user` reach chat (fail-closed)
- ✅ Inbound call webhook — IVR digit → category, ticket + linked session + `call_log` + notification
- ✅ Outbound SMS from chat (LeadConnector API)
- ✅ **Email sending** (`sendEmail` in `lib/ghl.ts`) — GHL conversations Email API, contact find-or-create by address, used for team invites and client onboarding
- ✅ Contact tagging on client-user add/remove
- ❌ Outbound calling — intentionally removed

## GHL Workflow Status

What's configured in the Loopflo GHL account vs. still pending:

- [x] Private integration token with `conversations/message.write`, `contacts.readonly`, `contacts.write`
- [x] `dispatch-user` tag convention for SMS gating
- [x] Dispatch webhook endpoints live and tested (`/api/webhooks/ghl-sms`, `/api/webhooks/ghl-call`)
- [ ] **Workflow 1 — Inbound SMS**: trigger on customer reply → custom webhook POST to `/api/webhooks/ghl-sms` (draft in GHL, needs the payload mapping below and activation)
- [ ] **Workflow 2 — "Dispatch Call Inbound"**: IVR menu (digits 1–5 → categories), record + transcribe + AI summary, then POST to `/api/webhooks/ghl-call` (in progress)
- [ ] IVR voice prompts recorded and digit mapping verified end-to-end
- [ ] Toll-free number verification (carrier approval pending)
- [ ] `GHL_FROM_EMAIL` verified as a sending address in the location (required for invite/onboarding emails)

Full guides: **[docs/ghl-setup.md](docs/ghl-setup.md)** and **[docs/ivr-setup.md](docs/ivr-setup.md)**.

## Webhook Payloads

Both endpoints accept `POST` with a JSON body (map these field names in the GHL workflow's custom-webhook action):

### `POST /api/webhooks/ghl-sms`

| Field | Required | Description |
| --- | --- | --- |
| `phone` | ✅ | Sender's number, E.164 (`{{contact.phone}}`) |
| `message` | ✅ | The SMS body (`{{message.body}}`) |
| `contactId` | recommended | GHL contact id — skips the phone lookup for the tag check (`{{contact.id}}`) |

Responses: `200 {received: true}` (also when unmatched/untagged — fail-closed, nothing posted), `400` on missing fields.

### `POST /api/webhooks/ghl-call`

| Field | Required | Description |
| --- | --- | --- |
| `caller_phone` | ✅ | Caller's number, E.164 |
| `ivr_selection` | recommended | IVR digit `1–5` → seo / ghl / software / billing / general (defaults to general) |
| `recording_url` | optional | Call recording URL (rendered as a playable `call_log` message) |
| `transcript` | optional | Full transcription (first 500 chars become the description fallback) |
| `ai_summary` | optional | GHL's AI summary → ticket description |
| `duration` | optional | Call length in seconds |
| `timestamp` | optional | Call time, ISO 8601 |

Creates a phone-sourced ticket (priority medium, SLA 24h) + a linked session with a `call_log` message, and notifies the matched department head. Unmatched callers return `200 {received: true, matched: false}`.

> Both webhooks are currently **unsigned** — GHL custom webhooks don't sign requests. Adding a shared-secret query param is on the roadmap (P2).

## Environment Variables

| Variable | Required | Description |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | ✅ | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✅ | Public anon key (RLS enforces access) |
| `NEXT_PUBLIC_APP_URL` | ✅ | `https://dispatch.loopflo.io` — auth redirects + email links |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | Server-only; webhooks, invites, cron, admin APIs |
| `GHL_API_KEY` | Optional* | LeadConnector private-integration token |
| `GHL_LOCATION_ID` | Optional* | GHL sub-account (location) id |
| `GHL_PHONE_NUMBER` | Optional* | Dispatch number SMS goes out from, E.164 |
| `GHL_FROM_EMAIL` | Optional* | Verified sending address for invite/onboarding emails |
| `CRON_SECRET` | Optional | If set, `/api/cron/notifications` requires it as a Bearer token (Vercel Cron sends it automatically) |

\* The app runs without GHL vars, but SMS bridging, tagging, email sending, and the inbound webhooks' tag check degrade or fail closed. Copy `.env.example` → `.env.local` to start.

## Database Migrations (`supabase/migrations/`, run in order)

| # | File | What it does |
| --- | --- | --- |
| 001 | `initial_schema` | All core tables, enums, RLS policies + helper functions, indexes, `updated_at` + new-user triggers |
| 002 | `documents_comments_storage` | `client_documents`, `task_comments`, public `uploads` storage bucket |
| 003 | `client_users` | Multi-user-per-client roster, `users.ghl_contact_id`, `current_client_id()` via roster |
| 004 | `checklist_templates_and_roles` | Templates table + auto-apply trigger, client roles → 4-value enum, self-service roster RLS |
| 005 | `client_lifecycle` | Default chat thread on client creation, `clients.status` (active/inactive) |
| 006 | `remove_client_department` | Drops `clients.assigned_department_id` (routing is per ticket) |
| 007 | `internal_chat` | Nullable `chat_threads.client_id`, thread title/participants/creator |
| 008 | `chat_restructure` | Workspace vs sessions split, `bot` sender type, `linked_ticket_id`, Dispatch Bot triggers, session auto-close |
| 009 | `call_log` | `call_log` message type for call records |
| 010 | `dm_poc_sessions` | `point_of_contact_id` on threads, session auto-create for web tickets, DM threads with participant-scoped RLS |
| 011 | `notifications_and_sla` | Notification triggers (assigned/escalated/resolved/chat), time-based checks fn (SLA breach, task due/overdue) with entity dedupe, SLA before-insert backstop, client read policies for tasks + team names |
| 012 | `workspace_membership` | Workspace threads titled with `company_name`, whole team as `participant_ids` (create + backfill), triggers to add new team members to all workspaces and remove departed ones |

## Known Issues

- **Migrations 011–012 must be applied** before the notification triggers, portal task visibility, DM name resolution, and workspace auto-membership work in production — earlier migrations don't include those policies/triggers.
- **One active SMS session per client** — inbound SMS lands in the client's most recent active session regardless of topic; a new topic only gets its own session after the previous one is resolved.
- **Local env is partially configured** — `.env.local` has Supabase URL/anon key only; `SUPABASE_SERVICE_ROLE_KEY` and the GHL vars are unset locally, so webhooks, invites, emails, and the reset script only work where those are configured (e.g. Vercel).
- **`new_chat_message` notifies the whole team** — every non-client user is notified of client messages in workspace/session threads; fine at current team size, will need scoping (department/assignee) as the team grows.

## Roadmap

Ordered by what unblocks the most:

1. **P1 — Phone support live**: finish GHL Workflows 1 & 2 (SMS + IVR call), record IVR prompts, complete toll-free verification, verify `GHL_FROM_EMAIL`. The app side is done; this is GHL configuration.
2. **P2 — Webhook authentication**: shared-secret query param on both GHL webhooks (they're unsigned today).
3. **P3 — Email for in-app notifications**: reuse `sendEmail` to mirror high-signal notifications (SLA breach, escalation) to email; digest or per-event settings.
4. **P4 — Chat polish**: per-message read receipts UI, typing indicators, scoped `new_chat_message` routing, infinite scroll for long histories.
5. **P5 — Platform**: mobile audit for chat + kanban, department dashboards (per-dept rollups), end-to-end test suite.

## Local Development

```bash
git clone git@github.com:mohammadabdullahkhurram/Dispatch.git
cd dispatch
npm install

cp .env.example .env.local   # fill in Supabase (+ GHL) values

# Apply migrations 001–012, either:
npx supabase login && npx supabase link --project-ref <your-ref>
npx supabase db push
# …or paste each file from supabase/migrations/ into the Studio SQL editor in order.

npm run dev                  # http://localhost:3000
```

Also required once per Supabase project: enable **Realtime** replication on `chat_messages` and `notifications`, and add `<your-app-url>/reset-password` to **Auth → URL Configuration → Redirect URLs**. `npm run build` and `npm run lint` must pass before pushing.
