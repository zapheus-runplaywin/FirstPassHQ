-- Explicit table grants (Matt's decision of 21 October 2026).
--
-- Supabase used to give anon, authenticated and service_role every
-- privilege on each new table in public, and row level security decided
-- who saw which rows. From 30 October 2026 it stops doing that on every
-- project (https://github.com/orgs/supabase/discussions/45329), and projects
-- created since 30 May already work that way. A table without a grant can't
-- be reached from the app at all: PostgREST answers 42501.
--
-- Tables that already exist keep their grants, so on the live and test
-- projects this migration changes nothing. On a project created under the
-- new rule (a new club, or a replacement live project) it gives each table
-- the access it has on live today, replaying every revoke the earlier
-- migrations made, so the app works there too:
--
-- - authenticated gets select, insert, update and delete exactly as it has
--   them now. Row level security still decides which rows. The 21 tables
--   the app reaches only through functions, which earlier migrations
--   revoked, get nothing.
-- - service_role, used by the edge functions, gets every table.
-- - anon (signed-out visitors) gets nothing. The app reads no table before
--   sign-in, and check-migration-security.py already refuses grants to
--   anon. Existing projects keep the anon grants they have.
-- - truncate, references and trigger aren't granted to authenticated: the
--   app never uses them, and truncate skips row level security.
--
-- From now on every new table in public states its own grants in the
-- migration that creates it; check-migration-security.py enforces that.
--
-- Only grants; no rows are read, changed or deleted. Safe to re-run.

begin;

grant select, insert, update, delete on table
  public.affiliation_officers,
  public.affiliation_returns,
  public.affiliation_settings,
  public.attendance_marks,
  public.attendance_sessions,
  public.award_ballots,
  public.award_candidates,
  public.award_groups,
  public.award_votes,
  public.awards,
  public.calendars,
  public.check_ins,
  public.child_consents,
  public.club_captains,
  public.club_settings,
  public.concern_events,
  public.concerns,
  public.fixtures,
  public.game_goal_comments,
  public.game_goals,
  public.guardianship_history,
  public.guardianships,
  public.injuries,
  public.injury_document_events,
  public.injury_photo_declarations,
  public.injury_updates,
  public.message_recipients,
  public.messages,
  public.personal_tasks,
  public.playhq_registrations,
  public.playhq_seasons,
  public.playhq_teams,
  public.policy_acknowledgements,
  public.push_tokens,
  public.safeguarding_settings,
  public.screening_notices,
  public.stand_downs,
  public.team_captains,
  public.team_game_goal_comments,
  public.team_game_goals,
  public.team_members,
  public.teams,
  public.training_certificates,
  public.training_requirement_teams,
  public.training_requirements,
  public.verification_codes,
  public.volunteer_exemptions
to authenticated;

grant select on table
  public.game_events,
  public.game_members,
  public.game_snapshots,
  public.games,
  public.session_plan_files,
  public.session_plan_shares,
  public.session_plans
to authenticated;

grant select, insert, delete on table
  public.profiles
to authenticated;

grant select, insert, update on table
  public.absence_categories
to authenticated;

grant all on all tables in schema public to service_role;

commit;
