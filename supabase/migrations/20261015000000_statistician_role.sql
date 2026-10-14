-- Adds the Statistician role.
--
-- Matt (2026-10-14): live game stats are recorded on a tablet in FirstPass
-- Vantage and watched by coaches in FirstPass Vision, against this club's
-- own database. A statistician records games; what the role can do is set
-- in the next migration, because a new enum value can't be used in the same
-- transaction that adds it.
--
-- Additive only: one new enum value. No rows change.

alter type public.app_role add value if not exists 'statistician';
