-- ============================================================
-- Dispatch — chat restructure: Workspace vs Support Sessions
--
-- Workspace: one persistent thread per client (category
-- 'workspace', always active, web-only, Dispatch Bot posts
-- ticket lifecycle events here).
-- Sessions: issue-scoped threads (category = ticket category),
-- active -> closed, mirror to SMS. Reuses chat_threads.status
-- for the session lifecycle (no separate session_status).
-- ============================================================

-- Dispatch Bot messages: sender_type 'bot' with null sender_id.
-- (A real bot row in users would require inserting into
-- auth.users, which the users.id FK demands — avoided.)
alter type sender_type add value if not exists 'bot';

-- Sessions created from calls (or /ticket) link to their ticket
-- so they auto-close on resolution.
alter table chat_threads
  add column linked_ticket_id uuid references tickets (id) on delete set null;

create index chat_threads_linked_ticket_id_idx
  on chat_threads (linked_ticket_id);

-- ------------------------------------------------------------
-- Repurpose existing threads: promote the OLDEST general thread
-- per client to the workspace (longest history preserved);
-- remaining general threads stay as sessions.
-- ------------------------------------------------------------
with oldest as (
  select distinct on (client_id) id
  from chat_threads
  where client_id is not null
    and lower(coalesce(category, 'general')) = 'general'
  order by client_id, created_at asc
)
update chat_threads
set category = 'workspace', status = 'active'
where id in (select id from oldest);

-- Every client gets a workspace thread.
insert into chat_threads (client_id, status, category)
select c.id, 'active', 'workspace'
from clients c
where not exists (
  select 1 from chat_threads t
  where t.client_id = c.id and t.category = 'workspace'
);

-- ------------------------------------------------------------
-- Supersedes 005: new clients get a WORKSPACE thread.
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

-- ------------------------------------------------------------
-- Workspace lookup (find-or-create, so a deleted workspace chat
-- regenerates on the next bot post).
-- ------------------------------------------------------------
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
  where client_id = p_client_id and category = 'workspace'
  order by created_at asc
  limit 1;

  if tid is null then
    insert into chat_threads (client_id, status, category)
    values (p_client_id, 'active', 'workspace')
    returning id into tid;
  end if;

  return tid;
end;
$$;

-- ------------------------------------------------------------
-- Dispatch Bot: announce ticket lifecycle in the workspace, and
-- auto-close session threads linked to a resolved ticket.
-- Covers every creation path (portal, call webhook, team).
-- ------------------------------------------------------------
create or replace function notify_workspace_ticket_event()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  tid uuid;
  msg text;
begin
  if new.client_id is null then
    return new;
  end if;

  if tg_op = 'INSERT' then
    msg := 'New ticket opened: ' || new.title;
  elsif tg_op = 'UPDATE'
    and new.status = 'resolved'
    and old.status is distinct from new.status then
    msg := 'Ticket resolved: ' || new.title;

    -- Sessions tied to this ticket close with it.
    update chat_threads
    set status = 'closed'
    where linked_ticket_id = new.id
      and category not in ('workspace', 'internal');
  else
    return new;
  end if;

  tid := get_workspace_thread(new.client_id);

  insert into chat_messages
    (thread_id, sender_id, sender_type, content, message_type, metadata)
  values (
    tid,
    null,
    'bot',
    msg,
    'ticket_card',
    jsonb_build_object(
      'ticket_id', new.id,
      'ticket_title', new.title,
      'ticket_status', new.status
    )
  );

  update chat_threads set last_message_at = now() where id = tid;
  return new;
end;
$$;

create trigger tickets_workspace_notifications
  after insert or update on tickets
  for each row execute function notify_workspace_ticket_event();
