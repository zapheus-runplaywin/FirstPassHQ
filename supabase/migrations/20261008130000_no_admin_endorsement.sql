-- Admins no longer endorse injury clearances.
--
-- Matt (2026-10-08): "the admin should not be able to endorse a clearance for
-- an injury. They can accept as a committee member or administrator of the
-- club, that's okay."
--
-- - Only one of the athlete's coaches or a physio can endorse a clearance
--   request. An admin who also coaches the athlete still can, as their coach.
-- - Requests for athletes without a coach now wait for a physio, not an admin.
-- - Admins still accept endorsed clearances (they count as committee), and
--   still send back requests, as before.
--
-- Additive only: replaced functions. No rows change. A request an admin
-- already endorsed stays endorsed and waits for the committee as before.

begin;

create or replace function public.endorse_clearance(p_injury_id uuid, p_notes text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_injury public.injuries;
begin
  select * into v_injury from public.injuries where id = p_injury_id for update;
  if v_injury.id is null
    or not (public.coaches_athlete(v_injury.athlete_id) or public.is_physio()) then
    raise exception 'Only the athlete’s coaches or a physio can endorse clearance';
  end if;
  if v_injury.status <> 'clearance_requested' then
    raise exception 'This injury isn’t waiting for a coach or physio';
  end if;
  if v_injury.athlete_id = auth.uid() then
    raise exception 'You can’t endorse your own clearance';
  end if;

  update public.injuries
  set status = 'coach_endorsed', coach_endorsed_by = auth.uid(), coach_endorsed_at = now()
  where id = p_injury_id;

  insert into public.injury_updates (injury_id, author_id, author_name, kind, notes)
  values (
    p_injury_id, auth.uid(), public.my_display_name(), 'coach_endorsed', nullif(trim(p_notes), '')
  );
end;
$$;

revoke execute on function public.endorse_clearance(uuid, text) from public, anon;
grant execute on function public.endorse_clearance(uuid, text) to authenticated;

-- Same as before, without the admin fallback for athletes who have no coach.
create or replace function public.visible_injuries(
  p_include_cleared boolean default false,
  p_injury_id uuid default null
)
returns table (
  id uuid,
  athlete_id uuid,
  athlete_name text,
  body_area text,
  description text,
  injured_on date,
  restrictions text,
  expected_return date,
  status public.injury_status,
  coach_endorsed_by uuid,
  cleared_at timestamptz,
  created_at timestamptz,
  last_update_at timestamptz,
  can_report boolean,
  waiting_for_me boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    i.id, i.athlete_id,
    coalesce(nullif(p.full_name, ''), p.email, i.athlete_name),
    i.body_area,
    i.description, i.injured_on, i.restrictions, i.expected_return, i.status,
    i.coach_endorsed_by, i.cleared_at, i.created_at,
    (select max(u.created_at) from public.injury_updates u where u.injury_id = i.id),
    public.can_report_for(i.athlete_id),
    i.athlete_left_at is null and i.athlete_id <> auth.uid() and (
      (i.status = 'clearance_requested'
        and (public.coaches_athlete(i.athlete_id) or public.is_physio()))
      or (i.status = 'coach_endorsed' and public.is_committee()
        and i.coach_endorsed_by is distinct from auth.uid())
    )
  from public.injuries i
  left join public.profiles p on p.id = i.athlete_id
  where public.can_view_athlete_injuries(i.athlete_id)
    and (p_include_cleared or i.status <> 'cleared' or i.id = p_injury_id)
    and (p_include_cleared or i.athlete_left_at is null or i.id = p_injury_id)
    and (p_injury_id is null or i.id = p_injury_id)
  order by i.status = 'cleared', i.created_at desc;
$$;

revoke execute on function public.visible_injuries(boolean, uuid) from public, anon;
grant execute on function public.visible_injuries(boolean, uuid) to authenticated;

commit;
