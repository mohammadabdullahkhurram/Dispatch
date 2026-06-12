-- ============================================================
-- Dispatch — reset test data
--
-- Deletes all operational/test rows while PRESERVING:
--   users, departments, checklist_templates, canned_responses,
--   app_settings
--
-- Run in the Supabase Studio SQL editor (or psql). Order matters
-- only for clarity — FKs cascade/null appropriately either way.
-- Note: there is no call_logs table; call records live in
-- chat_messages (message_type 'call_log') and are removed with it.
-- ============================================================

begin;

delete from chat_messages;
delete from chat_threads;
delete from ticket_activity_log;
delete from task_comments;
delete from tasks;
delete from tickets;
delete from notifications;
delete from audit_logs;
delete from client_checklist_items;
delete from client_documents;
delete from client_users;
delete from clients;

commit;

-- ------------------------------------------------------------
-- Defensive re-assert: the auto-workspace-chat trigger survives
-- row deletes, but re-create it so a fresh environment is
-- guaranteed to give every new client a workspace thread.
-- ------------------------------------------------------------
create or replace function create_default_chat_thread()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into chat_threads (client_id, status, category)
  values (new.id, 'active', 'workspace');
  return new;
end;
$$;

drop trigger if exists clients_create_default_chat_thread on clients;
create trigger clients_create_default_chat_thread
  after insert on clients
  for each row execute function create_default_chat_thread();
