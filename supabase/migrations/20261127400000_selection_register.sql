-- Selection rounds, part 4 (reporting and governance, 27 November 2026).
--
-- Two new read-only functions, no new table and no change to an existing
-- function:
--   admin_selection_round_record: which criteria a round used (from the
--     round's own copy), where the set stands now, and every change to the
--     round. Admins and the round's auditors, beside the audit report.
--   admin_selection_register: a season's rounds, panels, auditors, counts,
--     criteria sets and their history. Admins only.
-- Both return staff names, counts and dates only: never an athlete's name or
-- anything a selector wrote, so neither writes a record view.

begin;

create or replace function public.admin_selection_round_record(p_round_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_round public.selection_rounds;
  v_set public.assessment_criteria_sets;
  v_saved public.assessment_criteria_set_events;
begin
  if not public.can_read_selection_audit(p_round_id) then
    raise exception 'Only admins and this round’s auditors can see the audit report';
  end if;
  select * into v_round from public.selection_rounds r where r.id = p_round_id;
  if v_round.id is null then
    raise exception 'Round not found';
  end if;
  if v_round.criteria_set_id is not null then
    select * into v_set from public.assessment_criteria_sets s where s.id = v_round.criteria_set_id;
    select * into v_saved from public.assessment_criteria_set_events e
    where e.set_id = v_round.criteria_set_id and e.version = v_round.criteria_set_version
      and e.kind in ('created', 'saved')
    order by e.at, e.id limit 1;
  end if;

  return jsonb_build_object(
    'criteria', jsonb_build_object(
      'set_name', coalesce(v_round.criteria_set_name,
        (select s.name from public.assessment_criteria_sets s where s.legacy limit 1)),
      'version', v_round.criteria_set_version,
      'saved_at', v_saved.at,
      'saved_by_name', v_saved.by_name,
      'for_label', case when v_set.id is not null then public.criteria_set_for_label(v_set.id) end,
      'groups', jsonb_array_length(coalesce(v_round.criteria -> 'groups', '[]'::jsonb)),
      'items', public.criteria_item_count(v_round.criteria),
      'recommendations', jsonb_array_length(coalesce(v_round.criteria -> 'recommendations', '[]'::jsonb)),
      'set_state', case
        when v_round.criteria_set_id is null then 'legacy'
        when v_set.id is null then 'deleted'
        when v_set.archived_at is not null then 'archived'
        when v_set.version > coalesce(v_round.criteria_set_version, 0) then 'changed'
        else 'same'
      end,
      'set_version', v_set.version
    ),
    'events', coalesce((
      select jsonb_agg(jsonb_build_object('kind', e.kind, 'detail', e.detail, 'by_name', e.by_name, 'at', e.at)
        order by e.at, e.id)
      from public.selection_round_events e where e.round_id = p_round_id
    ), '[]'::jsonb)
  );
end;
$$;
revoke execute on function public.admin_selection_round_record(uuid) from public, anon;
grant execute on function public.admin_selection_round_record(uuid) to authenticated;

create or replace function public.admin_selection_register(p_season integer default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_season integer;
begin
  if not public.is_admin() or not public.selection_assessments_on() then
    raise exception 'Only admins can see the selection register';
  end if;
  v_season := coalesce(p_season,
    (select max(t.season) from public.teams t where not t.archived),
    (select max(r.season) from public.selection_rounds r));

  return jsonb_build_object(
    'season', v_season,
    'today', public.club_today(),
    'seasons', (
      select coalesce(jsonb_agg(x.season order by x.season desc), '[]'::jsonb)
      from (
        select distinct r.season from public.selection_rounds r where r.season is not null
        union select v_season where v_season is not null
      ) x
    ),
    'groups', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', t.id, 'name', t.name, 'kind', t.kind, 'squad_id', t.squad_id,
        'athletes', (select count(*)::int from public.team_members m where m.team_id = t.id and m.team_role = 'athlete')
      ) order by t.sort_order, t.name)
      from public.teams t where t.season = v_season and not t.archived
    ), '[]'::jsonb),
    'rounds', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id,
        'team_id', r.team_id,
        'team_name', coalesce(t.name, r.team_name),
        'name', r.name,
        'phase', r.phase,
        'round_number', r.round_number,
        'starts_on', r.starts_on,
        'ends_on', r.ends_on,
        'last_day', public.selection_round_last_day(r.ends_on, r.closed_at),
        'closed_at', r.closed_at,
        'opened_at', r.created_at,
        'opened_by_name', r.created_by_name,
        'criteria_set_id', r.criteria_set_id,
        'criteria_set_name', coalesce(r.criteria_set_name,
          (select s.name from public.assessment_criteria_sets s where s.legacy limit 1)),
        'criteria_set_version', r.criteria_set_version,
        'set_fits', (
          select case when s.id is null or g.id is null or s.archived_at is not null then null
            else s.for_all or exists (
              select 1 from public.assessment_criteria_set_groups x
              left join public.teams sq on sq.id = g.squad_id
              where x.set_id = s.id
                and (x.team_id in (g.id, g.squad_id)
                  or lower(x.team_name) in (lower(g.name), lower(sq.name)))
            ) end
          from (select 1) one
          left join public.assessment_criteria_sets s on s.id = r.criteria_set_id
          left join public.teams g on g.id = r.team_id
        ),
        'panel', coalesce((
          select jsonb_agg(jsonb_build_object(
            'name', coalesce(public.member_display_name(m.profile_id), m.profile_name),
            'independent', m.profile_id is not null and public.is_independent_selector(m.profile_id)
          ) order by coalesce(public.member_display_name(m.profile_id), m.profile_name))
          from public.selection_round_panel m where m.round_id = r.id and m.removed_at is null
        ), '[]'::jsonb),
        'declared_conflicts', (
          select count(*)::int from public.selection_round_panel m
          where m.round_id = r.id and m.removed_at is null
            and exists (
              select 1 from public.conflict_declarations d
              where d.profile_id = m.profile_id and d.season = r.season and d.has_conflict
            )
        ),
        'auditors', coalesce((
          select jsonb_agg(coalesce(public.member_display_name(a.profile_id), a.profile_name)
            order by coalesce(public.member_display_name(a.profile_id), a.profile_name))
          from public.selection_round_auditors a where a.round_id = r.id and a.removed_at is null
        ), '[]'::jsonb),
        'athletes', (select count(*)::int from public.team_members m where m.team_id = r.team_id and m.team_role = 'athlete'),
        'observations', (select count(*)::int from public.assessment_observations o where o.round_id = r.id),
        'athletes_observed', (
          select count(*)::int from public.team_members m
          where m.team_id = r.team_id and m.team_role = 'athlete'
            and exists (select 1 from public.assessment_observations o where o.round_id = r.id and o.athlete_id = m.profile_id)
        ),
        'summaries_signed', (
          select count(*)::int from public.assessment_summaries s where s.round_id = r.id and s.signed_at is not null
        ),
        'summaries_expected', (
          select coalesce(sum((
            select count(*)::int from public.team_members a
            where a.team_id = r.team_id and a.team_role = 'athlete'
              and a.profile_id is distinct from p.profile_id
              and not exists (
                select 1 from public.guardianships g
                where g.guardian_id = p.profile_id and g.athlete_id = a.profile_id
              )
          )), 0)::int
          from public.selection_round_panel p
          where p.round_id = r.id and p.removed_at is null and p.profile_id is not null
        ),
        'feedback_shared', (
          select count(*)::int from public.assessment_feedback f where f.round_id = r.id and f.shared_at is not null
        ),
        'released', null,
        'clashes', case when r.team_id is null then '[]'::jsonb else coalesce((
          select jsonb_agg(jsonb_build_object('round_name', c.round_name, 'starts_on', c.starts_on, 'last_day', c.last_day))
          from public.selection_round_clashes(r.team_id, r.starts_on,
            public.selection_round_last_day(r.ends_on, r.closed_at), r.id) c
        ), '[]'::jsonb) end
      ) order by coalesce(t.name, r.team_name), r.starts_on)
      from public.selection_rounds r
      left join public.teams t on t.id = r.team_id
      where r.season = v_season
    ), '[]'::jsonb),
    'sets', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id,
        'name', s.name,
        'for_label', public.criteria_set_for_label(s.id),
        'version', s.version,
        'archived_at', s.archived_at,
        'rounds_season', (
          select count(*)::int from public.selection_rounds r
          where r.season = v_season
            and (r.criteria_set_id = s.id or (r.criteria_set_id is null and s.legacy))
        ),
        'rounds_ever', public.criteria_set_rounds(s.id)
      ) order by (s.archived_at is not null), s.name)
      from public.assessment_criteria_sets s
    ), '[]'::jsonb),
    'set_events', coalesce((
      select jsonb_agg(jsonb_build_object(
        'set_name', e.set_name, 'kind', e.kind, 'version', e.version, 'detail', e.detail,
        'by_name', e.by_name, 'at', e.at
      ) order by e.at desc, e.id)
      from public.assessment_criteria_set_events e
    ), '[]'::jsonb),
    'round_events', coalesce((
      select jsonb_agg(jsonb_build_object(
        'round_id', e.round_id, 'kind', e.kind, 'detail', e.detail, 'by_name', e.by_name, 'at', e.at
      ) order by e.at desc, e.id)
      from public.selection_round_events e
      join public.selection_rounds r on r.id = e.round_id
      where r.season = v_season and e.kind <> 'opened'
    ), '[]'::jsonb)
  );
end;
$$;
revoke execute on function public.admin_selection_register(integer) from public, anon;
grant execute on function public.admin_selection_register(integer) to authenticated;

commit;
