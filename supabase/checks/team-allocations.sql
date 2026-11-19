-- Team allocations: a read-only check of a live or test database (thread "Fix
-- squad-to-team allocation", 20 November 2026).
--
-- Lists athletes who are in more than one current team (or squad) in the same
-- season, coaches in more than one team, and captains chosen for a squad
-- rather than a team. Run it with scripts/check-team-allocations.sh, which
-- opens a read-only transaction: it cannot change anything, and it prints
-- only counts, member ids and squad or team names, never people's names.
-- Each line is "OK", "FOUND" (rows the one-team rule would refuse if saved
-- again) or "INFO".
\set ON_ERROR_STOP 1
\set VERBOSITY terse
begin transaction read only;
set local client_min_messages = notice;

do $$
declare
  r record;
  n int;
begin
  -- Athletes in more than one current team of a season.
  select count(*) into n from (
    select m.profile_id, t.season
    from public.team_members m
    join public.teams t on t.id = m.team_id and t.kind = 'team' and not t.archived
    where m.team_role = 'athlete'
    group by m.profile_id, t.season
    having count(*) > 1
  ) d;
  raise notice '% athletes in more than one team: %', case when n = 0 then 'OK' else 'FOUND' end, n;
  for r in
    select m.profile_id, t.season,
      string_agg(t.name || ' (' || coalesce(m.selection::text, '-') || ')', ', ' order by t.name) as teams,
      string_agg(distinct coalesce(s.name, 'no squad'), ', ') as squads
    from public.team_members m
    join public.teams t on t.id = m.team_id and t.kind = 'team' and not t.archived
    left join public.teams s on s.id = t.squad_id
    where m.team_role = 'athlete'
    group by m.profile_id, t.season
    having count(*) > 1
    order by t.season, squads
    limit 200
  loop
    raise notice '  athlete % season %: % [squad %]', r.profile_id, r.season, r.teams, r.squads;
  end loop;

  -- Per team, how many of its athletes are also in another team: the
  -- "everyone in every team" pattern shows as most of each team.
  for r in
    select t.season, t.name, coalesce(s.name, 'no squad') as squad,
      count(*) as athletes,
      count(*) filter (where exists (
        select 1 from public.team_members o
        join public.teams ot on ot.id = o.team_id and ot.kind = 'team' and not ot.archived
        where o.profile_id = m.profile_id and o.team_role = 'athlete'
          and ot.season = t.season and ot.id <> t.id
      )) as also_elsewhere
    from public.team_members m
    join public.teams t on t.id = m.team_id and t.kind = 'team' and not t.archived
    left join public.teams s on s.id = t.squad_id
    where m.team_role = 'athlete'
    group by t.season, t.name, s.name
    order by t.season, squad, t.name
  loop
    raise notice 'INFO team % % [squad %]: % athletes, % also in another team',
      r.season, r.name, r.squad, r.athletes, r.also_elsewhere;
  end loop;

  -- Athletes in more than one current squad of a season.
  select count(*) into n from (
    select m.profile_id
    from public.team_members m
    join public.teams t on t.id = m.team_id and t.kind = 'squad' and not t.archived
    where m.team_role = 'athlete'
    group by m.profile_id, t.season
    having count(*) > 1
  ) d;
  raise notice '% athletes in more than one squad: %', case when n = 0 then 'OK' else 'FOUND' end, n;
  for r in
    select m.profile_id, t.season, string_agg(t.name, ', ' order by t.name) as squads
    from public.team_members m
    join public.teams t on t.id = m.team_id and t.kind = 'squad' and not t.archived
    where m.team_role = 'athlete'
    group by m.profile_id, t.season
    having count(*) > 1
    limit 50
  loop
    raise notice '  athlete % season %: %', r.profile_id, r.season, r.squads;
  end loop;

  -- Coaches in more than one current team (allowed; for information).
  select count(*) into n from (
    select m.profile_id
    from public.team_members m
    join public.teams t on t.id = m.team_id and t.kind = 'team' and not t.archived
    where m.team_role = 'coach'
    group by m.profile_id, t.season
    having count(*) > 1
  ) d;
  raise notice 'INFO coaches in more than one team: %', n;

  -- Captains and vice captains chosen for a squad rather than a team.
  select count(*) into n
  from public.team_captains c
  join public.teams t on t.id = c.team_id and t.kind = 'squad' and not t.archived;
  raise notice '% squad captains and vice captains: %', case when n = 0 then 'OK' else 'FOUND' end, n;
  for r in
    select t.season, t.name, c.captain_role, count(*) as people
    from public.team_captains c
    join public.teams t on t.id = c.team_id and t.kind = 'squad' and not t.archived
    group by t.season, t.name, c.captain_role
    order by t.season, t.name
  loop
    raise notice '  squad % %: % %', r.season, r.name, r.people, r.captain_role;
  end loop;

  select count(*) into n
  from public.team_captains c
  join public.teams t on t.id = c.team_id and t.kind = 'team' and not t.archived;
  raise notice 'INFO team captains and vice captains: %', n;
end;
$$;

rollback;
