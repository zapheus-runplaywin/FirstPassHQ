-- The database lets each member read only what the app shows their role
-- (Matt, 21 November 2026: "lock down the database access in line with the
-- Role Based Access in the app itself").
--
-- An audit compared every table the app can reach (54) and every function a
-- signed-in member can call (417, of which the app uses 311) with the app's
-- route guards (src/lib/route-access.ts and src/app/_layout.tsx). Almost
-- everything already matched. The concerns register was already limited to
-- admins and the two safeguarding officers: is_admin() is the admin role
-- only, and the committee is is_committee(). (The comment in
-- 20261121100000_message_archive_and_access.sql that says the committee
-- counts as admins in the database is wrong; it can't be edited because it
-- has merged.)
--
-- What didn't match, and changes here:
--
-- 1. Awards. Any approved member could read every award, its squads and teams
--    and its listed names straight from the tables, although the app shows
--    them only on the admin award screens and the award results report.
--    Voters never read the tables: award_slots(), award_nominees() and
--    save_award_ballot() run as the database and are unchanged. Now admins,
--    and committee members who can read the governance reports, read them.
--
-- 2. Integrity training. Any approved member could read every training
--    requirement and its squads and teams, although the app shows them only
--    to the committee and admins (Training progress, the training settings
--    and the integrity report). Members see their own training through
--    my_training(), which is unchanged. Now the committee and admins read
--    them, the same rule as checking certificates.
--
-- 3. Two compliance checks any member could call for anyone:
--    has_acknowledged_policies(member) and volunteer_covered(member, from,
--    to). Only admin_save_member() and admin_set_volunteer_details() use them,
--    and those run as the database, so members no longer call them directly.
--
-- Left open on purpose: the club's absence reasons, club captains, calendars
-- and teams, which every member's screens use and which hold no personal
-- details.
--
-- Only policies and permissions change. No rows are touched.

begin;

-- 1. Awards: admins and committee members who can read reports.
drop policy if exists "Members see awards" on public.awards;
drop policy if exists "Report readers see awards" on public.awards;
create policy "Report readers see awards" on public.awards
  for select to authenticated
  using ((select public.can_read_reports()));

drop policy if exists "Members see award groups" on public.award_groups;
drop policy if exists "Report readers see award groups" on public.award_groups;
create policy "Report readers see award groups" on public.award_groups
  for select to authenticated
  using ((select public.can_read_reports()));

drop policy if exists "Members see award candidates" on public.award_candidates;
drop policy if exists "Report readers see award candidates" on public.award_candidates;
create policy "Report readers see award candidates" on public.award_candidates
  for select to authenticated
  using ((select public.can_read_reports()));

-- 2. Integrity training: the committee and admins.
drop policy if exists "Members see training requirements" on public.training_requirements;
drop policy if exists "Committee sees training requirements" on public.training_requirements;
create policy "Committee sees training requirements" on public.training_requirements
  for select to authenticated
  using ((select public.is_committee()));

drop policy if exists "Members see training requirement groups" on public.training_requirement_teams;
drop policy if exists "Committee sees training requirement groups" on public.training_requirement_teams;
create policy "Committee sees training requirement groups" on public.training_requirement_teams
  for select to authenticated
  using ((select public.is_committee()));

-- 3. Compliance checks used only inside functions that run as the database.
revoke execute on function public.has_acknowledged_policies(uuid) from public, anon, authenticated;
revoke execute on function public.volunteer_covered(uuid, date, date) from public, anon, authenticated;

commit;
