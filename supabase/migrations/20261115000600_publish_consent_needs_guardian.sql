-- A parent's consent to show their child's stats on a live stream counts
-- only while the child has at least one verified parent or guardian (Matt,
-- cross-product review 2026-11-15).
--
-- The publish consent is given by a verified parent or guardian and stays in
-- force until withdrawn. When every verified guardian left (deleted, or no
-- longer approved or verified) the child is locked, yet Studio kept naming
-- them with their own stats on the strength of a consent nobody at the club
-- could still withdraw (revocation test section 4c).
--
-- has_publish_consent(p_athlete_id) is the publish consent in force AND, for
-- an athlete under 18, at least one approved, verified guardian linked: the
-- same guardian test as is_locked_child. studio_lineup (may_publish) and
-- my_child_consents (publish) use it. Once a verified guardian is linked
-- again the stored consent counts again, until a guardian withdraws it.
--
-- Data and health consent are unchanged: they still use has_child_consent,
-- which this migration doesn't touch. No stored rows change; child_consents
-- keeps every consent as given. Same signatures, so no overloads.

begin;

create or replace function public.has_publish_consent(p_athlete_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.has_child_consent(p_athlete_id, 'publish')
    and (
      not public.athlete_is_minor(p_athlete_id)
      or exists (
        select 1
        from public.guardianships g
        join public.profiles gp on gp.id = g.guardian_id
        where g.athlete_id = p_athlete_id
          and gp.status = 'approved'
          and gp.verified_at is not null
          and 'guardian' = any (public.roles_of(gp.role, gp.extra_roles))
      )
    );
$$;

comment on function public.has_publish_consent(uuid) is
  'Publish consent in force, and for an athlete under 18 at least one approved, verified guardian linked. Data and health consent use has_child_consent.';

revoke execute on function public.has_publish_consent(uuid) from public, anon, authenticated;

create or replace function public.studio_lineup(p_game_id uuid)
returns table (
  profile_id uuid,
  name text,
  selection public.team_selection,
  may_publish boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.can_studio_read_game(p_game_id) then
    raise exception 'Studio can only read live and finished PlayHQ games' using errcode = '42501';
  end if;
  return query
    select tm.profile_id, coalesce(nullif(trim(p.preferred_name), ''), p.full_name), tm.selection,
           public.has_publish_consent(tm.profile_id)
    from public.games g
    join public.team_members tm on tm.team_id = g.team_id and tm.team_role = 'athlete'
    join public.profiles p on p.id = tm.profile_id
    where g.id = p_game_id
      and p.status = 'approved'
    order by
      case tm.selection when 'touring' then 0 when 'training_partner' then 1 else 2 end,
      p.full_name;
end;
$$;

revoke execute on function public.studio_lineup(uuid) from public, anon;
grant execute on function public.studio_lineup(uuid) to authenticated;

create or replace function public.my_child_consents()
returns table (
  athlete_id uuid,
  full_name text,
  data boolean,
  health boolean,
  publish boolean,
  can_consent boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select a.profile_id, a.full_name,
    public.has_child_consent(a.profile_id, 'data'),
    public.has_child_consent(a.profile_id, 'health'),
    public.has_publish_consent(a.profile_id),
    public.is_verified_guardian_of(a.profile_id)
  from public.my_athletes() a;
$$;

revoke execute on function public.my_child_consents() from public, anon;
grant execute on function public.my_child_consents() to authenticated;

commit;
