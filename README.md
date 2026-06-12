# Dispatch

**Bluejaypro's internal operations platform** — client management, ticketing, chat (web + SMS + calls via GoHighLevel), tasks, and notifications in one dark-mode workspace. Clients get a self-service portal; the agency team gets a full operations dashboard.

**Live:** https://dispatch.loopflo.io

## Tech Stack

| Layer | Technology |
| --- | --- |
| Framework | Next.js **16.2.9** (App Router, Turbopack) + React 19 + TypeScript |
| Styling | Tailwind CSS v4, shadcn/ui (Radix, Nova preset), lucide-react |
| Backend | Supabase — Postgres, Auth, Storage, Realtime, RLS |
| Telephony/SMS | GoHighLevel (LeadConnector API + workflow webhooks) |
| Hosting | Vercel |

> **Note:** this Next.js version renamed `middleware.ts` to **`proxy.ts`** — route protection lives there.

## Architecture

```
dispatch/
├── proxy.ts                     # Auth + role-based routing (Next 16's middleware)
├── app/
│   ├── (auth)/
│   │   ├── login/               # Split-screen login + forgot password
│   │   └── reset-password/      # Recovery-token password reset
│   ├── (client)/portal/         # Client portal (role-gated nav)
│   │   ├── page.tsx             # Overview: stats, onboarding, recent tickets
│   │   ├── tickets/             # Submit + track tickets (SLA countdown)
│   │   ├── chat/                # Persistent workspace chat with the team
│   │   └── profile/             # Company info, My Account, Team, Checklist,
│   │                            #   Documents, Branding (tab-gated by role)
│   ├── (team)/dashboard/        # Team workspace
│   │   ├── page.tsx             # Stats, audit feed, my tasks, quick links
│   │   ├── clients/             # Searchable list + 8-tab client profile
│   │   ├── tickets/             # Kanban (Open/In Progress/Escalated/Resolved)
│   │   ├── tasks/               # Kanban/list, filters, comments
│   │   ├── chat/                # Workspace / Sessions / Internal chat
│   │   ├── notifications/       # Realtime list, filters, mark-all-read
│   │   └── settings/            # 6 tabs + profile + checklist-templates pages
│   └── api/
│       ├── webhooks/ghl-sms/      # Inbound SMS (tag-gated) → session chat
│       ├── webhooks/ghl-call/     # Completed IVR call → ticket + notification
│       ├── webhooks/ghl-call-log/ # Call Status workflow → call_log message
│       ├── chat/send-sms/         # Mirror team reply to SMS via GHL
│       ├── calls/initiate/        # Resolve GHL contact, open dialer deep link
│       ├── clients/[id]/users/    # Add/remove client users (+ GHL tagging)
│       ├── integrations/ghl-test/ # Live GHL credential check
│       └── team/[userId]/         # Remove internal team member
├── components/                  # ui/ (shadcn), dashboard/, portal/, chat/, shared
├── lib/                         # supabase clients (browser/server/admin/proxy),
│                                #   ghl.ts, phone.ts, audit.ts, types.ts, format.ts
├── supabase/migrations/         # 001–009 (see Migrations)
└── docs/                        # ghl-setup.md, ivr-setup.md
```

**Route groups:** `(auth)` is public; `(client)` and `(team)` are fenced by `proxy.ts`, which refreshes the Supabase session, reads the user's role, and keeps clients in `/portal` and team members in `/dashboard`.

**Database (16 tables):** `users` (mirrors `auth.users`, role enum), `departments`, `clients` (+ status, branding jsonb), `client_users` (multi-user roster, 4 roles), `client_checklist_items`, `checklist_templates`, `client_documents`, `tickets` (+ SLA, transcription, AI summary), `ticket_activity_log`, `tasks`, `task_comments`, `chat_threads` (workspace/session/internal), `chat_messages` (text/ticket_card/recording/meet_link/call_log), `notifications`, `audit_logs`, `canned_responses`, `app_settings`. Everything is under RLS: team-wide access via `is_team_member()`, client access scoped through `current_client_id()` (resolves the `client_users` link with a legacy email fallback). DB triggers handle: new-user profile creation, new-client workspace thread + checklist application, Dispatch Bot ticket announcements, linked-session auto-close, and `updated_at` stamping.

## Features

### Authentication & Roles
- ✅ Login with role-based redirect (clients → `/portal`, team → `/dashboard`)
- ✅ Team roles: `agency_owner`, `agency_admin`, `agency_manager`, `department_head`, `department_member`; client roles on `client_users`: `account_owner`, `account_admin`, `office_member`, `contractor`
- ✅ Role-gated portal: office members/contractors see tickets + chat only, no billing-category visibility, no team management
- ✅ Password reset flow (forgot-password email → `/reset-password`)
- ✅ Profile settings (avatar upload, name, phone, current-password-verified password change) for team and clients
- ✅ Inactive-client lockout at login and in the portal layout

### Client Management
- ✅ Create clients (role-gated dialog; auto-applies checklist templates + creates workspace chat via triggers)
- 🔧 Edit clients — clients edit their own company info in the portal; no team-side edit form yet
- ✅ Delete clients (owner/admin, type-`Delete` confirmation, cascade, audit-logged)
- ✅ Client profile with **8 tabs**: Overview, Team, Tickets, Tasks, Chat History, Documents, Checklist, Branding
- ✅ Active/inactive status (closes sessions, hides from default list, blocks portal access; reactivation restores)
- ✅ Multi-user per client with the four roles; SMS sender matching by user phone
- ✅ Client self-service team management (account_owner/account_admin via portal Team tab)
- ✅ Checklist templates: manager-managed CRUD at `/dashboard/settings/checklist-templates`, "Apply to Clients" (all or selected, dedup), auto-applied to new clients
- ✅ Google Drive folder link + per-client document links (`client_documents`)
- 🔧 Branding: logo upload works; brand colors/fonts display from jsonb but have no edit UI yet

### Ticket System
- ✅ Web submission from the portal (category, priority, file upload to storage)
- ✅ Team kanban board with department/category/priority/assignee filters + create dialog
- ✅ Categories: SEO, GHL, Software, Billing, General
- ✅ Priority → SLA deadlines: **urgent 4h, high 8h, medium 24h, low 48h**, live countdown, red when breached
- ✅ Assign/assign-to-me, escalate, status changes, resolve with notes
- ✅ Activity log on every ticket (plus `audit_logs` for everything)
- ✅ Tickets from chat (`/ticket` command and header quick-action dialog; sessions link to the ticket and auto-close on resolve)
- 🔧 Voice/phone tickets: webhook fully built (`/api/webhooks/ghl-call`); the GHL IVR workflow itself is still being configured
- 🔧 AI summary on phone tickets: Dispatch saves GHL's `ai_summary` (transcript-excerpt fallback); GHL's AI agent side not fully wired

### Chat System
- ✅ **Workspace chat** — persistent, one per client, never archives, web-only
- ✅ **Support sessions** — SMS/call/team-originated, issue-categorized, active → closed, optional linked ticket
- ✅ **Dispatch Bot** — DB triggers post "New ticket opened/Ticket resolved" cards (distinct bot styling) into the workspace
- ✅ SMS ↔ chat bridge: inbound via webhook (sender matched to roster member), outbound mirroring based on the most recent inbound message's source
- ✅ Slash commands + immediate icon shortcuts: `/ticket`, `/meet`, `/canned`, `/call`
- ✅ Realtime via Supabase (messages, unread badges, notification bell)
- 🔧 Read receipts: `read_at` tracked, unread counts shown, marked read on open — no per-message "seen" UI
- ❌ Typing indicators
- ✅ Canned responses (CRUD in settings, picker in chat)
- ✅ Internal team chat (direct/group threads with participant reuse)
- ✅ Archived sessions view (read-only until client reactivation)
- ✅ Click-to-call from chat — GHL has **no remote-dial API**, so the Call button posts a `call_log`, opens the contact in GHL's dialer (calls go out from the Dispatch number), shows a floating in-call widget, and the Call Status webhook logs status/duration/recording back into the session

### Task Manager
- ✅ Create tasks per department/client (modal with all fields)
- ✅ Kanban (To Do/In Progress/Done) and list views
- ✅ Assignment, priority, due dates (overdue highlighting)
- ✅ Linked tickets (chip on card + detail)
- ✅ Comment threads in the task slide-over
- ❌ Client-visible task status on the portal

### Notifications
- ✅ Realtime bell with unread badge (team top bar)
- ✅ Full notifications page: type filters, mark-all-read, click-to-navigate, realtime inserts
- 🔧 Triggers: currently only new phone tickets notify the matched department head — assigned/escalated/resolved, chat, task-due, and SLA-breach triggers are not generated yet
- ❌ Email notifications

### Settings
- ✅ General (agency name, logo URL, timezone → `app_settings`)
- 🔧 Team management: role/department editing ✅, remove member ✅ (guards: no self-removal, last-owner protected), invite **records intent only — no email sent**
- ✅ Departments (CRUD, assign heads)
- ✅ GHL Integrations (env-var status badges, webhook URLs with copy, live test connection)
- ✅ Canned Responses (per-department CRUD)
- ✅ Checklist Templates (linked page)
- ✅ Audit Log (searchable, last 100)

### GHL Integration
- ✅ Inbound SMS webhook (`/api/webhooks/ghl-sms`) — **tag-gated**: only contacts tagged `dispatch-user` reach chat (fail-closed)
- ✅ Inbound call webhook (`/api/webhooks/ghl-call`) — IVR digit → category, ticket + session + notification
- ✅ Call log webhook (`/api/webhooks/ghl-call-log`) — both directions, duration + recording
- ✅ Outbound SMS from chat (LeadConnector API, contact-id reuse + phone lookup)
- ✅ Contact tagging on client-user add/remove
- ✅ Outbound calling via dialer deep link (see Chat above)
- 🔧 IVR workflow (Workflow 1) — draft in GHL
- 🔧 Transcript/AI summary workflow (Workflow 2, "Dispatch Call Inbound") — in progress in GHL

## Environment Variables

| Variable | Required | Description |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | ✅ | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✅ | Public anon key (RLS enforces access) |
| `NEXT_PUBLIC_APP_URL` | ✅ | `https://dispatch.loopflo.io` — auth redirect base (password reset) |
| `SUPABASE_SERVICE_ROLE_KEY` | ✅ | Server-only; webhooks + admin APIs (user creation/removal) bypass RLS |
| `GHL_API_KEY` | Optional* | LeadConnector private-integration token — scopes: `conversations/message.write`, `contacts.readonly`, `contacts.write` |
| `GHL_LOCATION_ID` | Optional* | GHL sub-account (location) id |
| `GHL_PHONE_NUMBER` | Optional* | Dispatch number SMS/calls go out from, E.164 |

\* The app runs without GHL vars, but SMS bridging, tagging, calling, and the inbound webhooks' tag check degrade or fail closed. Copy `.env.example` → `.env.local` to start.

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

## GHL Setup

In GHL you need: a private integration token (scopes above), three workflow webhooks pointed at `https://dispatch.loopflo.io/api/webhooks/...` (inbound SMS, completed IVR call, call status), the `dispatch-user` tag convention, and the IVR menu mapping digits 1–5 to ticket categories.

Full guides: **[docs/ghl-setup.md](docs/ghl-setup.md)** (env vars, webhook payload mappings, SMS mirroring, calling) and **[docs/ivr-setup.md](docs/ivr-setup.md)** (IVR menu, post-call payload, test calls).

## What's Left / Known Gaps

- **Email notifications** — no email layer yet (Resend or Supabase SMTP); notification triggers beyond phone-ticket→department-head also need generating
- **Team invite emails** — invites are recorded but not sent; needs `auth.admin.inviteUserByEmail` + SMTP
- **Client-side task visibility** — tasks are team-only today
- **Brand kit editing** — colors/fonts are display-only jsonb
- **Team-side client editing** — no edit form on the dashboard client profile
- **GHL Workflows 1 & 2** — IVR and transcript/AI-summary workflows still being finished in GHL
- **Toll-free number verification** — pending with GHL/carrier
- **Webhook authentication** — GHL custom webhooks are unsigned; add a shared-secret query param (noted in docs)
- **Mobile responsiveness audit** — sidebar/sheets are responsive; chat and kanban need a pass
- **Department dashboards** — no per-department rollup views
- **End-to-end testing** — no automated test suite

## Local Development

```bash
git clone git@github.com:mohammadabdullahkhurram/Dispatch.git
cd dispatch
npm install

cp .env.example .env.local   # fill in Supabase (+ GHL) values

# Apply migrations 001–009, either:
npx supabase login && npx supabase link --project-ref <your-ref>
npx supabase db push
# …or paste each file from supabase/migrations/ into the Studio SQL editor in order.

npm run dev                  # http://localhost:3000
```

Also required once per Supabase project: enable **Realtime** replication on `chat_messages` and `notifications`, and add `<your-app-url>/reset-password` to **Auth → URL Configuration → Redirect URLs**. `npm run build` and `npm run lint` must pass before pushing.
