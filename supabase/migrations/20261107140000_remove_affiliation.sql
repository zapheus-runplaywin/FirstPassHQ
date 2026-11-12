-- Remove Affiliation records (Matt, 7 November 2026). FirstPass HQ is for
-- clubs only: no association records and no reporting up to an association.
-- An association concept, if it comes back, will be designed fresh.
--
-- DATA LOSS, approved by Matt on 7 November 2026 ("Drop them in this PR"),
-- merged only with the data-loss-approved label. These four tables are dropped
-- with every row in them:
-- - affiliation_settings: the single row of affiliation details (incorporation
--   number, affiliated with, registered date, two primary contacts, checklist
--   ticks, notes, return email, club or association, tier);
-- - affiliation_officers: association officers and their induction dates;
-- - playhq_registrations: each member's "registered in PlayHQ" tick per season;
-- - affiliation_returns: the log of yearly returns sent.
-- Nothing else refers to them: no other table has a foreign key to them, and
-- no remaining function reads them.
--
-- conduct_season() used affiliation_season() to find the current season. It
-- keeps exactly the same rule (newest season that isn't archived, else the
-- newest season, else this year), written in place, so affiliation_season()
-- can go too.
--
-- The old "affiliation" key a club may still have in club_settings.features is
-- left alone: the app ignores it, and the next Club settings save clears it.

begin;

create or replace function public.conduct_season()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select max(t.season) from public.teams t where not t.archived),
    (select max(t.season) from public.teams t),
    extract(year from current_date)::int
  );
$$;

revoke execute on function public.conduct_season() from public, anon;
grant execute on function public.conduct_season() to authenticated;

drop function if exists public.admin_affiliation();
drop function if exists public.admin_set_affiliation(text, int, text, text, date, uuid, uuid, jsonb, text);
drop function if exists public.admin_affiliation_officers();
drop function if exists public.admin_set_affiliation_officer(text, uuid, date);
drop function if exists public.admin_playhq_registrations(int);
drop function if exists public.admin_set_playhq_registration(uuid, int, boolean);
drop function if exists public.admin_affiliation_return();
drop function if exists public.admin_set_affiliation_return_email(text);
drop function if exists public.admin_log_affiliation_return(int);
drop function if exists public.can_be_affiliation_contact(uuid);
drop function if exists public.affiliation_season();

drop table if exists public.affiliation_returns;
drop table if exists public.affiliation_officers;
drop table if exists public.playhq_registrations;
drop table if exists public.affiliation_settings;

commit;
