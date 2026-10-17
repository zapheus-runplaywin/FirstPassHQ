-- Personal tasks on the home to-do list.
--
-- Any approved member can add their own tasks, with an optional due date, tick
-- them off, edit and delete them. A task is private to the member who wrote it:
-- nobody else can read it, not their guardians, coaches, the committee or
-- admins. Tasks can't be shared, assigned or sent to anyone, so they add no
-- social features for members under 18.
--
-- Additive only: one new table, its policies and a trigger.

begin;

create table if not exists public.personal_tasks (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  title text not null check (length(btrim(title)) between 1 and 200),
  due_on date,
  -- When the member ticked it off; null while it's still to do.
  done_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists personal_tasks_profile_idx on public.personal_tasks (profile_id);

drop trigger if exists personal_tasks_touch_updated_at on public.personal_tasks;
create trigger personal_tasks_touch_updated_at
  before update on public.personal_tasks
  for each row execute function public.touch_updated_at();

-- Keeps one member from filling the database: at most 100 tasks still to do.
create or replace function public.personal_tasks_limit()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.done_at is null and (
    select count(*) from public.personal_tasks
    where profile_id = new.profile_id and done_at is null and id <> new.id
  ) >= 100 then
    raise exception 'You have 100 tasks to do already. Tick some off or delete them first.';
  end if;
  return new;
end;
$$;

drop trigger if exists personal_tasks_limit on public.personal_tasks;
create trigger personal_tasks_limit
  before insert or update of done_at on public.personal_tasks
  for each row execute function public.personal_tasks_limit();

alter table public.personal_tasks enable row level security;

revoke all on table public.personal_tasks from anon;
grant select, insert, update, delete on table public.personal_tasks to authenticated;

-- Only the member who wrote a task can see or change it. There is no admin
-- policy on purpose.
drop policy if exists "Members see their own tasks" on public.personal_tasks;
create policy "Members see their own tasks"
  on public.personal_tasks for select to authenticated
  using (profile_id = auth.uid());

drop policy if exists "Approved members add their own tasks" on public.personal_tasks;
create policy "Approved members add their own tasks"
  on public.personal_tasks for insert to authenticated
  with check (profile_id = auth.uid() and public.is_approved());

drop policy if exists "Members change their own tasks" on public.personal_tasks;
create policy "Members change their own tasks"
  on public.personal_tasks for update to authenticated
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid() and public.is_approved());

drop policy if exists "Members delete their own tasks" on public.personal_tasks;
create policy "Members delete their own tasks"
  on public.personal_tasks for delete to authenticated
  using (profile_id = auth.uid());

commit;
