-- Tests for the optional voting start date on awards:
-- 20261126100000_award_voting_opens.sql. Covers admin_set_award_opens,
-- award_slots, save_award_ballot and award_turnout. Rules checked: only
-- admins set the opening time; it must be before the award (and its
-- preseason vote) closes; it locks once anyone has voted; before it, no
-- member of any kind is offered a vote and every ballot is refused in the
-- database; an empty opening time keeps the old behaviour (open at once);
-- for match awards, only matches that start once voting has opened count;
-- parents and guardians still never vote. Prints one line per check.
\set ON_ERROR_STOP 0
\pset tuples_only on
\pset format unaligned
grant select on public.awards, public.award_groups, public.award_candidates, public.award_ballots,
  public.award_votes to authenticated;
create or replace function pg_temp.as_member(n text) returns void language sql as
$$ select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000' || n, false) $$;
create or replace function pg_temp.ok(label text, actual boolean, expected boolean) returns text language sql as
$$ select case when actual is not distinct from expected then 'PASS ' else 'FAIL ' end || label || ' (got ' || coalesce(actual::text, 'null') || ')' $$;
create or replace function pg_temp.fails(label text, statement text) returns text language plpgsql as
$$ begin execute statement; return 'FAIL ' || label || ' (no error)';
   exception when others then return 'PASS ' || label || ' (' || sqlerrm || ')'; end $$;
create or replace function pg_temp.fails_with(label text, statement text, expected text) returns text language plpgsql as
$$ begin execute statement; return 'FAIL ' || label || ' (no error)';
   exception when others then
     return case when sqlerrm = expected then 'PASS ' else 'FAIL ' end || label || ' (' || sqlerrm || ')'; end $$;
create or replace function pg_temp.works(label text, statement text) returns text language plpgsql as
$$ begin execute statement; return 'PASS ' || label;
   exception when others then return 'FAIL ' || label || ' (' || sqlerrm || ')'; end $$;
create or replace function pg_temp.m(n text) returns uuid language sql as
$$ select ('00000000-0000-0000-0000-0000000000' || n)::uuid $$;
create or replace function pg_temp.award(p_name text) returns uuid language sql as
$$ select id from public.awards where name = p_name $$;
create or replace function pg_temp.save_award(
  p_name text, p_club_wide boolean, p_per_group boolean, p_roles text[], p_nominees text,
  p_groups uuid[] default '{}', p_candidates text[] default '{}', p_by_match boolean default false,
  p_preseason_weight int default 0, p_preseason_closes_at timestamptz default null
) returns uuid language sql as
$$ select public.admin_save_award(null, 2026, p_name, '', now() + interval '7 days', p_club_wide, p_per_group,
     p_roles, p_nominees::public.award_nominees, '{1}'::smallint[], p_by_match, 48,
     p_preseason_weight::smallint, p_preseason_closes_at, false, p_groups, p_candidates) $$;
-- A ballot for the club-wide award, for whoever is signed in.
create or replace function pg_temp.vote_umpire(p_award uuid) returns void language sql as
$$ select public.save_award_ballot(p_award, null, null, false,
     array[(select id from public.award_candidates where award_id = p_award and name = 'Umpire One')]) $$;

-- Matches for the team: one played before voting opens, one played since,
-- and one to come.
insert into public.fixtures (id, team_id, team_name, opponent, round_name, starts_at) values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000a2', 'Sample Team', 'Rockets', 'Round 1', now() - interval '20 hours'),
  ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000a2', 'Sample Team', 'Comets', 'Round 2', now() - interval '1 hour'),
  ('00000000-0000-0000-0000-0000000000f3', '00000000-0000-0000-0000-0000000000a2', 'Sample Team', 'Meteors', 'Round 3', now() + interval '3 days');

select pg_temp.ok('anon cannot set when voting opens', has_function_privilege('anon', 'public.admin_set_award_opens(uuid, timestamptz)', 'execute'), false);
select pg_temp.ok('signed-in members can call it (it checks for admins)', has_function_privilege('authenticated', 'public.admin_set_award_opens(uuid, timestamptz)', 'execute'), true);
select pg_temp.ok('opens_at is optional', (select not attnotnull from pg_attribute where attrelid = 'public.awards'::regclass and attname = 'opens_at'), true);

-- ---------------------------------------------------------------------------
-- Setting the opening time: admins only, before it closes
-- ---------------------------------------------------------------------------
select pg_temp.as_member('01');
select pg_temp.works('admin creates an every-member award', $s$ select pg_temp.save_award('Best Umpire', true, false, '{member}', 'listed', '{}', '{Umpire One,Umpire Two}') $s$);
select pg_temp.works('admin creates a club-wide athletes award', $s$ select pg_temp.save_award('Club Champion', true, false, '{athlete,coach,manager,committee,admin,guardian}', 'athletes') $s$);
select pg_temp.works('admin creates a match award with a preseason vote', format($s$ select pg_temp.save_award('Player of the Match', false, true, '{athlete,coach}', 'athletes', '{00000000-0000-0000-0000-0000000000a2}', '{}', true, 20, %L) $s$, now() + interval '5 days'));
select pg_temp.ok('a new award has no opening time', (select bool_and(opens_at is null) from public.awards), true);

select pg_temp.as_member('11');
select pg_temp.fails_with('coach cannot set when voting opens', format('select public.admin_set_award_opens(%L, %L)', pg_temp.award('Best Umpire'), now() + interval '1 day'), 'Only admins can manage awards');
select pg_temp.as_member('13');
select pg_temp.fails_with('manager cannot set when voting opens', format('select public.admin_set_award_opens(%L, %L)', pg_temp.award('Best Umpire'), now() + interval '1 day'), 'Only admins can manage awards');
select pg_temp.as_member('22');
select pg_temp.fails_with('committee cannot set when voting opens', format('select public.admin_set_award_opens(%L, %L)', pg_temp.award('Best Umpire'), now() + interval '1 day'), 'Only admins can manage awards');
select pg_temp.as_member('31');
select pg_temp.fails_with('athlete cannot set when voting opens', format('select public.admin_set_award_opens(%L, %L)', pg_temp.award('Best Umpire'), now() + interval '1 day'), 'Only admins can manage awards');
select pg_temp.as_member('41');
select pg_temp.fails_with('guardian cannot set when voting opens', format('select public.admin_set_award_opens(%L, %L)', pg_temp.award('Best Umpire'), now() + interval '1 day'), 'Only admins can manage awards');
select pg_temp.as_member('14');
select pg_temp.fails_with('physio cannot set when voting opens', format('select public.admin_set_award_opens(%L, %L)', pg_temp.award('Best Umpire'), now() + interval '1 day'), 'Only admins can manage awards');
select pg_temp.ok('nobody but an admin changed it', (select bool_and(opens_at is null) from public.awards), true);

select pg_temp.as_member('01');
select pg_temp.fails_with('a missing award is refused', format('select public.admin_set_award_opens(%L, %L)', pg_temp.m('ee'), now()), 'That award no longer exists');
select pg_temp.fails_with('voting cannot open when it closes', format('select public.admin_set_award_opens(%L, closes_at) from public.awards where name = %L', pg_temp.award('Best Umpire'), 'Best Umpire'), 'Voting must open before it closes');
select pg_temp.fails_with('voting cannot open after it closes', format('select public.admin_set_award_opens(%L, %L)', pg_temp.award('Best Umpire'), now() + interval '8 days'), 'Voting must open before it closes');
select pg_temp.fails_with('voting cannot open after the preseason vote closes', format('select public.admin_set_award_opens(%L, %L)', pg_temp.award('Player of the Match'), now() + interval '6 days'), 'Voting must open before the preseason vote closes');
select pg_temp.works('admin sets voting to open tomorrow', format('select public.admin_set_award_opens(%L, %L)', pg_temp.award('Best Umpire'), now() + interval '1 day'));
select pg_temp.works('admin sets the athletes award to open tomorrow', format('select public.admin_set_award_opens(%L, %L)', pg_temp.award('Club Champion'), now() + interval '1 day'));
select pg_temp.works('admin sets the match award to open tomorrow', format('select public.admin_set_award_opens(%L, %L)', pg_temp.award('Player of the Match'), now() + interval '1 day'));
select pg_temp.ok('opening times saved', (select count(*) = 3 from public.awards where opens_at > now()), true);
select pg_temp.works('saving the award again keeps its opening time', format($s$ select public.admin_save_award(%L, 2026, 'Best Umpire', 'Renamed', now() + interval '7 days', true, false, '{member}', 'listed', '{1}', false, 48, 0::smallint, null, false, '{}', '{Umpire One,Umpire Two}') $s$, pg_temp.award('Best Umpire')));
select pg_temp.ok('opening time kept after saving', (select opens_at > now() and description = 'Renamed' from public.awards where name = 'Best Umpire'), true);

-- ---------------------------------------------------------------------------
-- Before voting opens: no member of any kind is offered a vote or can vote
-- ---------------------------------------------------------------------------
select pg_temp.as_member('01');
select pg_temp.ok('admin is offered no vote before it opens', (select count(*) = 0 from public.award_slots()), true);
select pg_temp.fails_with('admin cannot vote before it opens', format('select pg_temp.vote_umpire(%L)', pg_temp.award('Best Umpire')), 'Voting hasn''t opened yet');
select pg_temp.as_member('11');
select pg_temp.ok('coach is offered no vote before it opens', (select count(*) = 0 from public.award_slots()), true);
select pg_temp.fails_with('coach cannot vote before it opens', format('select pg_temp.vote_umpire(%L)', pg_temp.award('Best Umpire')), 'Voting hasn''t opened yet');
select pg_temp.fails_with('coach cannot vote on a played match before it opens', format('select public.save_award_ballot(%L, %L, %L, false, %L)', pg_temp.award('Player of the Match'), pg_temp.m('a2'), pg_temp.m('f2'), array[pg_temp.m('31')]), 'Voting hasn''t opened yet');
select pg_temp.fails_with('coach cannot cast a preseason vote before it opens', format('select public.save_award_ballot(%L, %L, null, true, %L)', pg_temp.award('Player of the Match'), pg_temp.m('a2'), array[pg_temp.m('31')]), 'Voting hasn''t opened yet');
select pg_temp.as_member('13');
select pg_temp.ok('manager is offered no vote before it opens', (select count(*) = 0 from public.award_slots()), true);
select pg_temp.fails_with('manager cannot vote before it opens', format('select pg_temp.vote_umpire(%L)', pg_temp.award('Best Umpire')), 'Voting hasn''t opened yet');
select pg_temp.as_member('22');
select pg_temp.ok('committee is offered no vote before it opens', (select count(*) = 0 from public.award_slots()), true);
select pg_temp.fails_with('committee cannot vote before it opens', format('select pg_temp.vote_umpire(%L)', pg_temp.award('Best Umpire')), 'Voting hasn''t opened yet');
select pg_temp.as_member('31');
select pg_temp.ok('under-18 athlete is offered no vote before it opens', (select count(*) = 0 from public.award_slots()), true);
select pg_temp.fails_with('under-18 athlete cannot vote before it opens', format('select public.save_award_ballot(%L, null, null, false, %L)', pg_temp.award('Club Champion'), array[pg_temp.m('32')]), 'Voting hasn''t opened yet');
select pg_temp.as_member('32');
select pg_temp.ok('adult athlete is offered no vote before it opens', (select count(*) = 0 from public.award_slots()), true);
select pg_temp.fails_with('adult athlete cannot vote before it opens', format('select pg_temp.vote_umpire(%L)', pg_temp.award('Best Umpire')), 'Voting hasn''t opened yet');
select pg_temp.as_member('42');
select pg_temp.ok('coach who is a parent is offered no vote before it opens', (select count(*) = 0 from public.award_slots()), true);
select pg_temp.as_member('41');
select pg_temp.ok('guardian is offered no vote before it opens', (select count(*) = 0 from public.award_slots()), true);
select pg_temp.fails_with('guardian is refused as a voter, not by the date', format('select pg_temp.vote_umpire(%L)', pg_temp.award('Best Umpire')), 'You can''t vote for this award');
select pg_temp.as_member('14');
select pg_temp.fails_with('physio is refused as a voter, not by the date', format('select pg_temp.vote_umpire(%L)', pg_temp.award('Best Umpire')), 'You can''t vote for this award');
select pg_temp.ok('nothing was recorded before voting opened', (select count(*) = 0 from public.award_ballots), true);

-- ---------------------------------------------------------------------------
-- Once voting opens
-- ---------------------------------------------------------------------------
update public.awards set opens_at = now() - interval '2 hours';
select pg_temp.as_member('11');
select pg_temp.ok('coach is offered the every-member award once open', exists (select 1 from public.award_slots() where award_id = pg_temp.award('Best Umpire')), true);
select pg_temp.ok('coach is offered the match played since it opened, not the one before', (select array_agg(fixture_id) = array[pg_temp.m('f2')] from public.award_slots() where award_id = pg_temp.award('Player of the Match') and not preseason), true);
select pg_temp.ok('coach is offered the preseason vote once open', exists (select 1 from public.award_slots() where award_id = pg_temp.award('Player of the Match') and preseason), true);
select pg_temp.fails_with('coach cannot vote on a match played before voting opened', format('select public.save_award_ballot(%L, %L, %L, false, %L)', pg_temp.award('Player of the Match'), pg_temp.m('a2'), pg_temp.m('f1'), array[pg_temp.m('31')]), 'That match was played before voting opened');
select pg_temp.works('coach votes on the match played since it opened', format('select public.save_award_ballot(%L, %L, %L, false, %L)', pg_temp.award('Player of the Match'), pg_temp.m('a2'), pg_temp.m('f2'), array[pg_temp.m('31')]));
select pg_temp.works('coach casts a preseason vote', format('select public.save_award_ballot(%L, %L, null, true, %L)', pg_temp.award('Player of the Match'), pg_temp.m('a2'), array[pg_temp.m('31')]));
select pg_temp.works('coach votes for an umpire', format('select pg_temp.vote_umpire(%L)', pg_temp.award('Best Umpire')));
select pg_temp.as_member('31');
select pg_temp.works('under-18 athlete votes once open', format('select public.save_award_ballot(%L, null, null, false, %L)', pg_temp.award('Club Champion'), array[pg_temp.m('32')]));
select pg_temp.as_member('22');
select pg_temp.works('committee votes once open', format('select pg_temp.vote_umpire(%L)', pg_temp.award('Best Umpire')));
select pg_temp.as_member('41');
select pg_temp.ok('guardian is still offered no vote once open', (select count(*) = 0 from public.award_slots()), true);
select pg_temp.fails_with('guardian still cannot vote once open', format('select public.save_award_ballot(%L, null, null, false, %L)', pg_temp.award('Club Champion'), array[pg_temp.m('31')]), 'You can''t vote for this award');

select pg_temp.as_member('01');
select pg_temp.ok('turnout leaves out the match played before voting opened', (select array_agg(fixture_id order by starts_at) filter (where fixture_id is not null) = array[pg_temp.m('f2')] from public.award_turnout(pg_temp.award('Player of the Match'))), true);
select pg_temp.ok('turnout still lists the preseason vote', exists (select 1 from public.award_turnout(pg_temp.award('Player of the Match')) where preseason and ballots = 1), true);

-- Once anyone has voted, the opening time is locked.
select pg_temp.fails_with('opening time cannot move after votes', format('select public.admin_set_award_opens(%L, %L)', pg_temp.award('Best Umpire'), now() + interval '1 day'), 'People have voted, so the day voting opens can''t change');
select pg_temp.fails_with('opening time cannot be cleared after votes', format('select public.admin_set_award_opens(%L, null)', pg_temp.award('Best Umpire')), 'People have voted, so the day voting opens can''t change');
select pg_temp.works('saving the same opening time after votes is fine', format('select public.admin_set_award_opens(%L, opens_at) from public.awards where name = %L', pg_temp.award('Best Umpire'), 'Best Umpire'));

-- ---------------------------------------------------------------------------
-- No opening time: open at once, as before
-- ---------------------------------------------------------------------------
select pg_temp.works('admin creates an award with no opening time', $s$ select pg_temp.save_award('Volunteer of the Year', true, false, '{member}', 'listed', '{}', '{Helper One}') $s$);
select pg_temp.works('admin can set and then clear an opening time before votes', format('select public.admin_set_award_opens(%L, %L), public.admin_set_award_opens(%L, null)', pg_temp.award('Volunteer of the Year'), now() + interval '1 day', pg_temp.award('Volunteer of the Year')));
select pg_temp.ok('opening time cleared', (select opens_at is null from public.awards where name = 'Volunteer of the Year'), true);
select pg_temp.as_member('32');
select pg_temp.ok('athlete is offered an award with no opening time at once', exists (select 1 from public.award_slots() where award_id = pg_temp.award('Volunteer of the Year')), true);
select pg_temp.works('athlete votes at once', format('select public.save_award_ballot(%L, null, null, false, %L)', pg_temp.award('Volunteer of the Year'), array[(select id from public.award_candidates where name = 'Helper One')]));

-- After it closes, an opening time doesn't reopen it.
update public.awards set closes_at = now() - interval '1 minute' where name = 'Best Umpire';
select pg_temp.as_member('11');
select pg_temp.ok('a closed award with an opening time is not offered', exists (select 1 from public.award_slots() where award_id = pg_temp.award('Best Umpire')), false);
select pg_temp.fails_with('a closed award with an opening time refuses votes', format('select pg_temp.vote_umpire(%L)', pg_temp.award('Best Umpire')), 'Voting has closed');
