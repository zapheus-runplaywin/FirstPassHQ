-- Traffic-light counts for the home screen's Concerns card.
--
-- The people who handle concerns (admins, the Child Safety Officer and the
-- Complaints Manager) see three numbers on the card:
--   red    new:         received and nobody has done anything with it yet
--                       (the same rule as new_concerns_count)
--   orange in progress: not closed, and someone has recorded a note, a
--                       referral or a status change (received with history,
--                       referred, being looked into)
--   green  closed:      closed in the last 28 days
--
-- Counts only, no details, and only concerns the member may handle, so a
-- concern about the member themselves is never counted. Everyone else gets
-- zeros.
--
-- Additive only: one new function.

begin;

create or replace function public.concern_counts()
returns table (new_count integer, in_progress_count integer, closed_recent_count integer)
language sql
stable
security definer
set search_path = ''
as $$
  with mine as (
    select c.status, c.closed_at,
      exists (select 1 from public.concern_events e where e.concern_id = c.id) as acted_on
    from public.concerns c
    where public.can_handle_concern(c.id)
  )
  select
    (count(*) filter (where status = 'received' and not acted_on))::int,
    (count(*) filter (where status <> 'closed' and (status <> 'received' or acted_on)))::int,
    (count(*) filter (where status = 'closed' and closed_at >= now() - interval '28 days'))::int
  from mine;
$$;

revoke execute on function public.concern_counts() from public, anon;
grant execute on function public.concern_counts() to authenticated;

commit;
