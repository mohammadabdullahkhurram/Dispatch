-- ============================================================
-- Dispatch — enable realtime on chat_threads so new sessions
-- (created server-side by the SMS/call webhooks) reach every
-- logged-in team member's chat without a refresh.
-- ============================================================

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'chat_threads'
  ) then
    alter publication supabase_realtime add table chat_threads;
  end if;
end $$;
