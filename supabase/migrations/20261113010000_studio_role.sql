-- Adds the Studio role and a parent's consent to show their child's stats on
-- a live stream.
--
-- Matt (2026-11-13): FirstPass Studio, which makes the graphics for live
-- streams, signs in to each club like a member, with a read-only Studio role,
-- instead of using a key. What the role can read, and the new consent, are set
-- in the next migration, because a new enum value can't be used in the same
-- transaction that adds it.
--
-- Additive only: two new enum values. No rows change.

alter type public.app_role add value if not exists 'studio';
alter type public.consent_kind add value if not exists 'publish';
