-- ============================================================
-- Dispatch — client documents, task comments, uploads bucket
-- Supports the portal Documents tab and task detail comments.
-- ============================================================

create table client_documents (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid not null references clients (id) on delete cascade,
  title       text not null,
  description text,
  url         text not null,
  created_by  uuid references users (id) on delete set null,
  created_at  timestamptz not null default now()
);

create table task_comments (
  id         uuid primary key default gen_random_uuid(),
  task_id    uuid not null references tasks (id) on delete cascade,
  user_id    uuid references users (id) on delete set null,
  content    text not null,
  created_at timestamptz not null default now()
);

create index client_documents_client_id_idx on client_documents (client_id);
create index task_comments_task_id_idx on task_comments (task_id, created_at);

alter table client_documents enable row level security;
alter table task_comments enable row level security;

create policy "client_documents: team manages"
  on client_documents for all
  using (is_team_member()) with check (is_team_member());

create policy "client_documents: client reads own"
  on client_documents for select using (client_id = current_client_id());

create policy "task_comments: team manages"
  on task_comments for all
  using (is_team_member()) with check (is_team_member());

-- Public bucket for ticket attachments, checklist files, and client logos.
insert into storage.buckets (id, name, public)
values ('uploads', 'uploads', true)
on conflict (id) do nothing;

create policy "uploads: authenticated can upload"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'uploads');

create policy "uploads: public read"
  on storage.objects for select
  using (bucket_id = 'uploads');
