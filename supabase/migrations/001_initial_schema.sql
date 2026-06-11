-- ============================================================
-- Dispatch — initial schema
-- Bluejaypro internal operations platform
-- ============================================================

-- ------------------------------------------------------------
-- Enums
-- ------------------------------------------------------------
create type user_role as enum (
  'agency_owner',
  'agency_admin',
  'agency_manager',
  'department_head',
  'department_member',
  'client'
);

create type onboarding_status as enum ('not_started', 'in_progress', 'completed');

create type ticket_category as enum ('seo', 'ghl', 'software', 'billing', 'general');
create type ticket_status as enum ('open', 'in_progress', 'escalated', 'resolved');
create type ticket_source as enum ('web', 'phone', 'chat', 'internal');

create type priority_level as enum ('low', 'medium', 'high', 'urgent');

create type task_status as enum ('todo', 'in_progress', 'done');

create type thread_status as enum ('active', 'closed');
create type sender_type as enum ('client', 'team');
create type message_type as enum ('text', 'ticket_card', 'recording', 'meet_link');

-- ------------------------------------------------------------
-- Tables
-- departments is created before users (users.department_id -> departments);
-- the departments.head_user_id FK is added after users exists.
-- ------------------------------------------------------------

create table departments (
  id           uuid primary key default gen_random_uuid(),
  name         text not null unique,
  description  text,
  head_user_id uuid,
  created_at   timestamptz not null default now()
);

create table users (
  id            uuid primary key references auth.users (id) on delete cascade,
  email         text not null unique,
  full_name     text not null,
  avatar_url    text,
  role          user_role not null default 'client',
  department_id uuid references departments (id) on delete set null,
  phone         text,
  created_at    timestamptz not null default now()
);

alter table departments
  add constraint departments_head_user_id_fkey
  foreign key (head_user_id) references users (id) on delete set null;

create table clients (
  id                      uuid primary key default gen_random_uuid(),
  company_name            text not null,
  contact_name            text not null,
  email                   text not null unique,
  phone                   text,
  logo_url                text,
  brand_colors            jsonb,
  brand_fonts             jsonb,
  google_drive_folder_url text,
  onboarding_status       onboarding_status not null default 'not_started',
  assigned_department_id  uuid references departments (id) on delete set null,
  created_at              timestamptz not null default now()
);

create table client_checklist_items (
  id           uuid primary key default gen_random_uuid(),
  client_id    uuid not null references clients (id) on delete cascade,
  item_name    text not null,
  description  text,
  required     boolean not null default true,
  completed    boolean not null default false,
  completed_at timestamptz,
  file_url     text,
  created_at   timestamptz not null default now()
);

create table tickets (
  id                  uuid primary key default gen_random_uuid(),
  title               text not null,
  description         text,
  category            ticket_category not null default 'general',
  status              ticket_status not null default 'open',
  priority            priority_level not null default 'medium',
  created_by          uuid references users (id) on delete set null,
  assigned_to         uuid references users (id) on delete set null,
  department_id       uuid references departments (id) on delete set null,
  client_id           uuid references clients (id) on delete cascade,
  source              ticket_source not null default 'web',
  voice_recording_url text,
  transcription       text,
  ai_summary          text,
  sla_deadline        timestamptz,
  resolved_at         timestamptz,
  resolution_notes    text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create table ticket_activity_log (
  id         uuid primary key default gen_random_uuid(),
  ticket_id  uuid not null references tickets (id) on delete cascade,
  user_id    uuid references users (id) on delete set null,
  action     text not null,
  old_value  text,
  new_value  text,
  created_at timestamptz not null default now()
);

create table tasks (
  id               uuid primary key default gen_random_uuid(),
  title            text not null,
  description      text,
  department_id    uuid references departments (id) on delete set null,
  client_id        uuid references clients (id) on delete set null,
  assigned_to      uuid references users (id) on delete set null,
  created_by       uuid references users (id) on delete set null,
  status           task_status not null default 'todo',
  priority         priority_level not null default 'medium',
  due_date         timestamptz,
  linked_ticket_id uuid references tickets (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create table chat_threads (
  id              uuid primary key default gen_random_uuid(),
  client_id       uuid not null references clients (id) on delete cascade,
  status          thread_status not null default 'active',
  category        text,
  last_message_at timestamptz,
  created_at      timestamptz not null default now()
);

create table chat_messages (
  id           uuid primary key default gen_random_uuid(),
  thread_id    uuid not null references chat_threads (id) on delete cascade,
  sender_id    uuid references users (id) on delete set null,
  sender_type  sender_type not null,
  content      text,
  message_type message_type not null default 'text',
  metadata     jsonb,
  sent_at      timestamptz not null default now(),
  read_at      timestamptz
);

create table notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references users (id) on delete cascade,
  type       text not null,
  title      text not null,
  body       text,
  read       boolean not null default false,
  link       text,
  created_at timestamptz not null default now()
);

create table audit_logs (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references users (id) on delete set null,
  entity_type text not null,
  entity_id   uuid,
  action      text not null,
  details     jsonb,
  created_at  timestamptz not null default now()
);

create table canned_responses (
  id            uuid primary key default gen_random_uuid(),
  department_id uuid references departments (id) on delete cascade,
  title         text not null,
  body          text not null,
  created_by    uuid references users (id) on delete set null,
  created_at    timestamptz not null default now()
);

create table app_settings (
  id         uuid primary key default gen_random_uuid(),
  key        text not null unique,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- updated_at trigger
-- ------------------------------------------------------------
create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger tickets_set_updated_at
  before update on tickets
  for each row execute function set_updated_at();

create trigger tasks_set_updated_at
  before update on tasks
  for each row execute function set_updated_at();

create trigger app_settings_set_updated_at
  before update on app_settings
  for each row execute function set_updated_at();

-- ------------------------------------------------------------
-- Auto-provision a public.users row when an auth user signs up.
-- Role defaults to 'client' unless provided in raw_user_meta_data.
-- ------------------------------------------------------------
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.users (id, email, full_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.email),
    coalesce((new.raw_user_meta_data ->> 'role')::user_role, 'client')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ------------------------------------------------------------
-- RLS helper functions
-- SECURITY DEFINER so policies on `users` don't recurse into themselves.
-- ------------------------------------------------------------
create or replace function current_user_role()
returns user_role
language sql
security definer set search_path = public
stable
as $$
  select role from users where id = auth.uid();
$$;

create or replace function current_user_department()
returns uuid
language sql
security definer set search_path = public
stable
as $$
  select department_id from users where id = auth.uid();
$$;

create or replace function is_team_member()
returns boolean
language sql
security definer set search_path = public
stable
as $$
  select coalesce(current_user_role() <> 'client', false);
$$;

create or replace function is_agency_admin()
returns boolean
language sql
security definer set search_path = public
stable
as $$
  select current_user_role() in ('agency_owner', 'agency_admin');
$$;

-- Client users are linked to their clients row by email
-- (the users table intentionally has no client_id column).
create or replace function current_client_id()
returns uuid
language sql
security definer set search_path = public
stable
as $$
  select c.id
  from clients c
  join users u on u.email = c.email
  where u.id = auth.uid();
$$;

-- ------------------------------------------------------------
-- Row Level Security
-- Service-role access (webhooks, server jobs) bypasses RLS entirely.
-- ------------------------------------------------------------
alter table users enable row level security;
alter table departments enable row level security;
alter table clients enable row level security;
alter table client_checklist_items enable row level security;
alter table tickets enable row level security;
alter table ticket_activity_log enable row level security;
alter table tasks enable row level security;
alter table chat_threads enable row level security;
alter table chat_messages enable row level security;
alter table notifications enable row level security;
alter table audit_logs enable row level security;
alter table canned_responses enable row level security;
alter table app_settings enable row level security;

-- users
create policy "users: read own row"
  on users for select using (id = auth.uid());

create policy "users: team reads all users"
  on users for select using (is_team_member());

create policy "users: update own profile"
  on users for update using (id = auth.uid()) with check (id = auth.uid());

create policy "users: admins manage users"
  on users for all using (is_agency_admin()) with check (is_agency_admin());

-- departments
create policy "departments: team reads"
  on departments for select using (is_team_member());

create policy "departments: admins manage"
  on departments for all using (is_agency_admin()) with check (is_agency_admin());

-- clients
create policy "clients: team reads"
  on clients for select using (is_team_member());

create policy "clients: client reads own record"
  on clients for select using (id = current_client_id());

create policy "clients: team manages"
  on clients for all using (is_team_member()) with check (is_team_member());

-- client_checklist_items
create policy "checklist: team manages"
  on client_checklist_items for all
  using (is_team_member()) with check (is_team_member());

create policy "checklist: client reads own"
  on client_checklist_items for select using (client_id = current_client_id());

-- tickets
create policy "tickets: team manages"
  on tickets for all using (is_team_member()) with check (is_team_member());

create policy "tickets: client reads own"
  on tickets for select using (client_id = current_client_id());

create policy "tickets: client creates own"
  on tickets for insert
  with check (client_id = current_client_id() and created_by = auth.uid());

-- ticket_activity_log
create policy "ticket_activity: team reads"
  on ticket_activity_log for select using (is_team_member());

create policy "ticket_activity: team inserts"
  on ticket_activity_log for insert with check (is_team_member());

-- tasks (internal only)
create policy "tasks: team manages"
  on tasks for all using (is_team_member()) with check (is_team_member());

-- chat_threads
create policy "chat_threads: team manages"
  on chat_threads for all using (is_team_member()) with check (is_team_member());

create policy "chat_threads: client reads own"
  on chat_threads for select using (client_id = current_client_id());

create policy "chat_threads: client opens own"
  on chat_threads for insert with check (client_id = current_client_id());

-- chat_messages
create policy "chat_messages: team manages"
  on chat_messages for all using (is_team_member()) with check (is_team_member());

create policy "chat_messages: client reads own threads"
  on chat_messages for select using (
    thread_id in (select id from chat_threads where client_id = current_client_id())
  );

create policy "chat_messages: client sends in own threads"
  on chat_messages for insert with check (
    sender_id = auth.uid()
    and sender_type = 'client'
    and thread_id in (select id from chat_threads where client_id = current_client_id())
  );

-- notifications
create policy "notifications: read own"
  on notifications for select using (user_id = auth.uid());

create policy "notifications: mark own read"
  on notifications for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- audit_logs (written by service role; admins can review)
create policy "audit_logs: admins read"
  on audit_logs for select using (is_agency_admin());

-- canned_responses
create policy "canned_responses: team reads"
  on canned_responses for select using (is_team_member());

create policy "canned_responses: team manages"
  on canned_responses for all using (is_team_member()) with check (is_team_member());

-- app_settings
create policy "app_settings: team reads"
  on app_settings for select using (is_team_member());

create policy "app_settings: admins manage"
  on app_settings for all using (is_agency_admin()) with check (is_agency_admin());

-- ------------------------------------------------------------
-- Indexes
-- ------------------------------------------------------------
create index users_department_id_idx on users (department_id);
create index users_role_idx on users (role);

create index clients_assigned_department_id_idx on clients (assigned_department_id);
create index clients_onboarding_status_idx on clients (onboarding_status);

create index client_checklist_items_client_id_idx on client_checklist_items (client_id);

create index tickets_status_idx on tickets (status);
create index tickets_priority_idx on tickets (priority);
create index tickets_category_idx on tickets (category);
create index tickets_assigned_to_idx on tickets (assigned_to);
create index tickets_created_by_idx on tickets (created_by);
create index tickets_department_id_idx on tickets (department_id);
create index tickets_client_id_idx on tickets (client_id);
create index tickets_sla_deadline_idx on tickets (sla_deadline) where resolved_at is null;
create index tickets_created_at_idx on tickets (created_at desc);

create index ticket_activity_log_ticket_id_idx on ticket_activity_log (ticket_id, created_at);

create index tasks_department_id_idx on tasks (department_id);
create index tasks_client_id_idx on tasks (client_id);
create index tasks_assigned_to_idx on tasks (assigned_to);
create index tasks_status_idx on tasks (status);
create index tasks_due_date_idx on tasks (due_date);
create index tasks_linked_ticket_id_idx on tasks (linked_ticket_id);

create index chat_threads_client_id_idx on chat_threads (client_id);
create index chat_threads_status_idx on chat_threads (status);
create index chat_threads_last_message_at_idx on chat_threads (last_message_at desc);

create index chat_messages_thread_id_sent_at_idx on chat_messages (thread_id, sent_at);
create index chat_messages_sender_id_idx on chat_messages (sender_id);

create index notifications_user_id_read_idx on notifications (user_id, read, created_at desc);

create index audit_logs_entity_idx on audit_logs (entity_type, entity_id);
create index audit_logs_user_id_idx on audit_logs (user_id);
create index audit_logs_created_at_idx on audit_logs (created_at desc);

create index canned_responses_department_id_idx on canned_responses (department_id);
