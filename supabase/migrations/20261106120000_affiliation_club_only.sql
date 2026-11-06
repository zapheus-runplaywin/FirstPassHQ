-- Affiliation records are for clubs only (Matt, 6 November 2026). Association
-- records (an association's tier, its officers and their safeguarding
-- inductions, section 3 of Netball WA's Membership Policy) come out of the app
-- until associations are designed properly.
--
-- Nothing saved is lost: affiliation_settings keeps its member_type and tier
-- columns and affiliation_officers keeps its rows. Only the functions the app
-- used to read and change them go:
-- - admin_affiliation() no longer returns member_type or tier;
-- - admin_set_affiliation() no longer takes them, and never changes them;
-- - admin_affiliation_officers() and admin_set_affiliation_officer() are
--   removed.
--
-- No rows change.

begin;

-- The old signatures go first, so no overload is left behind.
drop function if exists public.admin_affiliation();
drop function if exists public.admin_set_affiliation(text, int, text, text, date, uuid, uuid, jsonb, text);
drop function if exists public.admin_affiliation_officers();
drop function if exists public.admin_set_affiliation_officer(text, uuid, date);

create or replace function public.admin_affiliation()
returns table (
  incorporation_number text,
  affiliated_with text,
  registered_on date,
  primary_contact_1_id uuid,
  primary_contact_1_name text,
  primary_contact_2_id uuid,
  primary_contact_2_name text,
  checks jsonb,
  notes text,
  updated_at timestamptz,
  updated_by_name text,
  season int,
  team_count int,
  registrations_total int,
  registered int,
  not_registered int
)
language sql
stable
security definer
set search_path = ''
as $$
  with season as (select public.affiliation_season() as s),
  people as (
    -- Athletes, coaches and managers in the season's squads and teams.
    select distinct m.profile_id
    from public.team_members m
    join public.teams t on t.id = m.team_id
    join public.profiles p on p.id = m.profile_id
    where t.season = (select s from season)
      and m.team_role in ('athlete', 'coach', 'manager')
      and p.status = 'approved'
  )
  select
    a.incorporation_number,
    a.affiliated_with,
    a.registered_on,
    a.primary_contact_1_id,
    (select public.display_name(p) from public.profiles p where p.id = a.primary_contact_1_id),
    a.primary_contact_2_id,
    (select public.display_name(p) from public.profiles p where p.id = a.primary_contact_2_id),
    a.checks,
    a.notes,
    a.updated_at,
    (select public.display_name(p) from public.profiles p where p.id = a.updated_by),
    (select s from season),
    (select count(*) from public.teams t
     where t.kind = 'team' and t.season = (select s from season) and not t.archived)::int,
    (select count(*) from people)::int,
    (select count(*) from people x join public.playhq_registrations r
       on r.profile_id = x.profile_id and r.season = (select s from season) and r.registered)::int,
    (select count(*) from people x join public.playhq_registrations r
       on r.profile_id = x.profile_id and r.season = (select s from season) and not r.registered)::int
  from public.affiliation_settings a
  where a.id and public.is_admin();
$$;

revoke execute on function public.admin_affiliation() from public, anon;
grant execute on function public.admin_affiliation() to authenticated;

create or replace function public.admin_set_affiliation(
  p_incorporation_number text,
  p_affiliated_with text,
  p_registered_on date,
  p_primary_contact_1_id uuid,
  p_primary_contact_2_id uuid,
  p_checks jsonb,
  p_notes text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text;
begin
  if not public.is_admin() then
    raise exception 'Only admins can change affiliation records';
  end if;
  if p_registered_on is not null and p_registered_on > current_date then
    raise exception 'The registration date can''t be in the future';
  end if;
  if p_checks is null or jsonb_typeof(p_checks) <> 'object' then
    raise exception 'Checks must be a list of ticks';
  end if;
  for v_key in select jsonb_object_keys(p_checks) loop
    if jsonb_typeof(p_checks -> v_key) <> 'boolean' or length(v_key) > 40 then
      raise exception 'Check % must be ticked or not', v_key;
    end if;
  end loop;
  if (p_primary_contact_1_id is not null and not public.can_be_affiliation_contact(p_primary_contact_1_id))
     or (p_primary_contact_2_id is not null and not public.can_be_affiliation_contact(p_primary_contact_2_id)) then
    raise exception 'Primary contacts must be approved adults';
  end if;
  if p_primary_contact_1_id = p_primary_contact_2_id then
    raise exception 'Choose two different primary contacts';
  end if;

  -- member_type and tier are left as they are.
  update public.affiliation_settings
  set incorporation_number = nullif(trim(p_incorporation_number), ''),
      affiliated_with = nullif(trim(p_affiliated_with), ''),
      registered_on = p_registered_on,
      primary_contact_1_id = p_primary_contact_1_id,
      primary_contact_2_id = p_primary_contact_2_id,
      checks = p_checks,
      notes = nullif(trim(p_notes), ''),
      updated_at = now(),
      updated_by = auth.uid()
  where id;
end;
$$;

revoke execute on function public.admin_set_affiliation(text, text, date, uuid, uuid, jsonb, text) from public, anon;
grant execute on function public.admin_set_affiliation(text, text, date, uuid, uuid, jsonb, text) to authenticated;

commit;
