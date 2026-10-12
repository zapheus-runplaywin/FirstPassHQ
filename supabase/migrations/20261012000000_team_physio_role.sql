-- Lets physios be placed in squads and teams.
--
-- Matt (2026-10-12): "Allow physio to be assigned to teams also. Some clubs
-- have a Physio per team." What a physio in a team can do is set in the next
-- migration: a new enum value can't be used in the same transaction that adds
-- it.
--
-- Additive only: one new enum value. No rows change.

alter type public.team_role add value if not exists 'physio';
