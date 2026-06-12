-- ============================================================
-- Dispatch — clients are no longer assigned to one department.
-- Routing happens per ticket (tickets.department_id stays).
-- ============================================================

alter table clients drop column assigned_department_id;
