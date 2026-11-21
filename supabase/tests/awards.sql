-- Tests for club awards: 20261008010000_fixtures_and_awards.sql,
-- 20261008030000_award_slots_need_nominees.sql, 20261008160000_award_age_limit.sql,
-- 20261008170000_award_min_age.sql, 20261009130000_award_vote_breakdown.sql and
-- 20261017020000_guardians_no_award_votes.sql. Covers admin_save_award,
-- admin_delete_award, admin_set_award_ages, admin_award_missing_birthdays,
-- award_slots, award_nominees, save_award_ballot, award_turnout and
-- award_vote_breakdown. Rules checked: only admins manage awards and see
-- turnout and results; settings lock once anyone votes; nobody votes for
-- themselves; parents and guardians don't vote (a coach who is a parent votes
-- as a coach); votes with nobody to vote for aren't offered; ballots are
-- secret (each member sees only their own, and results never say who voted
-- for whom); age limits. Prints one line per check.
\set ON_ERROR_STOP 0
\pset tuples_only on
\pset format unaligned
-- Supabase grants table access to signed-in users and relies on row level
-- security; the local stubs don't, so do it here.
grant select on public.awards, public.award_groups, public.award_candidates, public.award_ballots,
  public.award_votes to authenticated;
create or replace function pg_temp.as_member(n text) returns void language sql as
$$ select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000' || n, false) $$;
create or replace function pg_temp.ok(label text, actual boolean, expected boolean) returns text language sql as
$$ select case when actual is not distinct from expected then 'PASS ' else 'FAIL ' end || label || ' (got ' || coalesce(actual::text, 'null') || ')' $$;
create or replace function pg_temp.fails(label text, statement text) returns text language plpgsql as
$$ begin execute statement; return 'FAIL ' || label || ' (no error)';
   exception when others then return 'PASS ' || label || ' (' || sqlerrm || ')'; end $$;
create or replace function pg_temp.works(label text, statement text) returns text language plpgsql as
$$ begin execute statement; return 'PASS ' || label;
   exception when others then return 'FAIL ' || label || ' (' || sqlerrm || ')'; end $$;
create or replace function pg_temp.m(n text) returns uuid language sql as
$$ select ('00000000-0000-0000-0000-0000000000' || n)::uuid $$;
create or replace function pg_temp.award(p_name text) returns uuid language sql as
$$ select id from public.awards where name = p_name $$;
-- admin_save_award with the usual settings filled in.
create or replace function pg_temp.save_award(
  p_id uuid, p_name text, p_club_wide boolean, p_per_group boolean, p_roles text[],
  p_nominees text, p_points int[], p_groups uuid[] default '{}', p_candidates text[] default '{}',
  p_by_match boolean default false, p_season int default 2026,
  p_closes_at timestamptz default now() + interval '7 days'
) returns uuid language sql as
$$ select public.admin_save_award(p_id, p_season, p_name, ' About it ', p_closes_at, p_club_wide, p_per_group,
     p_roles, p_nominees::public.award_nominees, p_points::smallint[], p_by_match, 48, 0::smallint, null,
     false, p_groups, p_candidates) $$;

-- A squad from last season, and a played match and a future one for the team.
insert into public.teams (id, name, kind, season, sort_order) values
  ('00000000-0000-0000-0000-0000000000a9', 'Old Squad', 'squad', 2025, 9);
insert into public.fixtures (id, team_id, team_name, opponent, round_name, starts_at) values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000a2', 'Sample Team', 'Rockets', 'Round 1', now() - interval '1 hour'),
  ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000a2', 'Sample Team', 'Comets', 'Round 2', now() + interval '3 days');

select pg_temp.ok('anon cannot save awards', has_function_privilege('anon', 'public.admin_save_award(uuid, int, text, text, timestamptz, boolean, boolean, text[], public.award_nominees, smallint[], boolean, int, smallint, timestamptz, boolean, uuid[], text[])', 'execute'), false);
select pg_temp.ok('anon cannot vote', has_function_privilege('anon', 'public.save_award_ballot(uuid, uuid, uuid, boolean, uuid[])', 'execute'), false);
select pg_temp.ok('anon cannot read the breakdown', has_function_privilege('anon', 'public.award_vote_breakdown(uuid)', 'execute'), false);
select pg_temp.ok('members cannot call the voter list directly', has_function_privilege('authenticated', 'public.award_voters(uuid, uuid)', 'execute'), false);
select pg_temp.ok('results never name the voter', pg_get_function_result('public.award_vote_breakdown(uuid)'::regprocedure) !~* 'voter', true);

-- ---------------------------------------------------------------------------
-- Managing awards: admins only
-- ---------------------------------------------------------------------------
select pg_temp.as_member('11');
select pg_temp.fails('coach cannot create an award', $s$ select pg_temp.save_award(null, 'Coach award', true, false, '{athlete}', 'athletes', '{1}') $s$);
select pg_temp.as_member('22');
select pg_temp.fails('committee cannot create an award', $s$ select pg_temp.save_award(null, 'Committee award', true, false, '{athlete}', 'athletes', '{1}') $s$);
select pg_temp.as_member('01');
select pg_temp.works('admin creates a club-wide 3-2-1 award', $s$ select pg_temp.save_award(null, '  Club Champion ', true, false, '{athlete,coach}', 'athletes', '{3,2,1}') $s$);
select pg_temp.ok('award saved with trimmed name and description', (select description = 'About it' and points = '{3,2,1}' and created_by = pg_temp.m('01') from public.awards where name = 'Club Champion'), true);
select pg_temp.fails('award voted on by chosen groups needs groups', $s$ select pg_temp.save_award(null, 'No groups', false, false, '{athlete}', 'athletes', '{1}') $s$);
select pg_temp.fails('groups must be from the award''s season', $s$ select pg_temp.save_award(null, 'Old groups', false, false, '{athlete}', 'athletes', '{1}', '{00000000-0000-0000-0000-0000000000a9}') $s$);
select pg_temp.fails('listed nominees need names', $s$ select pg_temp.save_award(null, 'No names', true, false, '{member}', 'listed', '{1}') $s$);
select pg_temp.fails('changing a missing award refused', $s$ select pg_temp.save_award('00000000-0000-0000-0000-0000000000ee', 'Ghost', true, false, '{athlete}', 'athletes', '{1}') $s$);
select pg_temp.works('admin creates a per-squad award for coaches and managers', $s$ select pg_temp.save_award(null, 'Rising Star', false, true, '{coach,manager}', 'athletes', '{1}', '{00000000-0000-0000-0000-0000000000a1}') $s$);
select pg_temp.ok('per-squad award has its squad', (select count(*) = 1 from public.award_groups where award_id = pg_temp.award('Rising Star') and team_id = pg_temp.m('a1')), true);
select pg_temp.works('admin creates an award only guardians would vote in', $s$ select pg_temp.save_award(null, 'Parents Pick', true, false, '{guardian}', 'athletes', '{1}') $s$);
select pg_temp.works('admin creates an umpire award for every member', $s$ select pg_temp.save_award(null, 'Best Umpire', true, false, '{member}', 'listed', '{1}', '{}', '{Umpire One,Umpire Two}') $s$);
select pg_temp.ok('listed names saved', (select count(*) = 2 from public.award_candidates where award_id = pg_temp.award('Best Umpire')), true);
select pg_temp.works('admin creates a match award for the team', $s$ select pg_temp.save_award(null, 'Player of the Match', false, true, '{athlete,coach}', 'athletes', '{1}', '{00000000-0000-0000-0000-0000000000a2}', '{}', true) $s$);
select pg_temp.works('admin creates an award to remove', $s$ select pg_temp.save_award(null, 'Spare', true, false, '{athlete}', 'athletes', '{1}') $s$);
select pg_temp.as_member('11');
select pg_temp.fails('coach cannot remove an award', format('select public.admin_delete_award(%L)', pg_temp.award('Spare')));
select pg_temp.as_member('01');
select pg_temp.works('admin removes an award nobody voted in', format('select public.admin_delete_award(%L)', pg_temp.award('Spare')));
select pg_temp.ok('award removed', pg_temp.award('Spare') is null, true);

-- Ages.
select pg_temp.as_member('11');
select pg_temp.fails('coach cannot set ages', format('select public.admin_set_award_ages(%L, null, 18::smallint, null)', pg_temp.award('Rising Star')));
select pg_temp.ok('coach gets no missing-birthday count', (select coalesce(public.admin_award_missing_birthdays(pg_temp.award('Rising Star')), 0) = 0), true);
select pg_temp.as_member('01');
select pg_temp.fails('age of 0 refused', format('select public.admin_set_award_ages(%L, 0::smallint, null, null)', pg_temp.award('Rising Star')));
select pg_temp.fails('minimum age must be below the maximum', format('select public.admin_set_award_ages(%L, 18::smallint, 18::smallint, null)', pg_temp.award('Rising Star')));
select pg_temp.fails('ages for a missing award refused', $s$ select public.admin_set_award_ages('00000000-0000-0000-0000-0000000000ee', null, 18::smallint, null) $s$);
select pg_temp.works('admin limits the award to under 18s', format('select public.admin_set_award_ages(%L, null, 18::smallint, %L)', pg_temp.award('Rising Star'), current_date));
select pg_temp.ok('age limit saved', (select nominee_max_age = 18 and nominee_min_age is null and nominee_age_on = current_date from public.awards where id = pg_temp.award('Rising Star')), true);
select pg_temp.ok('no nominees are missing a birthday', public.admin_award_missing_birthdays(pg_temp.award('Rising Star')) = 0, true);
update public.profiles set date_of_birth = null where id = pg_temp.m('32');
select pg_temp.ok('an athlete with no birthday is counted', public.admin_award_missing_birthdays(pg_temp.award('Rising Star')) = 1, true);
select pg_temp.ok('award with no ages counts nobody', public.admin_award_missing_birthdays(pg_temp.award('Club Champion')) = 0, true);
update public.profiles set date_of_birth = current_date - interval '25 years' where id = pg_temp.m('32');

-- ---------------------------------------------------------------------------
-- Who is offered a vote, and who they can vote for
-- ---------------------------------------------------------------------------
select pg_temp.as_member('31');
select pg_temp.ok('athlete is offered the club award', exists (select 1 from public.award_slots() where award_id = pg_temp.award('Club Champion') and not voted), true);
select pg_temp.ok('athlete is not offered the coaches'' award', exists (select 1 from public.award_slots() where award_id = pg_temp.award('Rising Star')), false);
select pg_temp.ok('athlete is not offered a match vote with only themselves to vote for', exists (select 1 from public.award_slots() where award_id = pg_temp.award('Player of the Match')), false);
select pg_temp.ok('athlete cannot vote for themselves', (select array_agg(id) = array[pg_temp.m('32')] from public.award_nominees(pg_temp.award('Club Champion'), null)), true);
select pg_temp.as_member('11');
select pg_temp.ok('coach sees both athletes as nominees', (select count(*) = 2 from public.award_nominees(pg_temp.award('Club Champion'), null)), true);
select pg_temp.ok('under-18 award lists only the under 18', (select array_agg(id) = array[pg_temp.m('31')] from public.award_nominees(pg_temp.award('Rising Star'), pg_temp.m('a1'))), true);
select pg_temp.ok('coach is offered the squad award for the squad', exists (select 1 from public.award_slots() where award_id = pg_temp.award('Rising Star') and team_id = pg_temp.m('a1')), true);
select pg_temp.ok('coach is offered the played match, not the future one', (select array_agg(fixture_id) = array[pg_temp.m('f1')] from public.award_slots() where award_id = pg_temp.award('Player of the Match')), true);
select pg_temp.ok('coach is offered the umpire award', exists (select 1 from public.award_slots() where award_id = pg_temp.award('Best Umpire')), true);
select pg_temp.ok('listed names are the nominees', (select count(*) = 2 and bool_and(is_candidate) from public.award_nominees(pg_temp.award('Best Umpire'), null)), true);
select pg_temp.as_member('41');
select pg_temp.ok('guardian is offered no votes', (select count(*) = 0 from public.award_slots()), true);
select pg_temp.ok('guardian sees no nominees', (select count(*) = 0 from public.award_nominees(pg_temp.award('Club Champion'), null)), true);
select pg_temp.as_member('42');
select pg_temp.ok('coach who is a parent votes as a coach', exists (select 1 from public.award_slots() where award_id = pg_temp.award('Club Champion')), true);
select pg_temp.ok('coach who is a parent is not a guardian voter', exists (select 1 from public.award_slots() where award_id = pg_temp.award('Parents Pick')), false);
select pg_temp.as_member('13');
select pg_temp.ok('manager is offered the squad award only', (select array_agg(award_id) = array[pg_temp.award('Rising Star')] from public.award_slots() where award_id <> pg_temp.award('Best Umpire')), true);
select pg_temp.as_member('14');
select pg_temp.ok('physio is offered no votes', (select count(*) = 0 from public.award_slots()), true);
select pg_temp.as_member('01');
select pg_temp.ok('admin sees the nominee list for any group', (select count(*) = 1 from public.award_nominees(pg_temp.award('Rising Star'), pg_temp.m('a1'))), true);

-- ---------------------------------------------------------------------------
-- Voting
-- ---------------------------------------------------------------------------
select pg_temp.as_member('41');
select pg_temp.fails('guardian cannot vote', format('select public.save_award_ballot(%L, null, null, false, %L)', pg_temp.award('Club Champion'), array[pg_temp.m('31')]));
select pg_temp.fails('guardian cannot vote even when guardians are listed', format('select public.save_award_ballot(%L, null, null, false, %L)', pg_temp.award('Parents Pick'), array[pg_temp.m('31')]));
select pg_temp.fails('guardian cannot vote for umpires', format('select public.save_award_ballot(%L, null, null, false, %L)', pg_temp.award('Best Umpire'), array[(select id from public.award_candidates where name = 'Umpire One')]));
select pg_temp.as_member('14');
select pg_temp.fails('physio cannot vote', format('select public.save_award_ballot(%L, null, null, false, %L)', pg_temp.award('Club Champion'), array[pg_temp.m('31'), pg_temp.m('32')]));
select pg_temp.as_member('11');
select pg_temp.fails('missing award refused', format('select public.save_award_ballot(%L, null, null, false, %L)', pg_temp.m('ee'), array[pg_temp.m('31')]));
select pg_temp.fails('club award takes no team', format('select public.save_award_ballot(%L, %L, null, false, %L)', pg_temp.award('Club Champion'), pg_temp.m('a1'), array[pg_temp.m('31'), pg_temp.m('32')]));
select pg_temp.fails('too few picks refused', format('select public.save_award_ballot(%L, null, null, false, %L)', pg_temp.award('Club Champion'), array[pg_temp.m('31')]));
select pg_temp.fails('same nominee twice refused', format('select public.save_award_ballot(%L, null, null, false, %L)', pg_temp.award('Club Champion'), array[pg_temp.m('31'), pg_temp.m('31')]));
select pg_temp.fails('someone who isn''t a nominee refused', format('select public.save_award_ballot(%L, null, null, false, %L)', pg_temp.award('Club Champion'), array[pg_temp.m('31'), pg_temp.m('13')]));
select pg_temp.ok('a refused ballot leaves nothing behind', (select count(*) = 0 from public.award_ballots), true);
select pg_temp.works('coach votes 3-2-1', format('select public.save_award_ballot(%L, null, null, false, %L)', pg_temp.award('Club Champion'), array[pg_temp.m('31'), pg_temp.m('32')]));
select pg_temp.ok('ballot has first and second place with points', (select array_agg(nominee_id::text || ':' || points order by rank) = array[pg_temp.m('31') || ':3', pg_temp.m('32') || ':2'] from public.award_votes), true);
select pg_temp.works('coach changes their vote', format('select public.save_award_ballot(%L, null, null, false, %L)', pg_temp.award('Club Champion'), array[pg_temp.m('32'), pg_temp.m('31')]));
select pg_temp.ok('still one ballot, votes replaced', (select count(*) = 1 from public.award_ballots) and (select nominee_id = pg_temp.m('32') from public.award_votes where rank = 1), true);
select pg_temp.ok('slot shows the coach has voted', (select voted from public.award_slots() where award_id = pg_temp.award('Club Champion')), true);
select pg_temp.fails('per-squad award needs a squad', format('select public.save_award_ballot(%L, null, null, false, %L)', pg_temp.award('Rising Star'), array[pg_temp.m('31')]));
select pg_temp.fails('per-squad award refuses a team that isn''t one of its groups', format('select public.save_award_ballot(%L, %L, null, false, %L)', pg_temp.award('Rising Star'), pg_temp.m('a2'), array[pg_temp.m('31')]));
select pg_temp.fails('over-age athlete cannot be voted for', format('select public.save_award_ballot(%L, %L, null, false, %L)', pg_temp.award('Rising Star'), pg_temp.m('a1'), array[pg_temp.m('32')]));
select pg_temp.works('coach votes in the squad award', format('select public.save_award_ballot(%L, %L, null, false, %L)', pg_temp.award('Rising Star'), pg_temp.m('a1'), array[pg_temp.m('31')]));
select pg_temp.fails('match award needs a match', format('select public.save_award_ballot(%L, %L, null, false, %L)', pg_temp.award('Player of the Match'), pg_temp.m('a2'), array[pg_temp.m('31')]));
select pg_temp.fails('match vote opens when the match starts', format('select public.save_award_ballot(%L, %L, %L, false, %L)', pg_temp.award('Player of the Match'), pg_temp.m('a2'), pg_temp.m('f2'), array[pg_temp.m('31')]));
select pg_temp.fails('no preseason vote on this award', format('select public.save_award_ballot(%L, %L, null, true, %L)', pg_temp.award('Player of the Match'), pg_temp.m('a2'), array[pg_temp.m('31')]));
select pg_temp.works('coach votes on the played match', format('select public.save_award_ballot(%L, %L, %L, false, %L)', pg_temp.award('Player of the Match'), pg_temp.m('a2'), pg_temp.m('f1'), array[pg_temp.m('31')]));
select pg_temp.works('coach votes for an umpire', format('select public.save_award_ballot(%L, null, null, false, %L)', pg_temp.award('Best Umpire'), array[(select id from public.award_candidates where name = 'Umpire One')]));
select pg_temp.ok('listed-name vote keeps the name, no member', (select candidate_id is not null and nominee_id is null and nominee_name = 'Umpire One' from public.award_votes v join public.award_ballots b on b.id = v.ballot_id where b.award_id = pg_temp.award('Best Umpire')), true);
select pg_temp.as_member('31');
select pg_temp.fails('athlete cannot vote for themselves', format('select public.save_award_ballot(%L, null, null, false, %L)', pg_temp.award('Club Champion'), array[pg_temp.m('31')]));
select pg_temp.fails('athlete match vote with nobody else to vote for refused', format('select public.save_award_ballot(%L, %L, %L, false, %L)', pg_temp.award('Player of the Match'), pg_temp.m('a2'), pg_temp.m('f1'), array[pg_temp.m('31')]));
select pg_temp.works('athlete votes for the other athlete', format('select public.save_award_ballot(%L, null, null, false, %L)', pg_temp.award('Club Champion'), array[pg_temp.m('32')]));
select pg_temp.as_member('42');
select pg_temp.works('coach who is a parent votes', format('select public.save_award_ballot(%L, null, null, false, %L)', pg_temp.award('Club Champion'), array[pg_temp.m('32'), pg_temp.m('31')]));
select pg_temp.as_member('13');
select pg_temp.works('manager votes in the squad award', format('select public.save_award_ballot(%L, %L, null, false, %L)', pg_temp.award('Rising Star'), pg_temp.m('a1'), array[pg_temp.m('31')]));

-- Ballots are secret.
set role authenticated;
select pg_temp.as_member('31');
select pg_temp.ok('athlete sees only their own ballot and vote', (select count(*) = 1 from public.award_ballots) and (select count(*) = 1 from public.award_votes), true);
select pg_temp.as_member('11');
select pg_temp.ok('coach sees only their own four ballots', (select count(*) = 4 and bool_and(voter_id = pg_temp.m('11')) from public.award_ballots), true);
select pg_temp.as_member('01');
select pg_temp.ok('admin cannot read anyone''s ballots', (select count(*) = 0 from public.award_ballots) and (select count(*) = 0 from public.award_votes), true);
select pg_temp.as_member('41');
select pg_temp.ok('guardian cannot read ballots', (select count(*) = 0 from public.award_votes), true);
-- Awards themselves are read only on the admin award screens and the award
-- results report (20261121200000_match_database_access_to_roles.sql); voters
-- get theirs through award_slots and award_nominees, checked above.
select pg_temp.ok('guardian cannot read the awards table', (select count(*) = 0 from public.awards), true);
select pg_temp.as_member('01');
select pg_temp.ok('admin reads every award', (select count(*) = 5 from public.awards), true);
reset role;

-- Settings lock once anyone votes.
select pg_temp.as_member('01');
select pg_temp.fails('points cannot change after votes', format('select pg_temp.save_award(%L, %L, true, false, %L, %L, %L)', pg_temp.award('Club Champion'), 'Club Champion', '{athlete,coach}', 'athletes', '{5,3,1}'));
select pg_temp.fails('voters cannot change after votes', format('select pg_temp.save_award(%L, %L, true, false, %L, %L, %L)', pg_temp.award('Club Champion'), 'Club Champion', '{athlete}', 'athletes', '{3,2,1}'));
select pg_temp.works('name can change after votes', format('select pg_temp.save_award(%L, %L, true, false, %L, %L, %L)', pg_temp.award('Club Champion'), 'Club Champion 2026', '{athlete,coach}', 'athletes', '{3,2,1}'));
select pg_temp.ok('name changed', pg_temp.award('Club Champion 2026') is not null, true);
select pg_temp.fails('ages cannot change after votes', format('select public.admin_set_award_ages(%L, null, 21::smallint, %L)', pg_temp.award('Rising Star'), current_date));
select pg_temp.works('saving the same ages after votes is fine', format('select public.admin_set_award_ages(%L, null, 18::smallint, %L)', pg_temp.award('Rising Star'), current_date));
select pg_temp.fails('award with votes cannot be removed', format('select public.admin_delete_award(%L)', pg_temp.award('Club Champion 2026')));
select pg_temp.works('voted-for listed name is kept when removed from the list', format('select pg_temp.save_award(%L, %L, true, false, %L, %L, %L, %L, %L)', pg_temp.award('Best Umpire'), 'Best Umpire', '{member}', 'listed', '{1}', '{}', '{Umpire Three}'));
select pg_temp.ok('voted name kept, unvoted name dropped, new name added', (select array_agg(name order by name) = array['Umpire One', 'Umpire Three'] from public.award_candidates where award_id = pg_temp.award('Best Umpire')), true);

-- Turnout, for admins.
select pg_temp.ok('turnout: 3 of 5 voters in the club award', (select ballots = 3 and voters = 5 and team_id is null from public.award_turnout(pg_temp.award('Club Champion 2026'))), true);
select pg_temp.ok('turnout: 2 votes in the squad award', (select ballots = 2 and team_id = pg_temp.m('a1') from public.award_turnout(pg_temp.award('Rising Star'))), true);
select pg_temp.ok('turnout: played match listed, future match not', (select array_agg(fixture_id) = array[pg_temp.m('f1')] and sum(ballots) = 1 from public.award_turnout(pg_temp.award('Player of the Match'))), true);
select pg_temp.ok('breakdown is empty while voting is open', (select count(*) = 0 from public.award_vote_breakdown(pg_temp.award('Club Champion 2026'))), true);
select pg_temp.as_member('11');
select pg_temp.ok('coach sees no turnout', (select count(*) = 0 from public.award_turnout(pg_temp.award('Club Champion 2026'))), true);
select pg_temp.as_member('22');
select pg_temp.ok('committee sees no turnout', (select count(*) = 0 from public.award_turnout(pg_temp.award('Club Champion 2026'))), true);

-- After it closes.
update public.awards set closes_at = now() - interval '1 minute' where name = 'Club Champion 2026';
select pg_temp.as_member('11');
select pg_temp.fails('voting closed', format('select public.save_award_ballot(%L, null, null, false, %L)', pg_temp.award('Club Champion 2026'), array[pg_temp.m('31'), pg_temp.m('32')]));
select pg_temp.ok('closed award no longer offered', exists (select 1 from public.award_slots() where award_id = pg_temp.award('Club Champion 2026')), false);
select pg_temp.ok('coach sees no breakdown', (select count(*) = 0 from public.award_vote_breakdown(pg_temp.award('Club Champion 2026'))), true);
select pg_temp.as_member('22');
select pg_temp.ok('committee sees no breakdown', (select count(*) = 0 from public.award_vote_breakdown(pg_temp.award('Club Champion 2026'))), true);
select pg_temp.as_member('01');
select pg_temp.ok('breakdown: older athlete first three times, 9 points', (select votes = 3 and points = 9 from public.award_vote_breakdown(pg_temp.award('Club Champion 2026')) where nominee_key = pg_temp.m('32')::text and rank = 1), true);
select pg_temp.ok('breakdown: junior second twice, 4 points', (select votes = 2 and points = 4 and nominee_name = 'Jordan Junior' from public.award_vote_breakdown(pg_temp.award('Club Champion 2026')) where nominee_key = pg_temp.m('31')::text and rank = 2), true);
select pg_temp.ok('breakdown has two rows', (select count(*) = 2 from public.award_vote_breakdown(pg_temp.award('Club Champion 2026'))), true);
