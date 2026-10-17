-- A child under 18 whose only linked parents or guardians aren't verified yet
-- can't accept the code of conduct themselves, and nobody can accept it for
-- them until an admin verifies a guardian. Show that wait to the child and
-- to admins instead of leaving the child silently outstanding.
begin;

-- Whether a member's code of conduct is waiting on a parent or guardian being
-- verified: a child under 18 with a guardian linked but none verified, who is
-- asked to accept this season and hasn't yet. For the member, their parents
-- or guardians and admins.
create or replace function public.conduct_waiting_for_guardian(p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_approved()
    and (p_profile_id = auth.uid() or public.is_guardian_of(p_profile_id) or public.is_admin())
    and public.conduct_by_guardian(p_profile_id)
    and public.conduct_required(p_profile_id)
    and not public.conduct_accepted(p_profile_id)
    and not exists (
      select 1
      from public.guardianships g
      join public.profiles gp on gp.id = g.guardian_id
      where g.athlete_id = p_profile_id and gp.verified_at is not null
    );
$$;

revoke execute on function public.conduct_waiting_for_guardian(uuid) from public, anon;
grant execute on function public.conduct_waiting_for_guardian(uuid) to authenticated;

-- The admin list says when a child is waiting on a guardian's verification.
drop function if exists public.admin_conduct_status();

create function public.admin_conduct_status()
returns table (
  profile_id uuid,
  full_name text,
  role text,
  under_18 boolean,
  accepted_at timestamptz,
  accepted_by_name text,
  waiting_for_guardian boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, public.member_display_name(p.id), p.role::text,
    public.is_minor(p.date_of_birth, p.under_17),
    a.accepted_at, a.accepted_by_name,
    a.accepted_at is null and public.conduct_by_guardian(p.id) and not exists (
      select 1
      from public.guardianships g
      join public.profiles gp on gp.id = g.guardian_id
      where g.athlete_id = p.id and gp.verified_at is not null
    )
  from public.profiles p
  left join public.conduct_acceptances a
    on a.profile_id = p.id and a.season = public.conduct_season()
  where public.is_admin() and public.conduct_required(p.id)
  order by a.accepted_at is not null, 2;
$$;

revoke execute on function public.admin_conduct_status() from public, anon;
grant execute on function public.admin_conduct_status() to authenticated;

commit;
