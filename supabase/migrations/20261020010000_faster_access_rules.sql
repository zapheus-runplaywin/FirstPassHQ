-- Faster access rules at club size.
--
-- Row level security runs a policy once for every row a query looks at.
-- At 200 members, a coach reading every attendance mark took over a second
-- and every check-in about half a second, because each row re-ran the same
-- checks on who the viewer is. Nothing here changes who sees what:
--
-- 1. Checks that depend only on the viewer (auth.uid(), is_admin(),
--    is_approved() and the like) are wrapped as (select ...), so Postgres
--    works them out once per query instead of once per row. This is
--    Supabase's own advice for policies.
-- 2. Check-ins, attendance registers and attendance marks are checked
--    against the set of athletes or registers the viewer may see, worked
--    out once per query by the functions below. Each function applies the
--    same rule as before (can_view_check_ins, can_see_attendance_session's
--    conditions) to every row it could possibly be true for.
--
-- supabase/tests/access-rule-speed.sql checks that every sample member sees
-- exactly the rows the old per-row rules give.

begin;

-- The athletes whose check-ins the signed-in member may see: can_view_check_ins
-- run only for themselves, the children they're linked to and the athletes in
-- groups they coach, since it can't be true for anyone else.
create or replace function public.visible_check_in_athletes()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select c.id
  from (
    select auth.uid() as id
    union
    select g.athlete_id from public.guardianships g where g.guardian_id = auth.uid()
    union
    select athlete.profile_id
    from public.team_members coach
    join public.team_members athlete on athlete.team_id = coach.team_id
    where coach.profile_id = auth.uid() and coach.team_role = 'coach' and athlete.team_role = 'athlete'
  ) c
  where c.id is not null and public.can_view_check_ins(c.id);
$$;

revoke execute on function public.visible_check_in_athletes() from public, anon;
grant execute on function public.visible_check_in_athletes() to authenticated;

-- The attendance registers the signed-in member may see: the same conditions
-- as can_see_attendance_session, with the checks on the viewer worked out
-- once. The group checks run only for groups the member coaches or manages,
-- since can_view_team_attendance and leads_group need that (or the
-- committee, who see every register anyway).
create or replace function public.visible_attendance_sessions()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  with viewer as materialized (
    select public.is_committee() as committee, public.is_attendance_taker() as taker, auth.uid() as id
  ),
  groups as materialized (
    select g.team_id
    from (
      select distinct tm.team_id
      from public.team_members tm, viewer v
      where tm.profile_id = v.id and tm.team_role in ('coach', 'manager')
    ) g
    where public.can_view_team_attendance(g.team_id) or public.leads_group(g.team_id)
  )
  select s.id
  from public.attendance_sessions s, viewer v
  where v.committee
    or (s.taken_by = v.id and v.taker)
    or (s.club_wide and v.taker)
    or (s.team_id is not null and s.team_id in (select team_id from groups));
$$;

revoke execute on function public.visible_attendance_sessions() from public, anon;
grant execute on function public.visible_attendance_sessions() to authenticated;

alter policy "Athletes, guardians, coaches and admins see check-ins" on public.check_ins
  using (athlete_id in (select public.visible_check_in_athletes()));

alter policy "Coaches, managers and the committee see attendance sessions" on public.attendance_sessions
  using (id in (select public.visible_attendance_sessions()));

alter policy "Coaches, managers and the committee see attendance marks" on public.attendance_marks
  using (session_id in (select public.visible_attendance_sessions()));

-- Checks on the viewer, once per query.

alter policy "Admins add absence reasons" on public.absence_categories
  with check ((select public.is_admin()));

alter policy "Admins change absence reasons" on public.absence_categories
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

alter policy "Members see absence reasons" on public.absence_categories
  using ((select public.is_approved()));

alter policy "Members see their own ballots" on public.award_ballots
  using ((voter_id = (select auth.uid())));

alter policy "Members see award candidates" on public.award_candidates
  using ((select public.is_approved()));

alter policy "Members see award groups" on public.award_groups
  using ((select public.is_approved()));

alter policy "Members see their own votes" on public.award_votes
  using ((EXISTS ( SELECT 1
   FROM public.award_ballots b
  WHERE ((b.id = award_votes.ballot_id) AND (b.voter_id = (select auth.uid()))))));

alter policy "Members see awards" on public.awards
  using ((select public.is_approved()));

alter policy "Admins manage calendars" on public.calendars
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

alter policy "Members see club, committee and team calendars" on public.calendars
  using (((select public.is_admin()) OR ((team_id IS NULL) AND (NOT committee_only) AND (select public.is_approved())) OR ((team_id IS NULL) AND committee_only AND (select public.is_committee())) OR ((team_id IS NOT NULL) AND public.is_team_member(team_id))));

alter policy "Members see club captains" on public.club_captains
  using ((select public.is_approved()));

alter policy "Members see their teams' fixtures" on public.fixtures
  using (((select public.is_admin()) OR ((team_id IS NOT NULL) AND (select public.is_approved()) AND public.is_team_member(team_id))));

alter policy "Statisticians see fixtures" on public.fixtures
  using ((select public.is_statistician()));

alter policy "Paired members see the game's events" on public.game_events
  using (((select public.is_admin()) OR (public.is_game_member(game_id) AND ((stream = 'primary'::text) OR (stream = ('shadow:'::text || ((select auth.uid()))::text))))));

alter policy "Members see who paired with their games" on public.game_members
  using (((profile_id = (select auth.uid())) OR public.may_view_game(game_id)));

alter policy "Paired members see the game's snapshots" on public.game_snapshots
  using (((select public.is_admin()) OR public.is_game_member(game_id)));

alter policy "Admins see guardian link history" on public.guardianship_history
  using ((select public.is_admin()));

alter policy "Guardians, their athletes and admins see guardianships" on public.guardianships
  using (((guardian_id = (select auth.uid())) OR (athlete_id = (select auth.uid())) OR (select public.is_admin())));

alter policy "Recipients, senders and admins see receipts" on public.message_recipients
  using ((((profile_id = (select auth.uid())) AND public.is_message_recipient(message_id)) OR (select public.is_admin()) OR public.is_message_sender(message_id)));

alter policy "Senders, recipients and admins see messages" on public.messages
  using ((((sender_id = (select auth.uid())) AND (NOT (select public.is_stood_down()))) OR (select public.is_admin()) OR public.is_message_recipient(id)));

alter policy "Approved members add their own tasks" on public.personal_tasks
  with check (((profile_id = (select auth.uid())) AND (select public.is_approved())));

alter policy "Members change their own tasks" on public.personal_tasks
  using ((profile_id = (select auth.uid())))
  with check (((profile_id = (select auth.uid())) AND (select public.is_approved())));

alter policy "Members delete their own tasks" on public.personal_tasks
  using ((profile_id = (select auth.uid())));

alter policy "Members see their own tasks" on public.personal_tasks
  using ((profile_id = (select auth.uid())));

alter policy "Admins see PlayHQ competitions" on public.playhq_seasons
  using ((select public.is_admin()));

alter policy "Admins see PlayHQ teams" on public.playhq_teams
  using ((select public.is_admin()));

alter policy "Members and admins see policy acknowledgements" on public.policy_acknowledgements
  using (((profile_id = (select auth.uid())) OR (select public.is_admin())));

alter policy "Users see their own profile" on public.profiles
  using (((id = (select auth.uid())) OR (select public.is_admin())));

alter policy "Members see their own push tokens" on public.push_tokens
  using ((profile_id = (select auth.uid())));

alter policy "Admins see screening notices" on public.screening_notices
  using ((select public.is_admin()));

alter policy "Admins see stand-downs" on public.stand_downs
  using ((select public.is_admin()));

alter policy "Group members and admins see group captains" on public.team_captains
  using (((select public.is_admin()) OR public.is_team_member(team_id)));

alter policy "Admins manage team memberships" on public.team_members
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

alter policy "Users see their own team memberships" on public.team_members
  using (((profile_id = (select auth.uid())) OR (select public.is_admin())));

alter policy "Admins manage teams" on public.teams
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

alter policy "Members see training requirement groups" on public.training_requirement_teams
  using ((select public.is_approved()));

alter policy "Members see training requirements" on public.training_requirements
  using ((select public.is_approved()));

alter policy "Volunteers and admins see exemptions" on public.volunteer_exemptions
  using (((profile_id = (select auth.uid())) OR (select public.is_admin())));

commit;
