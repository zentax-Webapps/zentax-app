-- =====================================================================
-- Zentax Work Flow - initial schema, helper functions, and RLS policies
-- Paste this into Supabase SQL Editor or run via `supabase db push`.
-- =====================================================================

-- ---------- 1. Enums ----------
do $$ begin
  create type user_role as enum
    ('super_admin','admin','team_member','client_owner','client_executive');
exception when duplicate_object then null; end $$;

do $$ begin
  create type task_priority as enum ('red','orange','yellow','green');
exception when duplicate_object then null; end $$;

do $$ begin
  create type task_status as enum
    ('open','in_progress','close_requested','closed');
exception when duplicate_object then null; end $$;

-- ---------- 2. profiles (1:1 with auth.users) ----------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text not null,
  role user_role not null,
  phone text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id)
);
create index if not exists profiles_role_idx on public.profiles(role);

-- ---------- 3. companies ----------
create table if not exists public.companies (
  id bigserial primary key,
  name text not null unique,
  notes text,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id)
);

-- ---------- 4. company_members ----------
create table if not exists public.company_members (
  company_id bigint not null references public.companies(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  added_at timestamptz not null default now(),
  primary key (company_id, user_id)
);
create index if not exists cm_user_idx on public.company_members(user_id);

-- ---------- 5. tasks ----------
create table if not exists public.tasks (
  id bigserial primary key,
  company_id bigint not null references public.companies(id) on delete cascade,
  title text not null,
  details text,
  priority task_priority not null default 'yellow',
  due_date date,
  created_by uuid not null references public.profiles(id),
  assigned_to uuid not null references public.profiles(id),
  status task_status not null default 'open',
  close_requested_by uuid references public.profiles(id),
  close_requested_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists tasks_company_idx on public.tasks(company_id);
create index if not exists tasks_assigned_idx on public.tasks(assigned_to);

-- ---------- 6. task_messages ----------
create table if not exists public.task_messages (
  id bigserial primary key,
  task_id bigint not null references public.tasks(id) on delete cascade,
  user_id uuid not null references public.profiles(id),
  body text not null,
  created_at timestamptz not null default now()
);
create index if not exists tm_task_idx on public.task_messages(task_id);

-- ---------- 7. task_events (audit trail) ----------
create table if not exists public.task_events (
  id bigserial primary key,
  task_id bigint not null references public.tasks(id) on delete cascade,
  user_id uuid references public.profiles(id),
  event text not null,
  meta jsonb,
  created_at timestamptz not null default now()
);

-- =====================================================================
-- SECURITY DEFINER helpers - avoid recursion in RLS policies
-- =====================================================================

-- Renamed from `current_role` to avoid shadowing Postgres's built-in.
create or replace function public.app_role()
returns user_role
language sql
security definer
set search_path = public
stable
as $$
  select role from public.profiles where id = auth.uid()
$$;

create or replace function public.is_office_side()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(role in ('super_admin','admin','team_member'), false)
    from public.profiles where id = auth.uid()
$$;

create or replace function public.is_client_side()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(role in ('client_owner','client_executive'), false)
    from public.profiles where id = auth.uid()
$$;

create or replace function public.is_company_member(cid bigint)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists(
    select 1 from public.company_members
     where company_id = cid and user_id = auth.uid()
  )
$$;

create or replace function public.shares_company_with(other uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists(
    select 1 from public.company_members cm1
      join public.company_members cm2 on cm1.company_id = cm2.company_id
     where cm1.user_id = auth.uid() and cm2.user_id = other
  )
$$;

-- =====================================================================
-- Triggers
-- =====================================================================

-- keep tasks.updated_at fresh
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists tasks_touch on public.tasks;
create trigger tasks_touch
  before update on public.tasks
  for each row execute procedure public.touch_updated_at();

-- Validate close-acceptance: only the OTHER party may flip a close request.
create or replace function public.validate_close_transition()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  requester_role user_role;
  actor_role user_role;
begin
  -- only inspect transitions out of close_requested
  if old.status = 'close_requested' and new.status = 'closed' then
    select role into requester_role from public.profiles
      where id = old.close_requested_by;
    select role into actor_role from public.profiles
      where id = auth.uid();
    if requester_role is null or actor_role is null then
      raise exception 'Cannot validate close request';
    end if;
    -- requester and acceptor must be on OPPOSITE sides
    if (requester_role in ('super_admin','admin','team_member'))
       = (actor_role in ('super_admin','admin','team_member')) then
      raise exception 'Close must be accepted by the other party (office vs client)';
    end if;
    if old.close_requested_by = auth.uid() then
      raise exception 'You cannot accept your own close request';
    end if;
    new.closed_at = now();
  end if;
  -- when entering close_requested, stamp requester + time
  if old.status <> 'close_requested' and new.status = 'close_requested' then
    new.close_requested_by = auth.uid();
    new.close_requested_at = now();
  end if;
  -- when rejecting (close_requested -> open) clear stamps
  if old.status = 'close_requested' and new.status = 'open' then
    new.close_requested_by = null;
    new.close_requested_at = null;
  end if;
  return new;
end $$;

drop trigger if exists tasks_close_validate on public.tasks;
create trigger tasks_close_validate
  before update of status on public.tasks
  for each row execute procedure public.validate_close_transition();

-- =====================================================================
-- Enable RLS + policies
-- =====================================================================

alter table public.profiles         enable row level security;
alter table public.companies        enable row level security;
alter table public.company_members  enable row level security;
alter table public.tasks            enable row level security;
alter table public.task_messages    enable row level security;
alter table public.task_events      enable row level security;

-- ---------- profiles ----------
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select using (
    id = auth.uid()
    or public.app_role() = 'super_admin'
    or public.shares_company_with(id)
  );

drop policy if exists profiles_self_update on public.profiles;
create policy profiles_self_update on public.profiles
  for update using (id = auth.uid())
  with check (id = auth.uid() and role = public.app_role());
-- (a user can edit their own profile but cannot escalate their role - role must
--  match the value app_role() returns from the SECURITY DEFINER helper.)

-- (inserts and admin updates of profiles are done by Edge Functions with
--  service role key - RLS does not apply to service role.)

-- ---------- companies ----------
drop policy if exists companies_select on public.companies;
create policy companies_select on public.companies
  for select using (
    public.app_role() = 'super_admin'
    or public.is_company_member(id)
  );

drop policy if exists companies_insert on public.companies;
create policy companies_insert on public.companies
  for insert with check (public.app_role() = 'super_admin');

drop policy if exists companies_update on public.companies;
create policy companies_update on public.companies
  for update using (public.app_role() = 'super_admin');

drop policy if exists companies_delete on public.companies;
create policy companies_delete on public.companies
  for delete using (public.app_role() = 'super_admin');

-- ---------- company_members ----------
drop policy if exists members_select on public.company_members;
create policy members_select on public.company_members
  for select using (
    public.app_role() = 'super_admin'
    or public.is_company_member(company_id)
  );

drop policy if exists members_insert on public.company_members;
create policy members_insert on public.company_members
  for insert with check (
    public.app_role() = 'super_admin'
    or (
      public.app_role() = 'admin'
      and public.is_company_member(company_id)
      and (select role from public.profiles where id = user_id)
            in ('team_member','client_executive')
    )
  );

drop policy if exists members_delete on public.company_members;
create policy members_delete on public.company_members
  for delete using (public.app_role() = 'super_admin');

-- ---------- tasks ----------
drop policy if exists tasks_select on public.tasks;
create policy tasks_select on public.tasks
  for select using (
    public.app_role() = 'super_admin'
    or (
      public.is_company_member(company_id)
      and (
        public.app_role() <> 'client_executive'
        or created_by = auth.uid()
        or assigned_to = auth.uid()
      )
    )
  );

drop policy if exists tasks_insert on public.tasks;
create policy tasks_insert on public.tasks
  for insert with check (
    public.is_company_member(company_id)
    and created_by = auth.uid()
    and exists(
      select 1 from public.company_members
       where company_id = tasks.company_id and user_id = tasks.assigned_to
    )
  );

drop policy if exists tasks_update on public.tasks;
create policy tasks_update on public.tasks
  for update using (
    public.app_role() = 'super_admin'
    or (
      public.is_company_member(company_id)
      and (
        public.app_role() <> 'client_executive'
        or created_by = auth.uid()
        or assigned_to = auth.uid()
      )
    )
  );

drop policy if exists tasks_delete on public.tasks;
create policy tasks_delete on public.tasks
  for delete using (public.app_role() = 'super_admin');

-- ---------- task_messages ----------
drop policy if exists tm_select on public.task_messages;
create policy tm_select on public.task_messages
  for select using (
    exists(
      select 1 from public.tasks t
       where t.id = task_messages.task_id
         and (
           public.app_role() = 'super_admin'
           or (public.is_company_member(t.company_id)
               and (public.app_role() <> 'client_executive'
                    or t.created_by = auth.uid()
                    or t.assigned_to = auth.uid()))
         )
    )
  );

drop policy if exists tm_insert on public.task_messages;
create policy tm_insert on public.task_messages
  for insert with check (
    user_id = auth.uid()
    and exists(
      select 1 from public.tasks t
       where t.id = task_messages.task_id
         and t.status <> 'closed'
         and public.is_company_member(t.company_id)
         and (public.app_role() <> 'client_executive'
              or t.created_by = auth.uid()
              or t.assigned_to = auth.uid())
    )
  );

-- ---------- task_events (read only via RLS; writes via service role/Edge) ----------
drop policy if exists te_select on public.task_events;
create policy te_select on public.task_events
  for select using (
    exists(
      select 1 from public.tasks t
       where t.id = task_events.task_id
         and (public.app_role() = 'super_admin'
              or public.is_company_member(t.company_id))
    )
  );

-- =====================================================================
-- Enable Realtime on the relevant tables
-- =====================================================================
-- (run this once - it adds the tables to the supabase_realtime publication)
do $$ begin
  perform 1 from pg_publication where pubname = 'supabase_realtime';
  if found then
    execute 'alter publication supabase_realtime add table public.tasks';
    execute 'alter publication supabase_realtime add table public.task_messages';
  end if;
exception when duplicate_object then null;
end $$;
