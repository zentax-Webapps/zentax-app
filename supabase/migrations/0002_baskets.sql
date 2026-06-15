-- =====================================================================
-- Zentax Work Flow - 0002 Baskets
-- Adds "baskets": named, per-company groupings that Admins create to club
-- related tasks together. All members of a company can SEE the baskets and
-- the grouping on tasks; only Admins / Super Admins create or manage them.
--
-- Run AFTER 0001_init.sql. Paste into Supabase SQL Editor or `supabase db push`.
-- =====================================================================

-- ---------- 1. baskets ----------
create table if not exists public.baskets (
  id bigserial primary key,
  company_id bigint not null references public.companies(id) on delete cascade,
  name text not null,
  color text,                       -- optional UI accent (e.g. '#0b6cf6')
  notes text,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id),
  unique (company_id, name)         -- basket names are unique within a company
);
create index if not exists baskets_company_idx on public.baskets(company_id);

-- ---------- 2. tasks.basket_id ----------
alter table public.tasks
  add column if not exists basket_id bigint
    references public.baskets(id) on delete set null;
create index if not exists tasks_basket_idx on public.tasks(basket_id);

-- =====================================================================
-- Integrity: a task's basket must belong to the task's company.
-- =====================================================================
create or replace function public.validate_task_basket()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  basket_company bigint;
begin
  if new.basket_id is null then
    return new;
  end if;
  select company_id into basket_company
    from public.baskets where id = new.basket_id;
  if basket_company is null then
    raise exception 'Basket % does not exist', new.basket_id;
  end if;
  if basket_company <> new.company_id then
    raise exception 'Basket must belong to the same company as the task';
  end if;
  return new;
end $$;

drop trigger if exists tasks_basket_validate on public.tasks;
create trigger tasks_basket_validate
  before insert or update of basket_id, company_id on public.tasks
  for each row execute procedure public.validate_task_basket();

-- =====================================================================
-- RLS
-- =====================================================================
alter table public.baskets enable row level security;

-- All members of the company (office + clients) can read baskets.
drop policy if exists baskets_select on public.baskets;
create policy baskets_select on public.baskets
  for select using (
    public.app_role() = 'super_admin'
    or public.is_company_member(company_id)
  );

-- Only Admins (members of the company) and Super Admins create baskets.
drop policy if exists baskets_insert on public.baskets;
create policy baskets_insert on public.baskets
  for insert with check (
    public.app_role() = 'super_admin'
    or (public.app_role() = 'admin' and public.is_company_member(company_id))
  );

-- Same group may rename / recolor.
drop policy if exists baskets_update on public.baskets;
create policy baskets_update on public.baskets
  for update using (
    public.app_role() = 'super_admin'
    or (public.app_role() = 'admin' and public.is_company_member(company_id))
  );

-- Same group may delete (tasks keep existing - basket_id is set null).
drop policy if exists baskets_delete on public.baskets;
create policy baskets_delete on public.baskets
  for delete using (
    public.app_role() = 'super_admin'
    or (public.app_role() = 'admin' and public.is_company_member(company_id))
  );

-- =====================================================================
-- Realtime (optional - keeps basket lists live)
-- =====================================================================
do $$ begin
  perform 1 from pg_publication where pubname = 'supabase_realtime';
  if found then
    execute 'alter publication supabase_realtime add table public.baskets';
  end if;
exception when duplicate_object then null;
end $$;
