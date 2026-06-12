-- ============================================================
-- Dispatch — checklist templates + client-side staff roles
-- ============================================================

-- ------------------------------------------------------------
-- Role helper: owner/admin/manager (template management rights)
-- ------------------------------------------------------------
create or replace function is_agency_manager()
returns boolean
language sql
security definer set search_path = public
stable
as $$
  select current_user_role() in ('agency_owner', 'agency_admin', 'agency_manager');
$$;

-- ------------------------------------------------------------
-- Checklist templates
-- ------------------------------------------------------------
create table checklist_templates (
  id          uuid primary key default gen_random_uuid(),
  item_name   text not null,
  description text,
  required    boolean not null default true,
  created_by  uuid references users (id) on delete set null,
  created_at  timestamptz not null default now()
);

alter table checklist_templates enable row level security;

create policy "checklist_templates: team reads"
  on checklist_templates for select using (is_team_member());

create policy "checklist_templates: managers manage"
  on checklist_templates for all
  using (is_agency_manager()) with check (is_agency_manager());

-- New clients automatically receive every current template item.
create or replace function apply_checklist_templates_to_client()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into client_checklist_items (client_id, item_name, description, required)
  select new.id, t.item_name, t.description, t.required
  from checklist_templates t;
  return new;
end;
$$;

create trigger clients_apply_checklist_templates
  after insert on clients
  for each row execute function apply_checklist_templates_to_client();

-- ------------------------------------------------------------
-- Client-side staff roles:
-- owner/member → account_owner/account_admin/office_member/contractor
-- Existing rows map: owner → account_owner, member → office_member.
-- ------------------------------------------------------------
alter type client_user_role rename to client_user_role_old;

create type client_user_role as enum (
  'account_owner',
  'account_admin',
  'office_member',
  'contractor'
);

alter table client_users
  alter column role drop default,
  alter column role type client_user_role using (
    case role::text
      when 'owner' then 'account_owner'
      else 'office_member'
    end
  )::client_user_role,
  alter column role set default 'office_member';

drop type client_user_role_old;

-- ------------------------------------------------------------
-- The signed-in user's role on their own client (null for team
-- members and unlinked users).
-- ------------------------------------------------------------
create or replace function current_client_role()
returns client_user_role
language sql
security definer set search_path = public
stable
as $$
  select role
  from client_users
  where user_id = auth.uid()
    and client_id = current_client_id()
  limit 1;
$$;

-- ------------------------------------------------------------
-- Self-service roster management: account_owner / account_admin
-- can add and remove users on their own client.
-- ------------------------------------------------------------
create policy "client_users: client admins add to own roster"
  on client_users for insert
  with check (
    client_id = current_client_id()
    and current_client_role() in ('account_owner', 'account_admin')
  );

create policy "client_users: client admins remove from own roster"
  on client_users for delete
  using (
    client_id = current_client_id()
    and current_client_role() in ('account_owner', 'account_admin')
  );
