-- ============================================================
-- Dispatch — WhatsApp/Slack-style chat model.
--
-- Three top-level sections, expressed as chat_type:
--   workspace        — one persistent room per client (never deletes)
--   dm               — 1:1 with a client team member (client-facing)
--   group            — named group mixing client users + team
--   session          — support session (SMS/call/ticket), can close
--   internal_dm      — 1:1 between two Dispatch team members
--   internal_group   — named team-only group
--
-- DMs and groups never resolve and are participant-scoped. Workspace
-- threads are protected from deletion. Presence is a last_seen stamp.
-- ============================================================

create type chat_type as enum (
  'workspace', 'dm', 'group', 'session', 'internal_dm', 'internal_group'
);

alter table chat_threads
  add column chat_type     chat_type,
  add column group_name    text,
  add column group_owner_id uuid references users (id) on delete set null,
  add column is_deletable  boolean not null default true;

alter table users add column last_seen timestamptz;

-- ------------------------------------------------------------
-- Backfill chat_type from the legacy category + client_id.
-- ------------------------------------------------------------
update chat_threads set chat_type = case
  when category = 'workspace'                  then 'workspace'::chat_type
  when category = 'dm' and client_id is not null then 'dm'::chat_type
  when category = 'dm' and client_id is null     then 'internal_dm'::chat_type
  when category = 'internal'                   then 'internal_group'::chat_type
  else 'session'::chat_type
end;

-- Groups carry their display name + owner separately from `title`.
update chat_threads
  set group_name = title, group_owner_id = created_by
  where chat_type in ('group', 'internal_group');

-- Workspaces are permanent; everything else may be deleted.
update chat_threads set is_deletable = (chat_type <> 'workspace');

alter table chat_threads alter column chat_type set default 'session';
alter table chat_threads alter column chat_type set not null;

create index chat_threads_chat_type_idx on chat_threads (chat_type);
create index users_last_seen_idx on users (last_seen);

-- ------------------------------------------------------------
-- Undeletable threads (workspaces) are hard-protected even if the
-- UI or a stray query tries to remove them.
-- ------------------------------------------------------------
create or replace function prevent_undeletable_thread_delete()
returns trigger
language plpgsql
as $$
begin
  if old.is_deletable = false then
    raise exception 'This thread cannot be deleted';
  end if;
  return old;
end;
$$;

drop trigger if exists chat_threads_block_undeletable on chat_threads;
create trigger chat_threads_block_undeletable
  before delete on chat_threads
  for each row execute function prevent_undeletable_thread_delete();

-- ------------------------------------------------------------
-- Access: dm/group/internal_* are participant-scoped. Supersedes
-- the 010 version (which only scoped 'dm'). Returns false only when
-- a participant-scoped thread is being read by a non-participant
-- (agency owners/admins keep oversight of client-facing dm/group).
-- ------------------------------------------------------------
create or replace function can_access_thread(p_thread_id uuid)
returns boolean
language sql
security definer set search_path = public
stable
as $$
  select not exists (
    select 1 from chat_threads t
    where t.id = p_thread_id
      and t.chat_type in ('dm', 'group', 'internal_dm', 'internal_group')
      and not (
        auth.uid() = any (coalesce(t.participant_ids, '{}'))
        or (t.chat_type in ('dm', 'group') and is_agency_admin())
      )
  );
$$;

-- ------------------------------------------------------------
-- Thread visibility. Team sees workspaces + sessions + any
-- participant-scoped thread they belong to (admins: all client
-- dm/group). Clients see their workspace + dm/group they're in —
-- never sessions.
-- ------------------------------------------------------------
drop policy if exists "chat_threads: team manages" on chat_threads;
create policy "chat_threads: team manages"
  on chat_threads for all
  using (is_team_member() and can_access_thread(id))
  with check (is_team_member());

drop policy if exists "chat_threads: client reads own" on chat_threads;
create policy "chat_threads: client reads own"
  on chat_threads for select
  using (
    (chat_type = 'workspace' and client_id = current_client_id())
    or (
      chat_type in ('dm', 'group')
      and auth.uid() = any (coalesce(participant_ids, '{}'))
    )
  );

drop policy if exists "chat_threads: client opens own" on chat_threads;
create policy "chat_threads: client opens own"
  on chat_threads for insert
  with check (
    client_id = current_client_id()
    and chat_type in ('dm', 'group')
    and auth.uid() = any (coalesce(participant_ids, '{}'))
  );

-- Let clients bump last_message_at on threads they participate in.
drop policy if exists "chat_threads: client updates own" on chat_threads;
create policy "chat_threads: client updates own"
  on chat_threads for update
  using (
    (chat_type = 'workspace' and client_id = current_client_id())
    or (
      chat_type in ('dm', 'group')
      and auth.uid() = any (coalesce(participant_ids, '{}'))
    )
  );

-- The message policies from 010 already AND can_access_thread(), so
-- they inherit the broadened access automatically.
