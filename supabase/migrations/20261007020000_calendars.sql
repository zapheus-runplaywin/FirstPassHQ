-- Calendars: published ICS links from Microsoft 365. A calendar with no team
-- is club-wide and shown to every approved member; a team calendar is shown to
-- that team's members only.

create table public.calendars (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  url text not null check (url ~* '^(https|webcal)://'),
  team_id uuid references public.teams (id) on delete cascade,
  created_at timestamptz not null default now()
);

create index calendars_team_id_idx on public.calendars (team_id);

create function public.is_approved()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles where id = auth.uid() and status = 'approved'
  );
$$;

revoke execute on function public.is_approved() from public, anon;
grant execute on function public.is_approved() to authenticated;

alter table public.calendars enable row level security;

create policy "Members see club and team calendars"
  on public.calendars for select to authenticated
  using (
    public.is_admin()
    or (team_id is null and public.is_approved())
    or (team_id is not null and public.is_team_member(team_id))
  );

create policy "Admins manage calendars"
  on public.calendars for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
