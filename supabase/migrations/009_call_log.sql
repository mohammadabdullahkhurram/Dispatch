-- ============================================================
-- Dispatch — call log messages
-- Calls (initiated from Dispatch via the GHL dialer, or logged
-- back by the GHL Call Status workflow webhook) appear in chat
-- as call_log messages carrying status/duration/recording.
-- ============================================================

alter type message_type add value if not exists 'call_log';
