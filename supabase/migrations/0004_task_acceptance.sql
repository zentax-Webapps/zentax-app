-- =====================================================================
-- Zentax Work Flow - 0004 : task acceptance workflow + shared visibility
--
-- Run AFTER 0003 (which adds the 'proposed' status).
--
-- What this does:
--   1. Client-created tasks are forced to status 'proposed'. They are NOT live
--      tasks until an office user (Admin / Team Member / Super Admin) accepts
--      them (proposed -> open).
--   2. Everyone in a company - office side AND every client (owner + executive)
--      - can now see all of that company's tasks and their conversations.
--      (Removes the old "client executive sees only their own tasks" rule.)
--   3. No chat is allowed on a task until it is accepted (not 'proposed') and
--      while it is open (not 'closed').
--   4. The office may reject a proposed task by deleting it.
-- =====================================================================

-- ---------- Acceptance / proposal trigger ----------
create or replace function public.validate_task_acceptance()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    -- A client can only ever PROPOSE a task; it must be accepted by the office.
    if public.is_client_side() then
      new.status := 'proposed';
    end if;
    return new;
  end if;

  -- UPDATE: only the office side may move a task out of 'proposed'
  -- (i.e. accept it). Clients cannot self-accept their own proposals.
  if old.status = 'proposed' and new.status <> 'proposed' then
    if not public.is_office_side() then
      raise exception 'Only the office team can accept a proposed task';
    end if;
  end if;

  return new;
end $$;

drop trigger if exists tasks_acceptance_validate on public.tasks;
create trigger tasks_acceptance_validate
  before insert or update on public.tasks
  for each row execute procedure public.validate_task_acceptance();

-- =====================================================================
-- RLS - shared visibility across all company members
-- =====================================================================

-- ---------- tasks ----------
drop policy if exists tasks_select on public.tasks;
create policy tasks_select on public.tasks
  for select using (
    public.app_role() = 'super_admin'
    or public.is_company_member(company_id)
  );

drop policy if exists tasks_update on public.tasks;
create policy tasks_update on public.tasks
  for update using (
    public.app_role() = 'super_admin'
    or public.is_company_member(company_id)
  );

-- Super Admin can delete anything; the office side may reject (delete) a task
-- that is still merely proposed.
drop policy if exists tasks_delete on public.tasks;
create policy tasks_delete on public.tasks
  for delete using (
    public.app_role() = 'super_admin'
    or (
      public.is_office_side()
      and public.is_company_member(company_id)
      and status = 'proposed'
    )
  );

-- ---------- task_messages ----------
drop policy if exists tm_select on public.task_messages;
create policy tm_select on public.task_messages
  for select using (
    exists(
      select 1 from public.tasks t
       where t.id = task_messages.task_id
         and (
           public.app_role() = 'super_admin'
           or public.is_company_member(t.company_id)
         )
    )
  );

-- No chatting on a proposed (not-yet-accepted) or closed task.
drop policy if exists tm_insert on public.task_messages;
create policy tm_insert on public.task_messages
  for insert with check (
    user_id = auth.uid()
    and exists(
      select 1 from public.tasks t
       where t.id = task_messages.task_id
         and t.status not in ('proposed','closed')
         and public.is_company_member(t.company_id)
    )
  );
