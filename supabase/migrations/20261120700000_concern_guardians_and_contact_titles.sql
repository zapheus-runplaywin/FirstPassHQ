-- Safeguarding contacts get what they need (Matt, 20 November 2026).
--
-- 1. A concern about a child shows the child's verified parents and
--    guardians, with their email, to whoever handles it (the Child Safety
--    Officer, the Complaints Manager and admins), so they know who the right
--    parent is without asking an admin. Each look is kept in the concern's
--    own list of who has seen them, not in the child's record views: parents
--    read those, and a line there would tell a parent a concern exists about
--    their child, which could tip off a parent the concern is about.
-- 2. A member can see which safeguarding posts they hold (Child Safety
--    Officer, Complaints Manager, WWC Registration Officer), shown under
--    their roles on the home screen.
--
-- Additive only: one new table and new functions. No existing rows change.

begin;

create table if not exists public.concern_guardian_views (
  id uuid primary key default gen_random_uuid(),
  concern_id uuid not null references public.concerns (id) on delete cascade,
  viewer_id uuid references public.profiles (id) on delete set null,
  viewer_name text,
  created_at timestamptz not null default now()
);

create index if not exists concern_guardian_views_concern_idx
  on public.concern_guardian_views (concern_id, created_at desc);

alter table public.concern_guardian_views enable row level security;
-- Read and written only through the functions below.
revoke all on public.concern_guardian_views from public, anon, authenticated;
grant all on public.concern_guardian_views to service_role;

-- The verified, approved parents and guardians of the child a concern is
-- about, for those who handle the concern. Nothing when the concern names
-- nobody, names an adult, or the caller doesn't handle it. Each call that
-- shows someone is kept, once per person per concern in 30 minutes so a
-- refresh doesn't flood the list.
create or replace function public.concern_guardians(p_concern_id uuid)
returns table (guardian_id uuid, name text, email text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_child uuid;
begin
  if not coalesce(public.can_handle_concern(p_concern_id), false) then
    return;
  end if;
  select c.about_member_id into v_child
  from public.concerns c
  join public.profiles p on p.id = c.about_member_id
  where c.id = p_concern_id and public.is_minor(p.date_of_birth, p.under_17);
  if v_child is null then
    return;
  end if;

  return query
    select g.id, public.display_name(g), g.email
    from public.guardianships gs
    join public.profiles g on g.id = gs.guardian_id
    where gs.athlete_id = v_child and g.status = 'approved' and g.verified_at is not null
    order by 2, 1;

  if found and not exists (
    select 1 from public.concern_guardian_views v
    where v.concern_id = p_concern_id and v.viewer_id = auth.uid()
      and v.created_at > now() - interval '30 minutes'
  ) then
    insert into public.concern_guardian_views (concern_id, viewer_id, viewer_name)
    values (p_concern_id, auth.uid(), coalesce(public.member_display_name(auth.uid()), 'Member'));
  end if;
end;
$$;

revoke execute on function public.concern_guardians(uuid) from public, anon;
grant execute on function public.concern_guardians(uuid) to authenticated;

-- Who has looked at a concern's parents and guardians, newest first, for
-- those who handle it.
create or replace function public.concern_guardian_views(p_concern_id uuid)
returns table (viewer_name text, created_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select v.viewer_name, v.created_at
  from public.concern_guardian_views v
  where v.concern_id = p_concern_id and public.can_handle_concern(p_concern_id)
  order by v.created_at desc;
$$;

revoke execute on function public.concern_guardian_views(uuid) from public, anon;
grant execute on function public.concern_guardian_views(uuid) to authenticated;

-- The safeguarding posts the signed-in member holds and can act in now: the
-- same rules that decide whether they're shown to members as a contact (an
-- approved adult with a current check, not stood down), and for the WWC
-- Registration Officer, still an admin or on the committee.
create or replace function public.my_safeguarding_posts()
returns table (
  child_safety_officer boolean,
  complaints_manager boolean,
  wwc_registration_officer boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    s.child_safety_officer_id is not distinct from auth.uid() and ok.contact,
    s.complaints_manager_id is not distinct from auth.uid() and ok.contact,
    s.wwc_officer_id is not distinct from auth.uid() and ok.contact and exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and public.roles_of(p.role, p.extra_roles) && array['admin', 'committee']::public.app_role[]
    )
  from public.safeguarding_settings s
  cross join lateral (select public.can_be_safeguarding_contact(auth.uid()) as contact) ok
  where s.id and auth.uid() is not null;
$$;

revoke execute on function public.my_safeguarding_posts() from public, anon;
grant execute on function public.my_safeguarding_posts() to authenticated;

commit;
