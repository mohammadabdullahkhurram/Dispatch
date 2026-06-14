-- ============================================================
-- Dispatch — store the Twilio call SID on phone tickets for
-- reference (passed through GHL custom data {{...call_sid}}).
-- ============================================================

alter table tickets add column if not exists call_sid text;

create index if not exists tickets_call_sid_idx on tickets (call_sid);
