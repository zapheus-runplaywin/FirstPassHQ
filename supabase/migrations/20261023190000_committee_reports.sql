-- Committee members with a current check read the club's governance reports
-- (customer review C14, Matt, 23 October 2026: "Read-only for checked
-- committee").
--
-- * can_read_reports(): admins, and committee members screened to work with
--   children (a current check, an application in force or a volunteer
--   exemption: is_cleared), not stood down. A committee member exempted
--   with a reason (such as a treasurer) or still in the committee checks
--   grace period reads none, because the reports name children.
-- * The reports they read: Working With Children Checks, Medical details
--   checks, Integrity training, Attendance and Award results. Under 18s,
--   Injuries, Session plans, Season KPIs and Affiliation stay with admins.
-- * Read only: every change here is a select policy or a read function.
--   Nothing they read lets them change a member, a check or a setting.
-- * report_members() gives the reports approved members without their email
--   addresses, guardian emails, verification notes or rejection reasons,
--   instead of opening every profile to the committee.
--
-- Additive: new functions and select policies, and new versions of seven
-- read functions whose only change is who may call them (admin_wwcc_applications
-- also hides receipt paths from everyone but admins). No rows change.

begin;

create or replace function public.can_read_reports()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_admin()
    or (public.has_role('committee') and public.is_cleared(auth.uid()));
$$;
revoke execute on function public.can_read_reports() from public, anon;
grant execute on function public.can_read_reports() to authenticated;

-- Approved members as the reports need them, without contact details or
-- notes the reports never show.
create or replace function public.report_members()
returns setof public.profiles
language sql
stable
security definer
set search_path = ''
as $$
  select (jsonb_populate_record(
    null::public.profiles,
    to_jsonb(p) - array['email', 'playhq_email', 'guardian_email', 'verification_note',
                        'rejection_reason', 'declared_date_of_birth', 'declared_wwcc_number']
  )).*
  from public.profiles p
  where p.status = 'approved' and public.can_read_reports()
  order by p.full_name, p.id;
$$;
revoke execute on function public.report_members() from public, anon;
grant execute on function public.report_members() to authenticated;

-- What the Working With Children Checks and Medical details checks reports
-- read directly.
drop policy if exists "Report readers see stand-downs" on public.stand_downs;
create policy "Report readers see stand-downs"
  on public.stand_downs for select to authenticated
  using ((select public.can_read_reports()));

drop policy if exists "Report readers see screening notices" on public.screening_notices;
create policy "Report readers see screening notices"
  on public.screening_notices for select to authenticated
  using ((select public.can_read_reports()));

drop policy if exists "Report readers see policy acknowledgements" on public.policy_acknowledgements;
create policy "Report readers see policy acknowledgements"
  on public.policy_acknowledgements for select to authenticated
  using ((select public.can_read_reports()));

drop policy if exists "Report readers see team memberships" on public.team_members;
create policy "Report readers see team memberships"
  on public.team_members for select to authenticated
  using ((select public.can_read_reports()));

-- The same read functions as before, open to report readers.
create or replace function public.admin_volunteer_exemptions()
returns table (
  id uuid,
  profile_id uuid,
  basis public.volunteer_exemption,
  child_id uuid,
  child_name text,
  set_by_name text,
  set_at timestamptz,
  declared_at timestamptz,
  declaration_text text,
  ended_at timestamptz,
  ended_by_name text,
  end_note text,
  valid boolean,
  ends_on date,
  starts_on date,
  event_name text,
  organiser text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    e.id, e.profile_id, e.basis, e.child_id, e.child_name, e.set_by_name, e.set_at,
    e.declared_at, e.declaration_text, e.ended_at, e.ended_by_name, e.end_note,
    coalesce(s.valid, false),
    coalesce(s.ends_on, public.exemption_last_day(e.basis, e.starts_on)),
    e.starts_on, e.event_name, e.organiser
  from public.volunteer_exemptions e
  left join lateral public.volunteer_exemption_state(e.profile_id) s
    on s.exemption_id = e.id
  where public.can_read_reports()
  order by e.ended_at is not null, e.set_at desc;
$$;
revoke execute on function public.admin_volunteer_exemptions() from public, anon;
grant execute on function public.admin_volunteer_exemptions() to authenticated;

create or replace function public.admin_wwc_officer()
returns table (officer_id uuid, officer_name text)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, public.display_name(p)
  from public.safeguarding_settings s
  join public.profiles p on p.id = s.wwc_officer_id
  where s.id and public.can_read_reports();
$$;
revoke execute on function public.admin_wwc_officer() from public, anon;
grant execute on function public.admin_wwc_officer() to authenticated;

create or replace function public.admin_wwcc_applications()
returns table (
  id uuid,
  profile_id uuid,
  member_name text,
  application_number text,
  lodged_on date,
  kind text,
  receipt_path text,
  receipt_name text,
  recorded_at timestamptz,
  recorded_by_name text,
  declared_at timestamptz,
  checked_at timestamptz,
  checked_by_name text,
  check_due_on date,
  lapses_on date,
  status text,
  ended_at timestamptz,
  ended_reason text,
  ended_by_name text,
  end_note text
)
language sql
stable
security definer
set search_path = ''
as $$
  select a.id, a.profile_id,
    coalesce(nullif(p.full_name, ''), p.email, 'Unnamed member'),
    a.application_number, a.lodged_on, a.kind,
    -- Only admins open receipts.
    case when public.is_admin() then a.receipt_path end,
    a.receipt_name,
    a.recorded_at, a.recorded_by_name, a.declared_at, a.checked_at, a.checked_by_name,
    (coalesce(a.checked_at, a.recorded_at) at time zone 'Australia/Perth')::date
      + public.wwcc_application_check_days(),
    (coalesce(a.checked_at, a.recorded_at) at time zone 'Australia/Perth')::date
      + public.wwcc_application_lapse_days(),
    public.wwcc_application_status(a),
    a.ended_at, a.ended_reason, a.ended_by_name, a.end_note
  from public.wwcc_applications a
  join public.profiles p on p.id = a.profile_id
  where public.can_read_reports()
    and (a.ended_at is null or a.ended_at > now() - interval '1 year')
  order by a.ended_at is not null, a.lodged_on desc;
$$;
revoke execute on function public.admin_wwcc_applications() from public, anon;
grant execute on function public.admin_wwcc_applications() to authenticated;

create or replace function public.medical_review_compliance()
returns table (
  athlete_id uuid,
  athlete_name text,
  minor boolean,
  has_verified_guardian boolean,
  teams text,
  has_contacts boolean,
  checked_at timestamptz,
  checked_by_name text,
  due_on date,
  status text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.can_read_reports() then
    raise exception 'Only admins and committee members with a current check can see the medical details check report';
  end if;
  return query
  select p.id,
    coalesce(public.member_display_name(p.id), 'Unnamed member'),
    public.athlete_is_minor(p.id),
    exists (
      select 1 from public.guardianships g
      join public.profiles gp on gp.id = g.guardian_id
      where g.athlete_id = p.id and gp.status = 'approved' and gp.verified_at is not null
    ),
    (
      select string_agg(t.name, ', ' order by t.name)
      from public.team_members tm join public.teams t on t.id = tm.team_id
      where tm.profile_id = p.id and tm.team_role = 'athlete' and not t.archived
    ),
    coalesce(jsonb_array_length(m.emergency_contacts), 0) > 0,
    m.checked_at,
    m.checked_by_name,
    (m.checked_at + interval '1 year')::date,
    public.medical_review_status(m.checked_at)
  from public.profiles p
  left join public.medical_profiles m on m.athlete_id = p.id
  where p.status = 'approved' and (p.role = 'athlete' or 'athlete' = any (p.extra_roles))
  order by 2;
end;
$$;
revoke execute on function public.medical_review_compliance() from public, anon;
grant execute on function public.medical_review_compliance() to authenticated;

create or replace function public.absence_report(p_from date, p_to date)
returns table (
  athlete_id uuid,
  from_day date,
  to_day date,
  category text,
  category_order int
)
language sql
stable
security definer
set search_path = ''
as $$
  select a.athlete_id, a.from_day, a.to_day, c.name, c.sort_order
  from public.attendance_absences a
  left join public.absence_categories c on c.id = a.category_id
  where public.can_read_reports()
    and a.withdrawn_at is null
    and a.from_day <= p_to
    and a.to_day >= p_from
  order by a.from_day, a.athlete_id;
$$;
revoke execute on function public.absence_report(date, date) from public, anon;
grant execute on function public.absence_report(date, date) to authenticated;

create or replace function public.award_vote_breakdown(p_award_id uuid)
returns table (
  team_id uuid,
  fixture_id uuid,
  fixture_label text,
  starts_at timestamptz,
  preseason boolean,
  nominee_key text,
  nominee_name text,
  rank smallint,
  votes integer,
  points integer
)
language sql
stable
security definer
set search_path = ''
as $$
  with a as (
    select * from public.awards
    where id = p_award_id and closes_at <= now() and public.can_read_reports()
  )
  select
    b.team_id,
    b.fixture_id,
    case when f.id is not null then public.fixture_label(f) end,
    f.starts_at,
    b.preseason,
    -- A nominee who has left is told apart by name, as in award_results.
    coalesce(v.nominee_id::text, v.candidate_id::text, 'left:' || v.nominee_name),
    (array_agg(v.nominee_name order by b.updated_at desc))[1],
    v.rank,
    count(*)::int,
    sum(v.points)::int
  from a
  join public.award_ballots b on b.award_id = a.id
  join public.award_votes v on v.ballot_id = b.id
  left join public.fixtures f on f.id = b.fixture_id
  group by b.team_id, b.fixture_id, f.id, b.preseason, 6, v.rank
  order by b.team_id, b.preseason desc, f.starts_at, v.rank;
$$;
revoke execute on function public.award_vote_breakdown(uuid) from public, anon;
grant execute on function public.award_vote_breakdown(uuid) to authenticated;

create or replace function public.award_turnout(p_award_id uuid)
returns table (
  team_id uuid,
  team_name text,
  fixture_id uuid,
  fixture_label text,
  starts_at timestamptz,
  preseason boolean,
  ballots int,
  voters int
)
language sql
stable
security definer
set search_path = ''
as $$
  with a as (
    select * from public.awards where id = p_award_id and public.can_read_reports()
  ),
  groups as (
    select g.team_id from a join public.award_groups g on g.award_id = a.id where a.per_group
    union all
    select null::uuid from a where not a.per_group
  ),
  rounds as (
    select gr.team_id, null::uuid as fixture_id, false as preseason from groups gr, a
    where not a.by_match
    union all
    select gr.team_id, null, true from groups gr, a
    where a.by_match and a.preseason_weight > 0
    union all
    select gr.team_id, f.id, false from groups gr, a
    join public.fixtures f on true
    where a.by_match and f.team_id = gr.team_id and f.opponent is not null
      and f.starts_at <= now() and f.starts_at < a.closes_at
      and coalesce(f.status, '') !~* 'cancel|abandon|forfeit'
  )
  select
    r.team_id, t.name, r.fixture_id, case when f.id is not null then public.fixture_label(f) end,
    f.starts_at, r.preseason,
    (select count(*)::int from public.award_ballots b
      where b.award_id = p_award_id and b.team_id is not distinct from r.team_id
        and b.fixture_id is not distinct from r.fixture_id and b.preseason = r.preseason),
    (select count(*)::int from public.award_voters(p_award_id, r.team_id))
  from rounds r
  left join public.teams t on t.id = r.team_id
  left join public.fixtures f on f.id = r.fixture_id
  order by t.sort_order nulls first, t.name, r.preseason desc, f.starts_at;
$$;
revoke execute on function public.award_turnout(uuid) from public, anon;
grant execute on function public.award_turnout(uuid) to authenticated;

commit;
