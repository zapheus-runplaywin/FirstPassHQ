-- Selection assessments: how long a round is kept (Matt, 23 November 2026).
--
-- A selection round, with its panel history, dates and every observation,
-- goes a year after the round ends unless the club chooses longer (up to 7
-- years), and only once an admin has turned on "Remove old records". Nothing
-- is removed by this migration: it adds a setting and the function the
-- nightly clean-up calls.
--
-- A round stays while a concern names anyone assessed in it, like every
-- other record about a member on hold.

begin;

alter table public.club_settings
  add column if not exists retention_assessments_months integer not null default 12
    check (retention_assessments_months between 12 and 84);

-- Months a selection round is kept after it ends, for admins.
create or replace function public.assessment_keep_months()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select retention_assessments_months from public.club_settings where id), 12)
  where public.is_admin();
$$;
revoke execute on function public.assessment_keep_months() from public, anon;
grant execute on function public.assessment_keep_months() to authenticated;

create or replace function public.admin_set_assessment_keep_months(p_months integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.club_settings;
begin
  if not public.is_admin() then
    raise exception 'Only admins can change how long records are kept';
  end if;
  select * into s from public.club_settings where id;
  if not public.retention_choice_ok(p_months, array[12, 24, 36, 60, 84], s.retention_assessments_months) then
    raise exception 'Selection assessments can be kept 1, 2, 3, 5 or 7 years after the round ends';
  end if;
  insert into public.club_settings (id) values (true) on conflict (id) do nothing;
  update public.club_settings
  set retention_assessments_months = p_months,
      retention_updated_by_name = public.member_display_name(auth.uid()),
      retention_updated_at = now()
  where id;
end;
$$;
revoke execute on function public.admin_set_assessment_keep_months(integer) from public, anon;
grant execute on function public.admin_set_assessment_keep_months(integer) to authenticated;

-- The nightly clean-up: rounds that ended (or were closed, when that was
-- later) longer ago than the club keeps them. The panel, dates, observations
-- and ratings go with the round.
create or replace function public.purge_expired_assessments()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.club_settings;
  v_count int := 0;
begin
  select * into s from public.club_settings where id;
  if not found or not s.retention_enabled then
    return jsonb_build_object('enabled', false);
  end if;
  delete from public.selection_rounds r
  where greatest(r.ends_on, coalesce(public.club_day(r.closed_at), r.ends_on))
        < (public.club_today() - make_interval(months => s.retention_assessments_months))::date
    and not exists (
      select 1 from public.assessment_observations o
      where o.round_id = r.id and public.on_legal_hold(o.athlete_id)
    );
  get diagnostics v_count = row_count;
  return jsonb_build_object('enabled', true, 'selection_rounds', v_count);
end;
$$;
revoke execute on function public.purge_expired_assessments() from public, anon, authenticated;
grant execute on function public.purge_expired_assessments() to service_role;

commit;
