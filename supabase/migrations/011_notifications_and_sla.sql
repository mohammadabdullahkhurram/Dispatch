-- ============================================================
-- Dispatch — notification triggers + SLA hardening.
--
-- Event notifications (ticket assigned / escalated / resolved,
-- client chat messages) fire from DB triggers so every creation
-- path is covered (portal, webhooks, team UI). Time-based ones
-- (SLA breach, task due soon / overdue) run via
-- run_time_based_notifications(), called from the cron route and
-- opportunistically on dashboard page loads.
-- ============================================================

-- Dedupe key for time-based notifications (one per entity+user+type).
alter table notifications add column if not exists entity_id uuid;

create index if not exists notifications_dedupe_idx
  on notifications (type, entity_id, user_id);

-- ------------------------------------------------------------
-- Belt-and-braces: any ticket inserted without an SLA deadline
-- gets one from its priority (urgent 2h / high 8h / medium 24h /
-- low 72h). The app sets it explicitly too.
-- ------------------------------------------------------------
create or replace function set_ticket_sla_deadline()
returns trigger
language plpgsql
as $$
begin
  if new.sla_deadline is null then
    new.sla_deadline := coalesce(new.created_at, now()) +
      case new.priority
        when 'urgent' then interval '2 hours'
        when 'high'   then interval '8 hours'
        when 'medium' then interval '24 hours'
        else               interval '72 hours'
      end;
  end if;
  return new;
end;
$$;

drop trigger if exists tickets_set_sla_deadline on tickets;
create trigger tickets_set_sla_deadline
  before insert on tickets
  for each row execute function set_ticket_sla_deadline();

-- ------------------------------------------------------------
-- Insert helper — skips duplicates for entity-scoped types.
-- ------------------------------------------------------------
create or replace function notify_user(
  p_user_id   uuid,
  p_type      text,
  p_title     text,
  p_body      text,
  p_link      text,
  p_entity_id uuid default null
)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if p_user_id is null then
    return;
  end if;
  if p_entity_id is not null and exists (
    select 1 from notifications
    where type = p_type and entity_id = p_entity_id and user_id = p_user_id
  ) then
    return;
  end if;
  insert into notifications (user_id, type, title, body, link, entity_id)
  values (p_user_id, p_type, p_title, p_body, p_link, p_entity_id);
end;
$$;

-- ------------------------------------------------------------
-- Ticket lifecycle notifications.
-- ------------------------------------------------------------
create or replace function notify_ticket_events()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  dept_head uuid;
  creator_role user_role;
begin
  -- ticket_assigned: assignee changed (or set on insert).
  if new.assigned_to is not null
     and (tg_op = 'INSERT' or new.assigned_to is distinct from old.assigned_to)
     and new.assigned_to is distinct from auth.uid() then
    perform notify_user(
      new.assigned_to, 'ticket_assigned',
      'Ticket assigned to you', new.title,
      '/dashboard/tickets'
    );
  end if;

  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    -- ticket_escalated: department head (owners/admins as fallback).
    if new.status = 'escalated' then
      select head_user_id into dept_head
        from departments where id = new.department_id;
      if dept_head is not null then
        perform notify_user(
          dept_head, 'ticket_escalated',
          'Ticket escalated', new.title,
          '/dashboard/tickets'
        );
      else
        perform notify_user(u.id, 'ticket_escalated',
          'Ticket escalated', new.title, '/dashboard/tickets')
        from users u where u.role in ('agency_owner', 'agency_admin');
      end if;
    end if;

    -- ticket_resolved: tell the creator (client users land in the portal).
    if new.status = 'resolved'
       and new.created_by is not null
       and new.created_by is distinct from auth.uid() then
      select role into creator_role from users where id = new.created_by;
      perform notify_user(
        new.created_by, 'ticket_resolved',
        'Your ticket was resolved', new.title,
        case when creator_role = 'client'
          then '/portal/tickets' else '/dashboard/tickets' end
      );
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists tickets_notify_events on tickets;
create trigger tickets_notify_events
  after insert or update on tickets
  for each row execute function notify_ticket_events();

-- ------------------------------------------------------------
-- new_chat_message: a client wrote in a workspace/session thread
-- (or DM) — tell the team. DMs notify only the team participants.
-- ------------------------------------------------------------
create or replace function notify_team_of_client_message()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  t chat_threads%rowtype;
  company text;
begin
  if new.sender_type <> 'client' then
    return new;
  end if;

  select * into t from chat_threads where id = new.thread_id;
  if t.id is null or t.category = 'internal' then
    return new;
  end if;

  select company_name into company from clients where id = t.client_id;

  if t.category = 'dm' then
    perform notify_user(u.id, 'new_chat_message',
      'New direct message',
      coalesce(company, 'Client') || ': ' || coalesce(left(new.content, 120), 'New message'),
      '/dashboard/chat')
    from users u
    where u.role <> 'client'
      and u.id = any (coalesce(t.participant_ids, '{}'))
      and u.id is distinct from new.sender_id;
  else
    perform notify_user(u.id, 'new_chat_message',
      'New client message',
      coalesce(company, 'Client') || ': ' || coalesce(left(new.content, 120), 'New message'),
      '/dashboard/chat')
    from users u
    where u.role <> 'client'
      and u.id is distinct from new.sender_id;
  end if;

  return new;
end;
$$;

drop trigger if exists chat_messages_notify_team on chat_messages;
create trigger chat_messages_notify_team
  after insert on chat_messages
  for each row execute function notify_team_of_client_message();

-- ------------------------------------------------------------
-- Time-based checks: SLA breach, task due soon, task overdue.
-- Deduped per entity+user+type via notify_user. Callable by any
-- team member (dashboard page load) or the service role (cron).
-- ------------------------------------------------------------
create or replace function run_time_based_notifications()
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  r record;
  dept_head uuid;
begin
  if auth.uid() is not null and not is_team_member() then
    raise exception 'team members only';
  end if;

  -- sla_breach: assignee + department head.
  for r in
    select t.*, d.head_user_id
    from tickets t
    left join departments d on d.id = t.department_id
    where t.sla_deadline < now() and t.status <> 'resolved'
  loop
    perform notify_user(r.assigned_to, 'sla_breach',
      'SLA breached', r.title, '/dashboard/tickets', r.id);
    if r.head_user_id is distinct from r.assigned_to then
      perform notify_user(r.head_user_id, 'sla_breach',
        'SLA breached', r.title, '/dashboard/tickets', r.id);
    end if;
  end loop;

  -- task_due_soon: assignee, 24h before due_date.
  for r in
    select * from tasks
    where status <> 'done'
      and due_date between now() and now() + interval '24 hours'
  loop
    perform notify_user(r.assigned_to, 'task_due_soon',
      'Task due within 24 hours', r.title, '/dashboard/tasks', r.id);
  end loop;

  -- task_overdue: assignee + department head.
  for r in
    select t.*, d.head_user_id
    from tasks t
    left join departments d on d.id = t.department_id
    where t.status <> 'done' and t.due_date < now()
  loop
    perform notify_user(r.assigned_to, 'task_overdue',
      'Task overdue', r.title, '/dashboard/tasks', r.id);
    if r.head_user_id is distinct from r.assigned_to then
      perform notify_user(r.head_user_id, 'task_overdue',
        'Task overdue', r.title, '/dashboard/tasks', r.id);
    end if;
  end loop;
end;
$$;

grant execute on function run_time_based_notifications() to authenticated;

-- ------------------------------------------------------------
-- Portal task visibility: clients read tasks for their own
-- client (read-only — no insert/update/delete policies), and can
-- resolve team-member names for assignees.
-- ------------------------------------------------------------
create policy "tasks: client reads own"
  on tasks for select using (client_id = current_client_id());

create policy "users: clients read team members"
  on users for select
  using (current_user_role() = 'client' and role <> 'client');
