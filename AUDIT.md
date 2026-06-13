# Dispatch — Codebase Audit

**Date:** 2026-06-13
**Scope:** Full read of `app/`, `components/`, `lib/`, `supabase/migrations/`, plus a live probe of the production Supabase instance (migration footprint, row counts, data state).
**Build status:** `npm run build` ✅ exit 0 · `npm run lint` ✅ 0 warnings.

---

## 1. Executive Summary

Dispatch is in good overall shape: it compiles cleanly with **zero TypeScript `any`**, no `@ts-ignore`, no TODO/FIXME markers, properly authenticated API routes, and no client-side exposure of the service-role key. All 13 migrations are applied in production. Core features — auth, client management, tickets (3 creation paths with SLA), tasks, the new WhatsApp/Slack chat model, notifications, settings, brand kit, portal tasks/DMs, audit pagination — are implemented end to end.

Two things hold it back from "fully done":

1. **One critical regression (fixed in migration 014, pending apply):** migration 013 added `chat_threads.chat_type` with a default of `'session'`, but the workspace-creation triggers never set `chat_type`, so **every new client's workspace thread was mistyped as a session** — invisible to the portal and shown in the wrong sidebar section. Migration 014 fixes the triggers; the one existing bad row has already been repaired in the live DB.
2. **Client onboarding email is blocked outside the code** — the GHL Private Integration Token lacks the `conversations/message.write` scope, so sends return `401 "not authorized for this scope"`. The code path is correct; this is a GHL token-configuration fix.

Temporary debug logging (`[ghl-email][debug]`, `CLIENT CREATION STARTED/FINISHED`) is still in place, deliberately, until the email issue is confirmed resolved.

---

## 2. Feature Status

Legend: ✅ works end to end · 🔧 partial / blocked externally · ❌ missing

| Feature | Status | Notes |
| --- | :-: | --- |
| Login + role-based redirect | ✅ | `proxy.ts` routes by role; clients→`/portal`, team→`/dashboard` |
| Logout | ✅ | Sidebar sign-out |
| Password reset | ✅ | Supabase email → `/reset-password` |
| Inactive-client lockout | ✅ | At login + portal layout |
| Create client | ✅ | `POST /api/clients` — row + account_owner + GHL tag + email attempt |
| Edit / delete client | ✅ | Type-"Delete" confirm on delete |
| Active/inactive toggle | ✅ | Manager+; closes sessions, blocks portal |
| **Client onboarding email** | 🔧 | Code correct; **GHL token missing `conversations/message.write` scope → 401**. See Bug #2 |
| Checklist templates (CRUD + apply + auto-apply) | ✅ | Trigger applies on client insert |
| Ticket: portal submission | ✅ | Sets `sla_deadline` |
| Ticket: kanban dialog | ✅ | Sets `sla_deadline` |
| Ticket: chat (`/ticket` + icon, full form) | ✅ | Sets `sla_deadline`; bot card broadcast for instant display |
| **SLA on all paths** | ✅ | All 4 insert sites + a `before insert` backstop trigger (011). Values: urgent 2h / high 8h / medium 24h / low 72h |
| Assign / escalate / resolve | ✅ | With activity log |
| Notification: ticket_assigned | ✅ | DB trigger (011) |
| Notification: ticket_escalated | ✅ | DB trigger → dept head, owner/admin fallback |
| Notification: ticket_resolved | ✅ | DB trigger → creator (portal link for clients) |
| Notification: new_chat_message | ✅ | DB trigger; ⚠️ notifies **all** team for non-DM (see Bug #5) |
| Notification: sla_breach | ✅ | `run_time_based_notifications()` (cron + page-load) |
| Notification: task_due_soon / task_overdue | ✅ | Same time-based function |
| Chat: workspace / sessions / internal | ✅ | Three-section sidebar |
| Chat: DMs + groups (workspace & internal) | ✅ | Create, rename, member mgmt, presence |
| **Chat: new-client workspace thread** | 🔧 | **Mistyped as session until migration 014 applied.** See Bug #1 |
| Chat: double-confirm delete | ✅ | Type-"Delete"; workspaces hard-protected |
| Chat: presence dots | ✅ | `last_seen` heartbeat, online = <5 min |
| Migration 013 (chat restructure) | ✅ | Applied in production |
| SMS bridge (inbound webhook / outbound mirror) | 🔧 | Code complete; depends on the GHL workflow going live |
| Task manager (create/assign/complete/comments) | ✅ | |
| Settings: General/Team/Departments/Integrations/Canned/Audit | ✅ | Two-column layout |
| Settings: Team invite (real email) | 🔧 | Creates account + adds to workspaces; email send shares Bug #2 |
| Brand kit editing (colors + fonts save) | ✅ | `brand-kit-editor.tsx` → `clients.update({brand_colors, brand_fonts})` |
| Portal tasks page | ✅ | Read-only, status filter, RLS-scoped |
| Portal DM + group view | ✅ | + new-DM picker, presence |
| Audit log pagination | ✅ | Pages of 50, Load more, total count |

---

## 3. Code Quality

**Strengths:** no `any`/`as any`, no `@ts-ignore`/`@ts-expect-error` (only 3 benign `eslint-disable`: two `no-img-element`, one unused-prop on a back-compat shim), no TODO/FIXME/HACK markers, clean build + lint, error/loading boundaries on both route groups.

| # | Issue | Location | Priority |
| --- | --- | --- | :-: |
| Q1 | **Temporary debug logging in production** — `[ghl-email][debug]` (URL, masked key, payload, full response) and `CLIENT CREATION STARTED/FINISHED` + `[clients][debug]` | `lib/ghl.ts`, `app/api/clients/route.ts` | Med — keep until email confirmed, then strip |
| Q2 | **`chat-workspace.tsx` is 1,892 lines** — sidebar, 4 creation flows, group mgmt, delete, message panel, and ~5 sub-components in one file | `components/dashboard/chat-workspace.tsx` | Med — split into `chat-sidebar`, `new-chat-dialog`, `group-manage-dialog`, `chat-panel` |
| Q3 | Other large components: `settings-tabs.tsx` (968), `tickets-board.tsx` (755), `tasks-view.tsx` (724) | — | Low |
| Q4 | `NewClientDialog` keeps an unused `currentUserId` prop (back-compat shim with an eslint-disable) | `components/dashboard/new-client-dialog.tsx` | Low — drop the prop + call-site arg |
| Q5 | API routes return proper `NextResponse.json({error}, {status})` consistently; no gaps found | all `app/api/**` | — (pass) |

---

## 4. Security

| # | Finding | Severity | Detail |
| --- | --- | :-: | --- |
| S1 | **`/api/webhooks/ghl-call` is unauthenticated and unsigned** | Med | No auth, no shared-secret, no signature check. Anyone who learns the URL can POST a fake call → creates a ticket + session + notification. `ghl-sms` at least fails closed via the `dispatch-user` tag check; the call webhook has no equivalent gate. **Fix:** add a `?secret=` shared token (env `GHL_WEBHOOK_SECRET`) compared in both webhook routes. |
| S2 | Service-role key exposure | None (pass) | `createAdminClient` / `SUPABASE_SERVICE_ROLE_KEY` used only in `app/api/**` route handlers and `lib/supabase/admin.ts`. No `"use client"` file imports it. |
| S3 | API route auth | None (pass) | Every non-webhook route checks `auth.getUser()` and role; `team/*` and `clients/*` gate on team/admin roles; `cron/notifications` honors `CRON_SECRET`. |
| S4 | RLS — Audit Log | None (pass) | DB-enforced owner/admin-only (`is_agency_admin()`), not just UI. |
| S5 | RLS — broadened in 013 | Low | `can_access_thread` correctly participant-scopes dm/group/internal_*; agency owners/admins retain oversight of **client-facing** dm/group (intentional). Internal DMs/groups are participant-only. Reviewed — not over-permissive. |
| S6 | Client onboarding temp passwords | Low | 12-char `randomBytes(9).base64url`, `email_confirm: true`. Fine; ensure the onboarding email (once unblocked) is the only place they're surfaced. |

---

## 5. Known Bugs

### Bug #1 — New-client workspace thread mistyped as `session` (CRITICAL, fix shipped in 014)
- **Where:** `create_default_chat_thread()` and `get_workspace_thread()` (migration 012), and `create_session_for_web_ticket()` (010).
- **Symptom:** A client created after migration 013 gets a chat thread with `category='workspace'` but `chat_type='session'`. It appears under **Sessions** in the team sidebar, and the portal (`.eq("chat_type","workspace")`) can't find it — so the portal silently creates a *second* workspace thread on first load.
- **Cause:** Migration 013 added `chat_type` with `DEFAULT 'session'`. The thread-inserting trigger functions set `category` but never `chat_type`, so the default wins.
- **Evidence:** Live probe — the single client "Bluejaypro" (created 14:05 today) had exactly this: `{chat_type:"session", category:"workspace"}`.
- **Fix:** Migration **014** updates all three functions to set `chat_type` (+ `is_deletable=false` for workspaces) and repairs mislabeled rows / de-dupes. The one existing bad row was already corrected in the live DB during this audit; **the 014 function DDL still needs to be applied** so future clients are correct.

### Bug #2 — Onboarding / invite email returns 401 "not authorized for this scope" (HIGH, external)
- **Where:** `sendEmail` in `lib/ghl.ts`, called from `app/api/clients/route.ts` and `app/api/team/invite/route.ts`.
- **Symptom:** Client/invite emails never arrive; the route returns `emailError` and a warning.
- **Cause:** The GHL Private Integration Token (`GHL_API_KEY`) was created without the `conversations/message.write` scope. The endpoint, payload, and headers are correct (verified against LeadConnector docs). A token's scopes are fixed at creation.
- **Fix:** Create a new GHL Private Integration Token with `conversations/message.write` + `contacts.readonly` + `contacts.write`, update `GHL_API_KEY`, and confirm the location has a verified email-sending domain for `GHL_FROM_EMAIL`. No code change needed (the scope-detection error message already explains this).

### Bug #3 — Vercel deploy was failing on a sub-daily cron (RESOLVED)
- **Status:** Fixed in `0cbd424`. `vercel.json` cron was `*/15 * * * *`, which the Hobby plan rejects at deploy time; changed to daily. Documented here for completeness because it masked Bugs #1/#2 for several commits.

### Bug #4 — Orphan/empty test data (INFO, not a code bug)
- The production DB is a near-empty test instance: 2 users, 1 client, 0 tickets/tasks/messages. Nothing to fix; noted so the empty state isn't mistaken for a query bug.

### Bug #5 — `new_chat_message` notifies the entire team (LOW)
- **Where:** `notify_team_of_client_message()` (migration 011).
- **Symptom:** Every non-client user is notified when a client posts in a workspace/session thread (DMs are correctly scoped to participants).
- **Cause:** Intentional simplicity at current team size; no department/assignee scoping.
- **Fix:** Scope to the client's department or assigned members as the team grows.

---

## 6. Performance

| # | Finding | Severity | Detail |
| --- | --- | :-: | --- |
| P1 | **No pagination on team lists** — Clients, Tickets, Tasks fetch all rows; Notifications caps at 100 with no "load more" | Med (at scale) | Fine now (tiny dataset); add `.range()` pagination before data grows. Audit log already paginates. |
| P2 | Chat directory fetch loads **all** users + all `client_users` on the team chat page | Low | Needed to resolve DM/group names, avatars, presence. Bulk (no N+1), but would want scoping at large user counts. |
| P3 | Team-invite route updates each workspace thread in a sequential loop | Low | Bounded by client count; a single `update … where category='workspace'` (as the 012 trigger does) would be cheaper, but the trigger already covers the common path. |
| P4 | No N+1 query patterns found in render paths | — (pass) | Joins use Supabase nested selects; per-thread message loads are on-demand. |

---

## 7. Recommended Fixes — Priority Order

1. **Apply migration 014** (function/trigger DDL) in Supabase — without it, every new client's workspace is still mistyped. *(Bug #1)*
2. **Recreate the GHL token** with `conversations/message.write` and update `GHL_API_KEY` — unblocks onboarding + invite emails. *(Bug #2)*
3. **Add a webhook shared-secret** (`GHL_WEBHOOK_SECRET`, `?secret=`) to both webhook routes. *(S1)*
4. **Strip the temporary debug logging** once an email send succeeds. *(Q1)*
5. **Split `chat-workspace.tsx`** into sidebar / dialogs / panel modules. *(Q2)*
6. **Add pagination** to Clients / Tickets / Tasks / Notifications. *(P1)*
7. **Scope `new_chat_message`** notifications by department/assignee. *(Bug #5)*

---

## 8. Migration Status (verified against the live database)

All confirmed **APPLIED** by probing for the columns/functions each migration creates.

| # | File | Applied? | Probe |
| --- | --- | :-: | --- |
| 001 | `initial_schema` | ✅ | core tables present |
| 002 | `documents_comments_storage` | ✅ | `uploads` bucket used by storage calls |
| 003 | `client_users` | ✅ | `users.ghl_contact_id` |
| 004 | `checklist_templates_and_roles` | ✅ | `checklist_templates` table |
| 005 | `client_lifecycle` | ✅ | `clients.status` |
| 006 | `remove_client_department` | ✅ | (column dropped) |
| 007 | `internal_chat` | ✅ | `chat_threads.participant_ids` |
| 008 | `chat_restructure` | ✅ | `chat_threads.linked_ticket_id` |
| 009 | `call_log` | ✅ | `chat_messages.message_type` |
| 010 | `dm_poc_sessions` | ✅ | `chat_threads.point_of_contact_id` |
| 011 | `notifications_and_sla` | ✅ | `notifications.entity_id`, `run_time_based_notifications()` |
| 012 | `workspace_membership` | ✅ | `team_member_ids()` |
| 013 | `chat_groupchats` | ✅ | `chat_threads.chat_type`, `group_name`, `is_deletable`, `users.last_seen` |
| **014** | `fix_thread_chat_type` | ⏳ **PENDING** | function DDL must be applied; one data row already repaired manually |
