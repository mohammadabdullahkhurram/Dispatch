-- ============================================================
-- Dispatch — client lifecycle: default chat thread + status
-- ============================================================

-- ------------------------------------------------------------
-- Every new client gets an active chat thread immediately, so
-- both the portal and team chat have a conversation to land in.
-- ------------------------------------------------------------
create or replace function create_default_chat_thread()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into chat_threads (client_id, status, category)
  values (new.id, 'active', 'general');
  return new;
end;
$$;

create trigger clients_create_default_chat_thread
  after insert on clients
  for each row execute function create_default_chat_thread();

-- ------------------------------------------------------------
-- Client status: inactive clients are hidden from the default
-- list, their threads are closed, and their users can't use
-- the portal.
-- ------------------------------------------------------------
create type client_status as enum ('active', 'inactive');

alter table clients
  add column status client_status not null default 'active';

create index clients_status_idx on clients (status);
