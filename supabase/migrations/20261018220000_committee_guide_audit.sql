-- Fixes from the committee guide audit (17 October 2026), decided by Matt.
--
-- 1. One season KPI review note per reviewer. A coach's or manager's review
--    could be written by their head coach and by the committee or admins, but
--    there was one note per person, group and review date, so the second
--    reviewer's words replaced the first's. Notes now live in
--    season_kpi_review_notes, one row per reviewer; the person confirms each.
--    The existing notes are copied across, nothing is removed.
-- 2. Admin to-dos when the club has no cleared Child Safety Officer or
--    Complaints Manager (the position is empty, or its holder's check lapsed).
-- 3. A member who is only a statistician can be stood down.
-- 4. Clearance and attendance error texts: physios endorse too, and admins
--    and the committee can change club-wide sessions.
-- 5. The check-in trend's flagged count is athletes, not check-ins.
--
-- Additive only: a new table, copied rows, replaced functions. No rows are
-- changed or deleted when this migration runs.

begin;

-- ---------------------------------------------------------------------------
-- 1. One KPI review note per reviewer
-- ---------------------------------------------------------------------------

create table if not exists public.season_kpi_review_notes (
  profile_id uuid not null,
  team_id uuid not null,
  point_id uuid not null,
  -- Who wrote it. No foreign key: the note is the club's record and outlives
  -- the reviewer's account, like season_kpis.profile_id.
  reviewer_id uuid not null,
  reviewer_name text,
  note text not null check (length(note) <= 2000),
  noted_at timestamptz not null default now(),
  -- When the person confirmed this review was done with them.
  confirmed_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (profile_id, team_id, point_id, reviewer_id),
  foreign key (profile_id, team_id, point_id)
    references public.season_kpi_reviews (profile_id, team_id, point_id) on delete cascade
);

alter table public.season_kpi_review_notes enable row level security;
revoke all on public.season_kpi_review_notes from public, anon, authenticated;

-- Copy the notes written so far, under whoever wrote them.
insert into public.season_kpi_review_notes (
  profile_id, team_id, point_id, reviewer_id, reviewer_name, note, noted_at, confirmed_at, updated_at
)
select r.profile_id, r.team_id, r.point_id,
  coalesce(r.noted_by, '00000000-0000-0000-0000-000000000000'),
  case when r.noted_by is null then 'Former member' end,
  r.note, coalesce(r.noted_at, r.updated_at), r.confirmed_at, r.updated_at
from public.season_kpi_reviews r
where r.note is not null
on conflict do nothing;

-- A reviewer writes, changes or clears their own note.
create or replace function public.save_kpi_review(
  p_profile_id uuid,
  p_team_id uuid,
  p_point_id uuid,
  p_note text
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_role public.team_role;
begin
  if not public.kpi_can_edit(p_profile_id, p_team_id) then
    raise exception 'You can''t review this person''s KPIs.';
  end if;
  if not public.kpi_point_in_season(p_point_id, p_team_id) then
    raise exception 'That review date isn''t in this season.';
  end if;
  select m.team_role into v_role from public.team_members m
  where m.team_id = p_team_id and m.profile_id = p_profile_id;
  insert into public.season_kpi_reviews (profile_id, team_id, point_id, team_role, updated_at)
  values (p_profile_id, p_team_id, p_point_id, v_role, now())
  on conflict (profile_id, team_id, point_id) do update set updated_at = now();
  if v_note is null then
    delete from public.season_kpi_review_notes
    where profile_id = p_profile_id and team_id = p_team_id and point_id = p_point_id
      and reviewer_id = auth.uid();
    return;
  end if;
  insert into public.season_kpi_review_notes (
    profile_id, team_id, point_id, reviewer_id, reviewer_name, note, noted_at, updated_at
  )
  values (p_profile_id, p_team_id, p_point_id, auth.uid(), public.my_display_name(), v_note, now(), now())
  on conflict (profile_id, team_id, point_id, reviewer_id) do update
  set note = excluded.note, reviewer_name = excluded.reviewer_name, noted_at = now(),
    confirmed_at = case
      when excluded.note = public.season_kpi_review_notes.note
        then public.season_kpi_review_notes.confirmed_at
      else null
    end,
    updated_at = now();
end;
$$;

-- The person confirms every review written for them at that date.
create or replace function public.confirm_kpi_review(p_team_id uuid, p_point_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not public.is_approved() then
    raise exception 'You can''t confirm this review.';
  end if;
  update public.season_kpi_review_notes n
  set confirmed_at = now(), updated_at = now()
  where n.profile_id = auth.uid() and n.team_id = p_team_id and n.point_id = p_point_id
    and n.confirmed_at is null
    and exists (select 1 from public.teams t where t.id = n.team_id and not t.archived);
  if not found then
    raise exception 'There’s no written review to confirm.';
  end if;
  update public.season_kpi_reviews r
  set confirmed_at = now(), updated_at = now()
  where r.profile_id = auth.uid() and r.team_id = p_team_id and r.point_id = p_point_id;
end;
$$;

create or replace function public.season_kpi_sheet(p_profile_id uuid, p_team_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_relation text := public.kpi_relation(p_profile_id, p_team_id);
  v_team public.teams;
  v_member public.team_members;
begin
  if v_relation is null then
    return null;
  end if;
  select * into v_team from public.teams where id = p_team_id;
  select * into v_member from public.team_members where team_id = p_team_id and profile_id = p_profile_id;
  if v_relation in ('setter', 'viewer') then
    perform public.write_record_access(p_profile_id, 'kpis', p_team_id);
  end if;
  return jsonb_build_object(
    'profile_id', p_profile_id,
    'full_name', coalesce(public.member_display_name(p_profile_id), 'Unnamed member'),
    'team_id', v_team.id,
    'team_name', v_team.name,
    'team_kind', v_team.kind,
    'season', v_team.season,
    'archived', v_team.archived,
    'team_role', v_member.team_role,
    'coach_title', v_member.coach_title,
    'relation', v_relation,
    'can_edit', v_relation = 'setter' and not v_team.archived,
    'can_update', v_relation in ('self', 'setter') and not v_team.archived,
    'kpis', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', k.id,
        'format', k.format,
        'title', k.title,
        'detail', k.detail,
        'result', k.result,
        'result_note', k.result_note,
        'result_by_name', public.member_display_name(k.result_by),
        'result_at', k.result_at,
        'set_by_name', public.member_display_name(k.set_by),
        'created_at', k.created_at,
        'measures', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', ms.id,
            'title', ms.title,
            'kind', ms.kind,
            'target', ms.target,
            'unit', ms.unit,
            'lower_is_better', ms.lower_is_better,
            'baseline', ms.baseline,
            'current_value', ms.current_value,
            'done', ms.done,
            'progress_by_name', public.member_display_name(ms.progress_by),
            'progress_at', ms.progress_at
          ) order by ms.sort_order)
          from public.season_kpi_measures ms where ms.kpi_id = k.id
        ), '[]'::jsonb)
      ) order by k.created_at)
      from public.season_kpis k
      where k.profile_id = p_profile_id and k.team_id = p_team_id
    ), '[]'::jsonb),
    -- Every review date in the group's season: the caller's own note (note,
    -- noted_at, confirmed_at), every reviewer's note (notes) and the
    -- person's own view.
    'reviews', coalesce((
      select jsonb_agg(jsonb_build_object(
        'point_id', rp.id,
        'name', rp.name,
        'due_on', rp.due_on,
        'note', mine.note,
        'noted_by_name', public.my_display_name(),
        'noted_at', mine.noted_at,
        'confirmed_at', mine.confirmed_at,
        'notes', coalesce((
          select jsonb_agg(jsonb_build_object(
            'reviewer_id', n.reviewer_id,
            'reviewer_name', coalesce(public.member_display_name(n.reviewer_id), n.reviewer_name, 'Former member'),
            'note', n.note,
            'noted_at', n.noted_at,
            'confirmed_at', n.confirmed_at
          ) order by n.noted_at)
          from public.season_kpi_review_notes n
          where n.point_id = rp.id and n.profile_id = p_profile_id and n.team_id = p_team_id
        ), '[]'::jsonb),
        'self_review', r.self_review,
        'self_reviewed_at', r.self_reviewed_at
      ) order by rp.due_on, rp.name)
      from public.season_kpi_review_points rp
      left join public.season_kpi_reviews r
        on r.point_id = rp.id and r.profile_id = p_profile_id and r.team_id = p_team_id
      left join public.season_kpi_review_notes mine
        on mine.point_id = rp.id and mine.profile_id = p_profile_id and mine.team_id = p_team_id
        and mine.reviewer_id = auth.uid()
      where rp.season = v_team.season
    ), '[]'::jsonb)
  );
end;
$$;

-- "2 of 3 reviews written": a review date counts as written once anyone has
-- written a note, and as confirmed once every note at it is confirmed.
create or replace function public.season_kpi_people()
returns table (
  profile_id uuid,
  full_name text,
  team_id uuid,
  team_name text,
  team_kind public.group_kind,
  season int,
  archived boolean,
  team_role public.team_role,
  coach_title public.coach_title,
  relation text,
  kpi_count int,
  result_count int,
  review_count int,
  reviews_written int,
  reviews_confirmed int
)
language sql
stable
security definer
set search_path = ''
as $$
  with people as (
    select m.profile_id, m.team_id, m.team_role, m.coach_title, t.name, t.kind, t.season,
      t.archived, t.sort_order, public.kpi_relation(m.profile_id, m.team_id) as relation,
      (select count(*)::int from public.season_kpis k
        where k.profile_id = m.profile_id and k.team_id = m.team_id) as kpi_count
    from public.team_members m
    join public.teams t on t.id = m.team_id
    join public.profiles p on p.id = m.profile_id and p.status = 'approved'
    where m.team_role in ('coach', 'manager', 'athlete')
  )
  select x.profile_id, coalesce(public.member_display_name(x.profile_id), 'Unnamed member'),
    x.team_id, x.name, x.kind, x.season, x.archived, x.team_role, x.coach_title, x.relation,
    x.kpi_count,
    (select count(*)::int from public.season_kpis k
      where k.profile_id = x.profile_id and k.team_id = x.team_id and k.result is not null),
    (select count(*)::int from public.season_kpi_review_points rp where rp.season = x.season),
    (select count(distinct n.point_id)::int from public.season_kpi_review_notes n
      where n.profile_id = x.profile_id and n.team_id = x.team_id),
    (select count(*)::int from (
      select n.point_id from public.season_kpi_review_notes n
      where n.profile_id = x.profile_id and n.team_id = x.team_id
      group by n.point_id
      having bool_and(n.confirmed_at is not null)
    ) c)
  from people x
  where x.relation is not null
    -- Past seasons, and admins reading athletes', only where there's something to read.
    and (
      (not x.archived and x.relation <> 'viewer')
      or x.kpi_count > 0
      or exists (select 1 from public.season_kpi_reviews r
        where r.profile_id = x.profile_id and r.team_id = x.team_id)
    )
  order by x.archived, x.season desc, x.sort_order, x.name, x.team_role, 2;
$$;

-- Each setter writes their own review, so the to-do is theirs until they do;
-- the person confirms once per review date.
create or replace function public.kpi_review_todos()
returns table (
  kind text,
  point_id uuid,
  point_name text,
  due_on date,
  team_id uuid,
  team_name text,
  profile_id uuid,
  full_name text
)
language sql
stable
security definer
set search_path = ''
as $$
  select 'write', rp.id, rp.name, rp.due_on, t.id, t.name, m.profile_id,
    coalesce(public.member_display_name(m.profile_id), 'Unnamed member')
  from public.team_members m
  join public.teams t on t.id = m.team_id and not t.archived
  join public.season_kpi_review_points rp
    on rp.season = t.season and rp.due_on <= current_date + 7
  where public.is_approved()
    and exists (
      select 1 from public.season_kpis k
      where k.profile_id = m.profile_id and k.team_id = m.team_id and k.set_by = auth.uid()
    )
    and not exists (
      select 1 from public.season_kpi_review_notes n
      where n.profile_id = m.profile_id and n.team_id = m.team_id and n.point_id = rp.id
        and n.reviewer_id = auth.uid()
    )
    and public.kpi_can_edit(m.profile_id, m.team_id)
  union all
  select distinct 'confirm', rp.id, rp.name, rp.due_on, t.id, t.name, n.profile_id,
    coalesce(public.member_display_name(n.profile_id), 'Unnamed member')
  from public.season_kpi_review_notes n
  join public.teams t on t.id = n.team_id and not t.archived
  join public.season_kpi_review_points rp on rp.id = n.point_id
  where n.profile_id = auth.uid() and public.is_approved()
    and n.confirmed_at is null
  order by 4, 6, 8;
$$;

create or replace function public.season_kpi_report(p_season int)
returns table (
  team_id uuid,
  team_name text,
  team_kind public.group_kind,
  profile_id uuid,
  full_name text,
  team_role public.team_role,
  coach_title public.coach_title,
  left_at timestamptz,
  kpi_id uuid,
  format public.kpi_format,
  title text,
  measures jsonb,
  result public.kpi_result,
  result_note text,
  set_by_name text,
  reviews jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  with people as (
    select m.profile_id, m.team_id, m.team_role, m.coach_title,
      null::text as left_name, null::timestamptz as left_at
    from public.team_members m
    where m.team_role in ('coach', 'manager')
    union all
    select k.profile_id, k.team_id, k.team_role, null::public.coach_title,
      max(k.person_name), max(k.person_left_at)
    from public.season_kpis k
    where k.person_left_at is not null and k.team_role in ('coach', 'manager')
      and not exists (
        select 1 from public.team_members m
        where m.profile_id = k.profile_id and m.team_id = k.team_id
      )
    group by k.profile_id, k.team_id, k.team_role
  )
  select t.id, t.name, t.kind, x.profile_id,
    coalesce(public.member_display_name(x.profile_id), x.left_name, 'Former member'),
    x.team_role, x.coach_title, x.left_at, k.id, k.format, k.title,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'title', ms.title, 'kind', ms.kind, 'target', ms.target, 'unit', ms.unit,
        'lower_is_better', ms.lower_is_better, 'current_value', ms.current_value, 'done', ms.done
      ) order by ms.sort_order)
      from public.season_kpi_measures ms where ms.kpi_id = k.id
    ), '[]'::jsonb),
    k.result, k.result_note, public.member_display_name(k.set_by),
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', rp.name,
        'due_on', rp.due_on,
        'written', exists (
          select 1 from public.season_kpi_review_notes n
          where n.point_id = rp.id and n.profile_id = x.profile_id and n.team_id = t.id
        ),
        'confirmed', exists (
          select 1 from public.season_kpi_review_notes n
          where n.point_id = rp.id and n.profile_id = x.profile_id and n.team_id = t.id
        ) and not exists (
          select 1 from public.season_kpi_review_notes n
          where n.point_id = rp.id and n.profile_id = x.profile_id and n.team_id = t.id
            and n.confirmed_at is null
        )
      ) order by rp.due_on, rp.name)
      from public.season_kpi_review_points rp
      where rp.season = t.season
    ), '[]'::jsonb)
  from public.teams t
  join people x on x.team_id = t.id
  left join public.season_kpis k on k.profile_id = x.profile_id and k.team_id = t.id
  where public.is_admin() and t.season = p_season
  order by t.sort_order, t.name, x.team_role, 5, k.created_at;
$$;

-- ---------------------------------------------------------------------------
-- 2. To-dos for a missing Child Safety Officer or Complaints Manager
-- ---------------------------------------------------------------------------

drop function if exists public.admin_safety_todos();
create function public.admin_safety_todos()
returns table (
  wwcc_missing integer,
  wwcc_expiring integer,
  minors_without_guardian integer,
  turning_18 integer,
  exemptions_ending integer,
  athletes_without_date_of_birth integer,
  wwcc_to_validate integer,
  wwcc_to_link integer,
  notices_to_report integer,
  wwc_officer_missing integer,
  wwcc_people integer,
  -- 1 when the position is empty or its holder can no longer hold it
  -- (check lapsed, stood down, left).
  child_safety_officer_missing integer,
  complaints_manager_missing integer
)
language sql
stable
security definer
set search_path = ''
as $$
  with members as (
    select p.*, public.roles_of(p.role, p.extra_roles) as roles,
      public.needs_wwcc(public.roles_of(p.role, p.extra_roles), p.wwcc_exempt_reason)
        and not (p.role = 'volunteer' and p.volunteer_until < current_date) as needs_check
    from public.profiles p
    where p.status = 'approved' and public.is_admin()
  )
  select
    count(*) filter (
      where m.needs_check
        and not (m.role = 'volunteer' and m.volunteer_from > current_date)
        and not public.is_cleared(m.id)
    )::int,
    count(*) filter (
      where m.needs_check
        and public.has_current_wwcc(m.id)
        and m.wwcc_expires_on < current_date + 60
        and not (m.role = 'volunteer' and m.wwcc_expires_on >= m.volunteer_until)
    )::int,
    count(*) filter (
      where 'athlete' = any (m.roles) and public.is_minor(m.date_of_birth, m.under_17)
        and not exists (select 1 from public.guardianships g where g.athlete_id = m.id)
    )::int,
    count(*) filter (
      where 'athlete' = any (m.roles) and m.date_of_birth is not null
        and public.is_minor(m.date_of_birth, m.under_17)
        and m.date_of_birth <= current_date - interval '18 years' + interval '30 days'
    )::int,
    count(*) filter (
      where m.needs_check
        and not public.has_current_wwcc(m.id)
        and exists (
          select 1 from public.volunteer_exemption_state(m.id) s
          where s.valid and s.ends_on < current_date + 60
            and s.basis not in ('short_term_visitor', 'national_event')
            and not (m.role = 'volunteer' and s.ends_on > m.volunteer_until)
        )
    )::int,
    count(*) filter (
      where 'athlete' = any (m.roles) and m.date_of_birth is null
    )::int,
    count(*) filter (
      where m.needs_check
        and public.has_current_wwcc(m.id)
        and (m.wwcc_validated_at is null or m.wwcc_validated_at < now() - interval '1 year')
    )::int,
    count(*) filter (
      where m.needs_check
        and public.has_current_wwcc(m.id)
        and m.wwcc_unit_linked_at is null
    )::int,
    (select count(*) from public.screening_notices n
     where n.kind in ('interim_negative_notice', 'negative_notice', 'interstate_decision', 'card_cancelled')
       and n.governing_body_told_on is null and public.is_admin())::int,
    (select count(*) from public.safeguarding_settings s
     where s.id and s.wwc_officer_id is null and public.is_admin())::int,
    -- Members behind wwcc_missing, wwcc_expiring, wwcc_to_validate or
    -- wwcc_to_link, each counted once. Keep these in step with those counts.
    count(*) filter (
      where m.needs_check and (
        (not (m.role = 'volunteer' and m.volunteer_from > current_date)
          and not public.is_cleared(m.id))
        or (public.has_current_wwcc(m.id) and (
          (m.wwcc_expires_on < current_date + 60
            and not (m.role = 'volunteer' and m.wwcc_expires_on >= m.volunteer_until))
          or m.wwcc_validated_at is null
          or m.wwcc_validated_at < now() - interval '1 year'
          or m.wwcc_unit_linked_at is null))
      )
    )::int,
    (select count(*) from public.safeguarding_settings s
     where s.id and public.is_admin()
       and (s.child_safety_officer_id is null
         or not public.can_be_safeguarding_contact(s.child_safety_officer_id)))::int,
    (select count(*) from public.safeguarding_settings s
     where s.id and public.is_admin()
       and (s.complaints_manager_id is null
         or not public.can_be_safeguarding_contact(s.complaints_manager_id)))::int
  from members m;
$$;

revoke execute on function public.admin_safety_todos() from public, anon;
grant execute on function public.admin_safety_todos() to authenticated;

-- ---------------------------------------------------------------------------
-- 3. A statistician can be stood down
-- ---------------------------------------------------------------------------

create or replace function public.admin_stand_down(p_profile_id uuid, p_reason text, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_member public.profiles;
  v_note text := nullif(trim(p_note), '');
  v_placements jsonb;
begin
  if not public.is_admin() then
    raise exception 'Only admins can stand members down';
  end if;
  if p_profile_id = auth.uid() then
    raise exception 'Ask another admin to do this';
  end if;
  select * into v_member from public.profiles where id = p_profile_id;
  if not found then
    raise exception 'Member not found';
  end if;
  if not public.roles_of(v_member.role, v_member.extra_roles)
     && array['coach', 'manager', 'physio', 'committee', 'admin', 'volunteer', 'statistician']::public.app_role[] then
    raise exception 'Only coaches, managers, physios, committee members, admins, statisticians and temporary helpers can be stood down';
  end if;
  if v_member.stood_down_at is not null then
    raise exception 'They''re already stood down';
  end if;
  if p_reason is null or p_reason not in (
    'interim_negative_notice', 'negative_notice', 'interstate_decision', 'allegation', 'other'
  ) then
    raise exception 'Choose why they''re being stood down';
  end if;
  if p_reason = 'other' and v_note is null then
    raise exception 'Say why they''re being stood down';
  end if;
  if length(v_note) > 1000 then
    raise exception 'Keep the note under 1000 characters';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'team_id', tm.team_id, 'team_role', tm.team_role, 'coach_title', tm.coach_title
  )), '[]'::jsonb)
  into v_placements
  from public.team_members tm
  join public.teams t on t.id = tm.team_id
  where tm.profile_id = p_profile_id
    and tm.team_role in ('coach', 'manager', 'physio')
    and not t.archived;

  delete from public.team_members tm
  using public.teams t
  where t.id = tm.team_id
    and tm.profile_id = p_profile_id
    and tm.team_role in ('coach', 'manager', 'physio')
    and not t.archived;

  update public.profiles set stood_down_at = now() where id = p_profile_id;

  insert into public.stand_downs (
    profile_id, member_name, reason, note, placements, started_by, started_by_name
  )
  values (
    p_profile_id,
    coalesce(nullif(v_member.full_name, ''), v_member.email, 'Unnamed member'),
    p_reason,
    v_note,
    v_placements,
    auth.uid(),
    public.my_display_name()
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Error texts: physios endorse too; admins and the committee can change
--    club-wide sessions
-- ---------------------------------------------------------------------------

create or replace function public.accept_clearance(p_injury_id uuid, p_notes text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_injury public.injuries;
begin
  select * into v_injury from public.injuries where id = p_injury_id for update;
  if v_injury.id is null or not public.is_committee() then
    raise exception 'Only the committee can accept clearance';
  end if;
  if v_injury.status <> 'coach_endorsed' then
    raise exception 'A coach or physio needs to endorse this first';
  end if;
  if v_injury.coach_endorsed_by = auth.uid() or v_injury.athlete_id = auth.uid() then
    raise exception 'Someone other than the person who endorsed it needs to accept this';
  end if;
  if public.is_guardian_of(v_injury.athlete_id) then
    raise exception 'You can’t accept your own child’s clearance. Ask another committee member.';
  end if;
  if not public.can_view_injury_details(v_injury.athlete_id) then
    raise exception 'A parent or guardian needs to give consent before you can see this injury';
  end if;

  update public.injuries
  set status = 'cleared', cleared_by = auth.uid(), cleared_at = now()
  where id = p_injury_id;

  insert into public.injury_updates (injury_id, author_id, author_name, kind, notes)
  values (
    p_injury_id, auth.uid(), public.my_display_name(), 'cleared', nullif(trim(p_notes), '')
  );
end;
$$;

create or replace function public.save_attendance(
  p_session_id uuid,
  p_team_id uuid,
  p_name text,
  p_held_at timestamptz,
  p_marks jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.attendance_sessions;
  v_team_id uuid;
  v_club boolean;
  v_id uuid;
  v_bad int;
begin
  if p_session_id is null then
    v_team_id := p_team_id;
    v_club := p_team_id is null;
  else
    select * into v_session from public.attendance_sessions where id = p_session_id for update;
    if v_session.id is null then
      raise exception 'Attendance record not found';
    end if;
    v_team_id := v_session.team_id;
    v_club := v_session.club_wide;
  end if;

  if p_session_id is null then
    if not (case when v_club then public.is_attendance_taker()
      else public.can_take_attendance(v_team_id) end) then
      raise exception 'You can’t take attendance for this squad or team';
    end if;
  elsif not public.can_edit_attendance_session(p_session_id) then
    raise exception 'Only whoever took this attendance, the group’s coaches and managers, the committee for whole-club sessions, or an admin can change it';
  end if;
  if coalesce(trim(p_name), '') = '' then
    raise exception 'Name the session, for example Tuesday training';
  end if;
  if p_held_at is null or p_held_at > now() + interval '1 day' then
    raise exception 'Attendance can’t be taken for a session that hasn’t happened yet';
  end if;
  if jsonb_typeof(p_marks) <> 'array' then
    raise exception 'Mark each athlete present or absent';
  end if;

  select count(*) into v_bad
  from jsonb_array_elements(p_marks) m
  where jsonb_typeof(m -> 'present') <> 'boolean'
    or not (
      (v_club and public.is_club_athlete((m ->> 'profile_id')::uuid))
      or exists (
        select 1 from public.team_members tm
        where tm.team_id = v_team_id
          and tm.team_role = 'athlete'
          and tm.profile_id = (m ->> 'profile_id')::uuid
      )
      or exists (
        select 1 from public.attendance_marks am
        where am.session_id = p_session_id and am.profile_id = (m ->> 'profile_id')::uuid
      )
    );
  if v_bad > 0 then
    raise exception 'Only athletes in this squad, team or club can be marked';
  end if;

  if p_session_id is null then
    insert into public.attendance_sessions (
      club_wide, team_id, team_name, name, held_at, taken_by, taken_by_name
    )
    values (
      v_club,
      v_team_id,
      case when v_club then 'Whole club'
        else (select name from public.teams where id = v_team_id) end,
      trim(p_name),
      p_held_at,
      auth.uid(),
      (select coalesce(nullif(full_name, ''), email) from public.profiles where id = auth.uid())
    )
    returning id into v_id;
  else
    v_id := p_session_id;
    update public.attendance_sessions
    set name = trim(p_name), held_at = p_held_at
    where id = v_id;
  end if;

  insert into public.attendance_marks (session_id, profile_id, present, marked_by)
  select v_id, (m ->> 'profile_id')::uuid, (m ->> 'present')::boolean, auth.uid()
  from jsonb_array_elements(p_marks) m
  on conflict (session_id, profile_id) do update
    set present = excluded.present,
        marked_by = excluded.marked_by,
        marked_at = now()
    where public.attendance_marks.present is distinct from excluded.present;

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. The trend's flagged count is athletes, not check-ins
-- ---------------------------------------------------------------------------

create or replace function public.check_in_trend(p_team_id uuid, p_since date, p_until date)
returns table (
  day date,
  checked_in_count int,
  window_count int,
  flagged_count int,
  avg_sleep numeric,
  avg_soreness numeric,
  avg_stress numeric,
  avg_mood numeric
)
language sql
stable
security definer
set search_path = ''
as $$
  with allowed as (
    select public.is_approved() and p_until - p_since between 0 and 366 and (
      public.is_committee()
      or public.is_physio()
      or (p_team_id is not null and exists (
        select 1 from public.team_members coach
        join public.teams t on t.id = coach.team_id
        where coach.team_id = p_team_id
          and coach.profile_id = auth.uid()
          and coach.team_role = 'coach'
          and public.can_work_with_children()
          and not t.archived
          and t.selections_completed_at is null
      ))
    ) as ok
  ),
  athletes as (
    select distinct a.profile_id
    from public.team_members a
    join public.teams t on t.id = a.team_id and not t.archived
    join public.profiles p on p.id = a.profile_id and p.status = 'approved'
    where a.team_role = 'athlete'
      and (p_team_id is null or a.team_id = p_team_id)
      and public.has_child_consent(a.profile_id, 'data')
  ),
  days as (
    select d::date as day from generate_series(p_since, p_until, interval '1 day') d
  ),
  scores as (
    select
      d.day,
      count(c.id) filter (where c.day = d.day)::int as checked_in,
      count(c.id)::int as in_window,
      -- Athletes with any flagged check-in in the three days, each once.
      count(distinct c.athlete_id) filter (where least(c.sleep, c.soreness, c.stress, c.mood) <= 2)::int as flagged,
      avg(c.sleep) as sleep, avg(c.soreness) as soreness,
      avg(c.stress) as stress, avg(c.mood) as mood
    from days d
    left join public.check_ins c on c.day between d.day - 2 and d.day
      and c.athlete_id in (select profile_id from athletes)
    group by d.day
  ),
  shown as (
    select v.day, v.visible
    from public.check_in_visible_days(p_since, p_until, 3) v
    where v.team_id is not distinct from p_team_id
  )
  select
    s.day, s.checked_in, s.in_window,
    case when v.visible then s.flagged end,
    case when v.visible then round(s.sleep, 1) end,
    case when v.visible then round(s.soreness, 1) end,
    case when v.visible then round(s.stress, 1) end,
    case when v.visible then round(s.mood, 1) end
  from scores s
  left join shown v on v.day = s.day, allowed
  where allowed.ok
  order by s.day;
$$;

commit;
