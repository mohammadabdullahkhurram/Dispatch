-- ============================================================
-- Dispatch — workspace threads: company-named titles + full
-- team membership.
--
-- Workspaces are the company's room: titled after company_name
-- (never a contact person), with every agency team member as a
-- participant. New team members join all workspaces automatically.
-- ============================================================

-- All current agency team member ids.
create or replace function team_member_ids()
returns uuid[]
language sql
security definer set search_path = public
stable
as $$
  select coalesce(array_agg(id), '{}') from users where role <> 'client';
$$;

-- ------------------------------------------------------------
-- Supersedes 008: new clients get a workspace thread titled with
-- the company name and pre-populated with the whole team.
-- ------------------------------------------------------------
create or replace function create_default_chat_thread()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into chat_threads (client_id, status, category, title, participant_ids)
  values (new.id, 'active', 'workspace', new.company_name, team_member_ids());
  return new;
end;
$$;

-- Find-or-create lookup gets the same treatment.
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
  order by created_at
  limit 1;

  if tid is null then
    insert into chat_threads (client_id, status, category, title, participant_ids)
    select p_client_id, 'active', 'workspace', c.company_name, team_member_ids()
    from clients c where c.id = p_client_id
    returning id into tid;
  end if;

  return tid;
end;
$$;

-- ------------------------------------------------------------
-- New team members join every existing workspace automatically
-- (fires on signup via invite, admin creation — any path).
-- ------------------------------------------------------------
create or replace function add_team_member_to_workspaces()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if new.role <> 'client' then
    update chat_threads
    set participant_ids = array_append(coalesce(participant_ids, '{}'), new.id)
    where category = 'workspace'
      and not (new.id = any (coalesce(participant_ids, '{}')));
  end if;
  return new;
end;
$$;

drop trigger if exists users_join_workspaces on users;
create trigger users_join_workspaces
  after insert on users
  for each row execute function add_team_member_to_workspaces();

-- A team member who leaves shouldn't linger in participant lists.
create or replace function remove_user_from_workspaces()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  update chat_threads
  set participant_ids = array_remove(participant_ids, old.id)
  where category = 'workspace'
    and old.id = any (coalesce(participant_ids, '{}'));
  return old;
end;
$$;

drop trigger if exists users_leave_workspaces on users;
create trigger users_leave_workspaces
  after delete on users
  for each row execute function remove_user_from_workspaces();

-- ------------------------------------------------------------
-- Backfill existing workspace threads: company-name titles and
-- the full current team as participants.
-- ------------------------------------------------------------
update chat_threads t
set title = c.company_name
from clients c
where t.client_id = c.id
  and t.category = 'workspace'
  and (t.title is distinct from c.company_name);

update chat_threads
set participant_ids = team_member_ids()
where category = 'workspace';
