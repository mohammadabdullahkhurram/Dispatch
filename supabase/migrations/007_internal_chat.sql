-- ============================================================
-- Dispatch — internal team chat threads
-- Internal threads have no client: client_id becomes nullable,
-- and threads gain a title, participant set, and creator.
-- Client-side RLS is unaffected: policies match on
-- client_id = current_client_id(), which never matches null.
-- ============================================================

alter table chat_threads alter column client_id drop not null;

alter table chat_threads add column title text;
alter table chat_threads add column participant_ids uuid[];
alter table chat_threads
  add column created_by uuid references users (id) on delete set null;

create index chat_threads_category_idx on chat_threads (category);
