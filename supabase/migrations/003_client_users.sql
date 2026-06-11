-- ============================================================
-- Dispatch — multi-user support per client
-- Links multiple auth users to one client and stores each
-- user's GHL contact id for tag-based SMS filtering.
-- ============================================================

create type client_user_role as enum ('owner', 'member');

create table client_users (
  id         uuid primary key default gen_random_uuid(),
  client_id  uuid not null references clients (id) on delete cascade,
  user_id    uuid not null references users (id) on delete cascade,
  role       client_user_role not null default 'member',
  created_at timestamptz not null default now(),
  unique (client_id, user_id)
);

create index client_users_client_id_idx on client_users (client_id);
create index client_users_user_id_idx on client_users (user_id);

-- GHL contact id for the user (set when they're added under a client).
alter table users add column ghl_contact_id text;

-- ------------------------------------------------------------
-- current_client_id() now resolves through client_users first,
-- falling back to the legacy email match (clients.email). All
-- existing client-side RLS policies (tickets, chat, checklist,
-- documents, …) call this function, so they pick up multi-user
-- support automatically.
-- ------------------------------------------------------------
create or replace function current_client_id()
returns uuid
language sql
security definer set search_path = public
stable
as $$
  select coalesce(
    (select cu.client_id
     from client_users cu
     where cu.user_id = auth.uid()
     order by cu.created_at
     limit 1),
    (select c.id
     from clients c
     join users u on u.email = c.email
     where u.id = auth.uid())
  );
$$;

-- ------------------------------------------------------------
-- RLS
-- ------------------------------------------------------------
alter table client_users enable row level security;

create policy "client_users: team manages"
  on client_users for all
  using (is_team_member()) with check (is_team_member());

-- Client users can see who else is on their client account.
create policy "client_users: client reads own roster"
  on client_users for select using (client_id = current_client_id());

-- Client users can read the user profiles of their teammates
-- (name/avatar for the roster view).
create policy "users: client reads own client teammates"
  on users for select using (
    id in (select user_id from client_users where client_id = current_client_id())
  );
