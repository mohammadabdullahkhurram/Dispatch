-- ============================================================
-- Dispatch — session point of contact, web-ticket sessions,
-- and direct-message (DM) threads.
-- ============================================================

-- ------------------------------------------------------------
-- Point of contact on threads: the client user the session is
-- with (ticket submitter / matched SMS or call sender).
-- ------------------------------------------------------------
alter table chat_threads
  add column point_of_contact_id uuid references users (id) on delete set null;

-- ------------------------------------------------------------
-- Sessions auto-create for web (portal) ticket submissions too.
-- Chat-created tickets already live in a session; phone tickets
-- get their session from the ghl-call webhook.
-- ------------------------------------------------------------
create or replace function create_session_for_web_ticket()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if new.client_id is not null and new.source = 'web' then
    insert into chat_threads
      (client_id, status, category, linked_ticket_id,
       point_of_contact_id, created_by, last_message_at)
    values
      (new.client_id, 'active', new.category::text, new.id,
       new.created_by, new.created_by, now());
  end if;
  return new;
end;
$$;

create trigger tickets_create_web_session
  after insert on tickets
  for each row execute function create_session_for_web_ticket();

-- ------------------------------------------------------------
-- DM threads: category 'dm', 1-on-1 between a team member and a
-- client user. Visible only to the two participants plus
-- agency_owner / agency_admin. The policies below replace the
-- blanket ones from 001 to carve out DMs.
-- ------------------------------------------------------------
drop policy "chat_threads: team manages" on chat_threads;
create policy "chat_threads: team manages"
  on chat_threads for all
  using (
    is_team_member()
    and (
      category is distinct from 'dm'
      or is_agency_admin()
      or auth.uid() = any (coalesce(participant_ids, '{}'))
    )
  )
  with check (
    is_team_member()
    and (
      category is distinct from 'dm'
      or is_agency_admin()
      or auth.uid() = any (coalesce(participant_ids, '{}'))
    )
  );

drop policy "chat_threads: client reads own" on chat_threads;
create policy "chat_threads: client reads own"
  on chat_threads for select
  using (
    client_id = current_client_id()
    and (
      category is distinct from 'dm'
      or auth.uid() = any (coalesce(participant_ids, '{}'))
    )
  );

-- Messages follow their thread's DM visibility.
create or replace function can_access_thread(p_thread_id uuid)
returns boolean
language sql
security definer set search_path = public
stable
as $$
  select not exists (
    select 1 from chat_threads t
    where t.id = p_thread_id
      and t.category = 'dm'
      and not (
        is_agency_admin()
        or auth.uid() = any (coalesce(t.participant_ids, '{}'))
      )
  );
$$;

drop policy "chat_messages: team manages" on chat_messages;
create policy "chat_messages: team manages"
  on chat_messages for all
  using (is_team_member() and can_access_thread(thread_id))
  with check (is_team_member() and can_access_thread(thread_id));

drop policy "chat_messages: client reads own threads" on chat_messages;
create policy "chat_messages: client reads own threads"
  on chat_messages for select
  using (
    thread_id in (select id from chat_threads where client_id = current_client_id())
    and can_access_thread(thread_id)
  );

drop policy "chat_messages: client sends in own threads" on chat_messages;
create policy "chat_messages: client sends in own threads"
  on chat_messages for insert
  with check (
    sender_id = auth.uid()
    and sender_type = 'client'
    and thread_id in (select id from chat_threads where client_id = current_client_id())
    and can_access_thread(thread_id)
  );
