-- ============================================================
-- Dispatch — fix: thread-creating triggers must set chat_type.
--
-- Migration 013 added chat_threads.chat_type with a DEFAULT of
-- 'session'. The workspace-creation trigger (012) and the
-- find-or-create workspace lookup insert rows WITHOUT chat_type, so
-- every new client's workspace thread was mistyped as 'session' —
-- it showed in the Sessions section instead of Workspace, and the
-- portal (which queries chat_type='workspace') couldn't find it.
--
-- This updates those functions to set chat_type + is_deletable, and
-- repairs existing mislabeled rows.
-- ============================================================

-- New clients get a correctly-typed, undeletable workspace thread.
create or replace function create_default_chat_thread()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into chat_threads
    (client_id, status, category, chat_type, is_deletable, title, participant_ids)
  values
    (new.id, 'active', 'workspace', 'workspace', false,
     new.company_name, team_member_ids());
  return new;
end;
$$;

-- Find-or-create workspace lookup (used by the Dispatch Bot trigger).
create or replace function get_workspace_thread(p_client_id uuid)
returns uuid
language plpgsql
security definer set search_path = public
as $$
declare
  tid uuid;
begin
  select id into tid
  from chat_threads
  where client_id = p_client_id and chat_type = 'workspace'
  order by created_at
  limit 1;

  if tid is null then
    insert into chat_threads
      (client_id, status, category, chat_type, is_deletable, title, participant_ids)
    select p_client_id, 'active', 'workspace', 'workspace', false,
           c.company_name, team_member_ids()
    from clients c where c.id = p_client_id
    returning id into tid;
  end if;

  return tid;
end;
$$;

-- Web-ticket sessions: be explicit rather than relying on the default.
create or replace function create_session_for_web_ticket()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if new.client_id is not null and new.source = 'web' then
    insert into chat_threads
      (client_id, status, category, chat_type, linked_ticket_id,
       point_of_contact_id, created_by, last_message_at)
    values
      (new.client_id, 'active', new.category::text, 'session', new.id,
       new.created_by, new.created_by, now());
  end if;
  return new;
end;
$$;

-- ------------------------------------------------------------
-- Repair rows created between 013 and this fix: a thread whose
-- legacy category is 'workspace' but was mistyped 'session'.
-- ------------------------------------------------------------
update chat_threads
set chat_type = 'workspace', is_deletable = false
where category = 'workspace' and chat_type <> 'workspace';

-- Collapse any duplicate workspaces a mistyped portal load may have
-- created (keep the earliest per client; the portal made a 2nd when
-- it couldn't see the mistyped one). Mark dupes deletable first so the
-- is_deletable guard trigger (013) doesn't block the cleanup.
update chat_threads
set is_deletable = true
where id in (
  select id from (
    select id, row_number() over (partition by client_id order by created_at) as rn
    from chat_threads
    where chat_type = 'workspace'
  ) r where rn > 1
);

-- The marked dupes are now the only deletable workspaces; remove them.
delete from chat_threads
where chat_type = 'workspace' and is_deletable = true;
