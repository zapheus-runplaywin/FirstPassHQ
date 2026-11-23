-- Selection assessments: mark independent selectors (Matt, 24 November 2026).
--
-- A club can already put a guest with a current Working With Children Check
-- on a round's panel, which is how it adds a selector from outside the club.
-- Nothing said so once they were on it. The round's panel and the Selection
-- audit report now carry "independent" for each panel member: a guest who
-- holds no other role in the club and is in no squad or team.
--
-- It is worked out when the round or report is read, not stored: a guest who
-- later becomes a coach stops being shown as independent.
--
-- Functions only: no table, column or row changes. admin_selection_rounds and
-- admin_selection_audit are as they were in 20261123100000, with the one
-- added key in each panel member.

begin;

-- True for a guest with no other role and no squad or team: someone from
-- outside the club. Used only inside the two admin functions below.
create or replace function public.is_independent_selector(p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = p_profile_id
      and p.role = 'guest'
      and coalesce(cardinality(p.extra_roles), 0) = 0
      and not exists (select 1 from public.team_members m where m.profile_id = p.id)
  );
$$;
revoke execute on function public.is_independent_selector(uuid) from public, anon, authenticated;

-- Every round, newest first, with its panel as it stands and as it changed.
-- Counts only: an admin sees how many observations there are, never one.
create or replace function public.admin_selection_rounds()
returns table (
  id uuid,
  team_id uuid,
  team_name text,
  season integer,
  name text,
  starts_on date,
  ends_on date,
  closed_at timestamptz,
  created_at timestamptz,
  athletes integer,
  observations integer,
  panel jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() or not public.selection_assessments_on() then
    raise exception 'Only admins can see the selection rounds';
  end if;
  return query
  select r.id, r.team_id, coalesce(t.name, r.team_name), r.season, r.name, r.starts_on, r.ends_on,
    r.closed_at, r.created_at,
    (select count(*)::int from public.team_members m
      where m.team_id = r.team_id and m.team_role = 'athlete'),
    (select count(*)::int from public.assessment_observations o where o.round_id = r.id),
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'profile_id', m.profile_id,
        'name', coalesce(public.member_display_name(m.profile_id), m.profile_name),
        'added_at', m.added_at,
        'added_by_name', m.added_by_name,
        'removed_at', m.removed_at,
        'removed_by_name', m.removed_by_name,
        'declared_conflict', exists (
          select 1 from public.conflict_declarations d
          where d.profile_id = m.profile_id and d.season = r.season and d.has_conflict
        ),
        'can_assess', m.profile_id is not null and public.can_join_selection_panel(m.profile_id),
        'independent', m.profile_id is not null and public.is_independent_selector(m.profile_id),
        'own_children', (
          select count(*)::int
          from public.guardianships g
          join public.team_members a on a.profile_id = g.athlete_id
            and a.team_id = r.team_id and a.team_role = 'athlete'
          where g.guardian_id = m.profile_id
        )
      ) order by (m.removed_at is not null), m.added_at, m.profile_name)
      from public.selection_round_panel m where m.round_id = r.id
    ), '[]'::jsonb)
  from public.selection_rounds r
  left join public.teams t on t.id = r.team_id
  order by (r.closed_at is not null), r.starts_on desc, r.created_at desc;
end;
$$;
revoke execute on function public.admin_selection_rounds() from public, anon;
grant execute on function public.admin_selection_rounds() to authenticated;

-- How a round's work was done, for admins. Counts and dates only: no
-- ratings, no evidence text and no names of criteria. Building it for a
-- round with under 18s goes in each child's record views.
create or replace function public.admin_selection_audit(p_round_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_round public.selection_rounds;
  v_groups int;
  v_athletes int;
  v_child uuid;
begin
  if not public.is_admin() or not public.selection_assessments_on() then
    raise exception 'Only admins can build the selection audit report';
  end if;
  select * into v_round from public.selection_rounds r where r.id = p_round_id;
  if v_round.id is null then
    raise exception 'Round not found';
  end if;
  v_groups := jsonb_array_length(v_round.criteria -> 'groups');
  select count(*)::int into v_athletes
  from public.team_members m where m.team_id = v_round.team_id and m.team_role = 'athlete';

  for v_child in
    select m.profile_id from public.team_members m
    where m.team_id = v_round.team_id and m.team_role = 'athlete'
  loop
    perform public.write_record_access(v_child, 'assessment_audit', p_round_id);
  end loop;

  return jsonb_build_object(
    'round', jsonb_build_object(
      'id', v_round.id,
      'name', v_round.name,
      'team_name', coalesce((select t.name from public.teams t where t.id = v_round.team_id), v_round.team_name),
      'season', v_round.season,
      'starts_on', v_round.starts_on,
      'ends_on', v_round.ends_on,
      'opened_at', v_round.created_at,
      'opened_by_name', v_round.created_by_name,
      'closed_at', v_round.closed_at,
      'closed_by_name', public.member_display_name(v_round.closed_by),
      'criteria_groups', v_groups,
      'criteria_items', (select count(*)::int from public.selection_round_items(p_round_id)),
      'athletes', v_athletes,
      'observations', (select count(*)::int from public.assessment_observations o where o.round_id = p_round_id),
      'today', public.club_today()
    ),
    'panel', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', coalesce(public.member_display_name(m.profile_id), m.profile_name),
        'added_at', m.added_at,
        'added_by_name', m.added_by_name,
        'removed_at', m.removed_at,
        'removed_by_name', m.removed_by_name,
        'declared_conflict', exists (
          select 1 from public.conflict_declarations d
          where d.profile_id = m.profile_id and d.season = v_round.season and d.has_conflict
        ),
        'can_assess', m.profile_id is not null and public.can_join_selection_panel(m.profile_id),
        'independent', m.profile_id is not null and public.is_independent_selector(m.profile_id),
        'own_children', (
          select count(*)::int
          from public.guardianships g
          join public.team_members a on a.profile_id = g.athlete_id
            and a.team_id = v_round.team_id and a.team_role = 'athlete'
          where g.guardian_id = m.profile_id
        )
      ) order by m.added_at, m.profile_name)
      from public.selection_round_panel m where m.round_id = p_round_id
    ), '[]'::jsonb),
    -- Everyone who is on the panel now or wrote anything, by name.
    'selectors', coalesce((
      select jsonb_agg(to_jsonb(s) - 'profile_id' order by s.name)
      from (
        select
          n.profile_id,
          n.name,
          n.on_panel,
          count(o.id)::int as observations,
          count(distinct o.athlete_id)::int as athletes_covered,
          (
            select count(distinct i.group_key)::int
            from public.assessment_observations o2
            join public.assessment_observation_ratings ra on ra.observation_id = o2.id
            join public.selection_round_items(p_round_id) i on i.item_key = ra.item_key
            where o2.round_id = p_round_id
              and (o2.author_id = n.profile_id
                or (n.profile_id is null and o2.author_id is null and o2.author_name = n.name))
          ) as groups_covered,
          min(o.observed_on) as first_on,
          max(o.observed_on) as last_on,
          count(distinct date_trunc('week', o.observed_on::timestamp))::int as weeks_active,
          count(o.id) filter (where o.context = 'training')::int as training,
          count(o.id) filter (where o.context = 'game')::int as game,
          count(o.id) filter (where o.context = 'trial')::int as trial,
          count(o.id) filter (where o.context = 'other')::int as other,
          count(o.id) filter (where o.note is null)::int as without_evidence,
          count(o.id) filter (where o.observed_on < public.club_day(o.created_at) - 7)::int as written_late,
          count(o.id) filter (where o.corrects_id is not null)::int as corrections
        from (
          select m.profile_id, coalesce(public.member_display_name(m.profile_id), m.profile_name) as name,
            true as on_panel
          from public.selection_round_panel m
          where m.round_id = p_round_id and m.removed_at is null
          union all
          select distinct x.author_id, coalesce(public.member_display_name(x.author_id), x.author_name), false
          from public.assessment_observations x
          where x.round_id = p_round_id
            and not exists (
              select 1 from public.selection_round_panel m
              where m.round_id = p_round_id and m.removed_at is null
                and (m.profile_id = x.author_id
                  or (m.profile_id is null and x.author_id is null and m.profile_name = x.author_name))
            )
        ) n
        left join public.assessment_observations o
          on o.round_id = p_round_id
          and (o.author_id = n.profile_id
            or (n.profile_id is null and o.author_id is null and o.author_name = n.name))
        group by n.profile_id, n.name, n.on_panel
      ) s
    ), '[]'::jsonb),
    'athletes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', public.display_name(p),
        'is_minor', public.is_minor(p.date_of_birth, p.under_17),
        'observations', (
          select count(*)::int from public.assessment_observations o
          where o.round_id = p_round_id and o.athlete_id = p.id
        ),
        'selectors', (
          select count(distinct coalesce(o.author_id::text, o.author_name))::int from public.assessment_observations o
          where o.round_id = p_round_id and o.athlete_id = p.id
        ),
        'groups_covered', (
          select count(distinct i.group_key)::int
          from public.assessment_observations o
          join public.assessment_observation_ratings ra on ra.observation_id = o.id
          join public.selection_round_items(p_round_id) i on i.item_key = ra.item_key
          where o.round_id = p_round_id and o.athlete_id = p.id
        ),
        'last_observed_on', (
          select max(o.observed_on) from public.assessment_observations o
          where o.round_id = p_round_id and o.athlete_id = p.id
        )
      ) order by public.display_name(p))
      from public.team_members m
      join public.profiles p on p.id = m.profile_id
      where m.team_id = v_round.team_id and m.team_role = 'athlete'
    ), '[]'::jsonb)
  );
end;
$$;
revoke execute on function public.admin_selection_audit(uuid) from public, anon;
grant execute on function public.admin_selection_audit(uuid) to authenticated;

commit;
