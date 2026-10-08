-- Adds the Physio role.
--
-- Matt (2026-10-08): a Physio sees squads and teams, the calendar, check-in
-- averages (never individuals), every injury, and can endorse clearances.
-- What the role can do is set in the next migration: a new enum value can't
-- be used in the same transaction that adds it.
--
-- Additive only: one new enum value. No rows change.

alter type public.app_role add value if not exists 'physio';
