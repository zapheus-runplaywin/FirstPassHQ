-- Committee calendars: club calendars only the committee (and admins) can see,
-- for meetings and other committee business.

alter table public.calendars
  add column committee_only boolean not null default false,
  add constraint committee_calendars_are_club_wide
    check (not (committee_only and team_id is not null));

create function public.is_committee()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and status = 'approved' and role in ('committee', 'admin')
  );
$$;

revoke execute on function public.is_committee() from public, anon;
grant execute on function public.is_committee() to authenticated;

drop policy "Members see club and team calendars" on public.calendars;

create policy "Members see club, committee and team calendars"
  on public.calendars for select to authenticated
  using (
    public.is_admin()
    or (team_id is null and not committee_only and public.is_approved())
    or (team_id is null and committee_only and public.is_committee())
    or (team_id is not null and public.is_team_member(team_id))
  );
