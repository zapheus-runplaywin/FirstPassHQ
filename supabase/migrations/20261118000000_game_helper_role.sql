-- Adds the helper game role: a second statistician who helps the one
-- recording a game.
--
-- Matt (2026-11-17): the statistician recording a game shouldn't also have to
-- track rolling substitutions and fix mistakes while play goes on. A second
-- statistician, the helper, does those two jobs. What the helper may do is
-- set in the next migration, because a new enum value can't be used in the
-- same transaction that adds it.
--
-- Additive only: one new enum value. No rows change.

alter type public.game_role add value if not exists 'helper';
