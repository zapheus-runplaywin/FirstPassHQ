-- Selection assessments, release 2, part 3: auditors. An admin puts one or
-- more committee members with a current check on a round as its auditors.
-- They read everything in that round (never their own child's assessment,
-- or their own) and change nothing. Admins keep set-up and the counts-only
-- audit report. Adds one table; no row is changed or removed.
begin;

-- Who audits, or audited, a round. A row is never removed: taking someone
-- off fills in removed_at, like the panel.
create table if not exists public.selection_round_auditors (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references public.selection_rounds (id) on delete cascade,
  profile_id uuid references public.profiles (id) on delete set null,
  profile_name text not null,
  added_by uuid references public.profiles (id) on delete set null,
  added_by_name text,
  added_at timestamptz not null default now(),
  removed_by uuid references public.profiles (id) on delete set null,
  removed_by_name text,
  removed_at timestamptz
);
create unique index if not exists selection_round_auditors_one_active
  on public.selection_round_auditors (round_id, profile_id) where removed_at is null;
create index if not exists selection_round_auditors_profile_idx
  on public.selection_round_auditors (profile_id) where removed_at is null;
alter table public.selection_round_auditors enable row level security;
revoke all on table public.selection_round_auditors from public, anon, authenticated;
grant all on table public.selection_round_auditors to service_role;

-- ---------------------------------------------------------------------------
-- Who can do what
-- ---------------------------------------------------------------------------

-- Whether someone could audit a round: an approved adult committee member,
-- not stood down, with a current check (or an exemption that counts).
create or replace function public.can_audit_selections(p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = p_profile_id
      and p.status = 'approved'
      and p.stood_down_at is null
      and not public.is_minor(p.date_of_birth, p.under_17)
      and 'committee' = any (array[p.role] || p.extra_roles)
  ) and public.is_cleared(p_profile_id);
$$;
revoke execute on function public.can_audit_selections(uuid) from public, anon, authenticated;

-- Whether the signed-in member audits this round now. A stood-down member,
-- one without a current check, or one no longer on the committee doesn't.
create or replace function public.audits_selection_round(p_round_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_approved()
    and public.selection_assessments_on()
    and public.can_work_with_children()
    and public.has_role('committee')
    and exists (
      select 1 from public.selection_round_auditors a
      where a.round_id = p_round_id and a.profile_id = auth.uid() and a.removed_at is null
    );
$$;
revoke execute on function public.audits_selection_round(uuid) from public, anon;
grant execute on function public.audits_selection_round(uuid) to authenticated;

-- Whether the signed-in auditor may read this athlete's assessment: one of
-- the round's athletes, not themselves and not their own child.
create or replace function public.can_audit_athlete(p_round_id uuid, p_athlete_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.audits_selection_round(p_round_id)
    and public.in_selection_round(p_round_id, p_athlete_id)
    and p_athlete_id <> auth.uid()
    and not exists (
      select 1 from public.guardianships g
      where g.guardian_id = auth.uid() and g.athlete_id = p_athlete_id
    );
$$;
revoke execute on function public.can_audit_athlete(uuid, uuid) from public, anon;
grant execute on function public.can_audit_athlete(uuid, uuid) to authenticated;

-- Who may build a round's audit report and its record: admins, and the
-- round's auditors.
create or replace function public.can_read_selection_audit(p_round_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (public.is_admin() and public.selection_assessments_on()) or public.audits_selection_round(p_round_id);
$$;
revoke execute on function public.can_read_selection_audit(uuid) from public, anon, authenticated;

-- A round's auditors, now and before, as admins (and the audit report) list them.
create or replace function public.selection_auditors_json(p_round_id uuid, p_with_ids boolean default true)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'name', coalesce(public.member_display_name(a.profile_id), a.profile_name),
      'added_at', a.added_at,
      'added_by_name', a.added_by_name,
      'removed_at', a.removed_at,
      'removed_by_name', a.removed_by_name,
      'can_audit', a.profile_id is not null and public.can_audit_selections(a.profile_id),
      'own_children', (
        select count(*)::int
        from public.guardianships g
        join public.team_members m on m.profile_id = g.athlete_id and m.team_role = 'athlete'
        join public.selection_rounds r on r.id = a.round_id and m.team_id = r.team_id
        where g.guardian_id = a.profile_id
      ),
      'is_admin', exists (
        select 1 from public.profiles p where p.id = a.profile_id and 'admin' = any (array[p.role] || p.extra_roles)
      ),
      'other_rounds', (
        select count(*)::int from public.selection_round_auditors o
        join public.selection_rounds r on r.id = o.round_id
        where o.profile_id = a.profile_id and o.removed_at is null and o.round_id <> a.round_id and r.closed_at is null
      )
    ) || case when p_with_ids then jsonb_build_object('profile_id', a.profile_id) else '{}'::jsonb end
    order by (a.removed_at is not null), a.added_at, a.profile_name), '[]'::jsonb)
  from public.selection_round_auditors a
  where a.round_id = p_round_id;
$$;
revoke execute on function public.selection_auditors_json(uuid, boolean) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Admins choose the auditors
-- ---------------------------------------------------------------------------

create or replace function public.admin_selection_auditors(p_round_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() or not public.selection_assessments_on() then
    raise exception 'Only admins can see a round’s auditors';
  end if;
  return public.selection_auditors_json(p_round_id, true);
end;
$$;
revoke execute on function public.admin_selection_auditors(uuid) from public, anon;
grant execute on function public.admin_selection_auditors(uuid) to authenticated;

create or replace function public.admin_selection_auditor_choices(p_round_id uuid)
returns table (profile_id uuid, name text, cleared boolean, on_panel boolean, audited_last boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_round public.selection_rounds;
  v_last uuid;
begin
  if not public.is_admin() or not public.selection_assessments_on() then
    raise exception 'Only admins can choose a round’s auditors';
  end if;
  select * into v_round from public.selection_rounds r where r.id = p_round_id;
  if v_round.id is null then
    raise exception 'Round not found';
  end if;
  select r.id into v_last from public.selection_rounds r
  where r.team_id = v_round.team_id and r.id <> p_round_id
  order by r.starts_on desc, r.created_at desc limit 1;
  return query
  select p.id, public.display_name(p), public.is_cleared(p.id),
    exists (
      select 1 from public.selection_round_panel m
      where m.round_id = p_round_id and m.profile_id = p.id and m.removed_at is null
    ),
    v_last is not null and exists (
      select 1 from public.selection_round_auditors a
      where a.round_id = v_last and a.profile_id = p.id and a.removed_at is null
    )
  from public.profiles p
  where p.status = 'approved'
    and p.stood_down_at is null
    and not public.is_minor(p.date_of_birth, p.under_17)
    and 'committee' = any (array[p.role] || p.extra_roles)
    and not exists (
      select 1 from public.selection_round_auditors a
      where a.round_id = p_round_id and a.profile_id = p.id and a.removed_at is null
    )
  order by public.display_name(p);
end;
$$;
revoke execute on function public.admin_selection_auditor_choices(uuid) from public, anon;
grant execute on function public.admin_selection_auditor_choices(uuid) to authenticated;

create or replace function public.admin_add_selection_auditor(p_round_id uuid, p_profile_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() or not public.selection_assessments_on() then
    raise exception 'Only admins can choose a round’s auditors';
  end if;
  if not exists (select 1 from public.selection_rounds r where r.id = p_round_id) then
    raise exception 'Round not found';
  end if;
  if not public.can_audit_selections(p_profile_id) then
    raise exception 'An auditor is a committee member with a current Working With Children Check';
  end if;
  if exists (
    select 1 from public.selection_round_panel m
    where m.round_id = p_round_id and m.profile_id = p_profile_id and m.removed_at is null
  ) then
    raise exception '% is on this round’s panel, so they can’t audit it',
      coalesce(public.member_display_name(p_profile_id), 'They');
  end if;
  if exists (
    select 1 from public.selection_round_auditors a
    where a.round_id = p_round_id and a.profile_id = p_profile_id and a.removed_at is null
  ) then
    return;
  end if;
  insert into public.selection_round_auditors (round_id, profile_id, profile_name, added_by, added_by_name)
  values (p_round_id, p_profile_id, coalesce(public.member_display_name(p_profile_id), 'Member'),
    auth.uid(), public.member_display_name(auth.uid()));
end;
$$;
revoke execute on function public.admin_add_selection_auditor(uuid, uuid) from public, anon;
grant execute on function public.admin_add_selection_auditor(uuid, uuid) to authenticated;

create or replace function public.admin_remove_selection_auditor(p_round_id uuid, p_profile_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() or not public.selection_assessments_on() then
    raise exception 'Only admins can choose a round’s auditors';
  end if;
  update public.selection_round_auditors a
  set removed_at = now(), removed_by = auth.uid(), removed_by_name = public.member_display_name(auth.uid())
  where a.round_id = p_round_id and a.profile_id = p_profile_id and a.removed_at is null;
  if not found then
    raise exception 'They aren’t auditing this round';
  end if;
end;
$$;
revoke execute on function public.admin_remove_selection_auditor(uuid, uuid) from public, anon;
grant execute on function public.admin_remove_selection_auditor(uuid, uuid) to authenticated;

-- An auditor of a round can't also be on its panel.
create or replace function public.admin_add_selection_panel_member(p_round_id uuid, p_profile_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() or not public.selection_assessments_on() then
    raise exception 'Only admins can change a selection panel';
  end if;
  if not exists (select 1 from public.selection_rounds r where r.id = p_round_id) then
    raise exception 'Round not found';
  end if;
  if exists (
    select 1 from public.selection_round_panel m
    where m.round_id = p_round_id and m.profile_id = p_profile_id and m.removed_at is null
  ) then
    return;
  end if;
  if exists (
    select 1 from public.selection_round_auditors a
    where a.round_id = p_round_id and a.profile_id = p_profile_id and a.removed_at is null
  ) then
    raise exception '% audits this round, so they can’t be on its panel',
      coalesce(public.member_display_name(p_profile_id), 'They');
  end if;
  if not public.can_join_selection_panel(p_profile_id) then
    raise exception 'A panel member must be an approved adult coach, admin or guest with a current Working With Children Check';
  end if;
  insert into public.selection_round_panel (round_id, profile_id, profile_name, added_by, added_by_name)
  values (p_round_id, p_profile_id, coalesce(public.member_display_name(p_profile_id), 'Member'),
    auth.uid(), public.member_display_name(auth.uid()));
end;
$$;
revoke execute on function public.admin_add_selection_panel_member(uuid, uuid) from public, anon;
grant execute on function public.admin_add_selection_panel_member(uuid, uuid) to authenticated;

-- Admins and the round's auditors (guard only changed).
create or replace function public.admin_selection_audit(p_round_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_round public.selection_rounds;
  v_groups int;
  v_athletes int;
  v_child uuid;
begin
  if not public.can_read_selection_audit(p_round_id) then
    raise exception 'Only admins can build the selection audit report';
  end if;
  select * into v_round from public.selection_rounds r where r.id = p_round_id;
  if v_round.id is null then
    raise exception 'Round not found';
  end if;
  v_groups := jsonb_array_length(v_round.criteria -> 'groups');
  select count(*)::int into v_athletes
  from public.team_members m where m.team_id = v_round.team_id and m.team_role = 'athlete';

  for v_child in
    select m.profile_id from public.team_members m
    where m.team_id = v_round.team_id and m.team_role = 'athlete'
  loop
    perform public.write_record_access(v_child, 'assessment_audit', p_round_id);
  end loop;

  return jsonb_build_object(
    'auditors', public.selection_auditors_json(p_round_id, false),
    'round', jsonb_build_object(
      'id', v_round.id,
      'name', v_round.name,
      'team_name', coalesce((select t.name from public.teams t where t.id = v_round.team_id), v_round.team_name),
      'season', v_round.season,
      'starts_on', v_round.starts_on,
      'ends_on', v_round.ends_on,
      'opened_at', v_round.created_at,
      'opened_by_name', v_round.created_by_name,
      'closed_at', v_round.closed_at,
      'closed_by_name', public.member_display_name(v_round.closed_by),
      'criteria_groups', v_groups,
      'criteria_items', (select count(*)::int from public.selection_round_items(p_round_id)),
      'athletes', v_athletes,
      'observations', (select count(*)::int from public.assessment_observations o where o.round_id = p_round_id),
      'today', public.club_today()
    ),
    'panel', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', coalesce(public.member_display_name(m.profile_id), m.profile_name),
        'added_at', m.added_at,
        'added_by_name', m.added_by_name,
        'removed_at', m.removed_at,
        'removed_by_name', m.removed_by_name,
        'declared_conflict', exists (
          select 1 from public.conflict_declarations d
          where d.profile_id = m.profile_id and d.season = v_round.season and d.has_conflict
        ),
        'can_assess', m.profile_id is not null and public.can_join_selection_panel(m.profile_id),
        'independent', m.profile_id is not null and public.is_independent_selector(m.profile_id),
        'own_children', (
          select count(*)::int
          from public.guardianships g
          join public.team_members a on a.profile_id = g.athlete_id
            and a.team_id = v_round.team_id and a.team_role = 'athlete'
          where g.guardian_id = m.profile_id
        )
      ) order by m.added_at, m.profile_name)
      from public.selection_round_panel m where m.round_id = p_round_id
    ), '[]'::jsonb),
    -- Everyone who is on the panel now or wrote anything, by name.
    'selectors', coalesce((
      select jsonb_agg(to_jsonb(s) - 'profile_id' order by s.name)
      from (
        select
          n.profile_id,
          n.name,
          n.on_panel,
          count(o.id)::int as observations,
          count(distinct o.athlete_id)::int as athletes_covered,
          (
            select count(distinct i.group_key)::int
            from public.assessment_observations o2
            join public.assessment_observation_ratings ra on ra.observation_id = o2.id
            join public.selection_round_items(p_round_id) i on i.item_key = ra.item_key
            where o2.round_id = p_round_id
              and (o2.author_id = n.profile_id
                or (n.profile_id is null and o2.author_id is null and o2.author_name = n.name))
          ) as groups_covered,
          min(o.observed_on) as first_on,
          max(o.observed_on) as last_on,
          count(distinct date_trunc('week', o.observed_on::timestamp))::int as weeks_active,
          count(o.id) filter (where o.context = 'training')::int as training,
          count(o.id) filter (where o.context = 'game')::int as game,
          count(o.id) filter (where o.context = 'trial')::int as trial,
          count(o.id) filter (where o.context = 'other')::int as other,
          count(o.id) filter (where o.note is null)::int as without_evidence,
          count(o.id) filter (where o.observed_on < public.club_day(o.created_at) - 7)::int as written_late,
          count(o.id) filter (where o.corrects_id is not null)::int as corrections
        from (
          select m.profile_id, coalesce(public.member_display_name(m.profile_id), m.profile_name) as name,
            true as on_panel
          from public.selection_round_panel m
          where m.round_id = p_round_id and m.removed_at is null
          union all
          select distinct x.author_id, coalesce(public.member_display_name(x.author_id), x.author_name), false
          from public.assessment_observations x
          where x.round_id = p_round_id
            and not exists (
              select 1 from public.selection_round_panel m
              where m.round_id = p_round_id and m.removed_at is null
                and (m.profile_id = x.author_id
                  or (m.profile_id is null and x.author_id is null and m.profile_name = x.author_name))
            )
        ) n
        left join public.assessment_observations o
          on o.round_id = p_round_id
          and (o.author_id = n.profile_id
            or (n.profile_id is null and o.author_id is null and o.author_name = n.name))
        group by n.profile_id, n.name, n.on_panel
      ) s
    ), '[]'::jsonb),
    'athletes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', public.display_name(p),
        'is_minor', public.is_minor(p.date_of_birth, p.under_17),
        'observations', (
          select count(*)::int from public.assessment_observations o
          where o.round_id = p_round_id and o.athlete_id = p.id
        ),
        'selectors', (
          select count(distinct coalesce(o.author_id::text, o.author_name))::int from public.assessment_observations o
          where o.round_id = p_round_id and o.athlete_id = p.id
        ),
        'groups_covered', (
          select count(distinct i.group_key)::int
          from public.assessment_observations o
          join public.assessment_observation_ratings ra on ra.observation_id = o.id
          join public.selection_round_items(p_round_id) i on i.item_key = ra.item_key
          where o.round_id = p_round_id and o.athlete_id = p.id
        ),
        'last_observed_on', (
          select max(o.observed_on) from public.assessment_observations o
          where o.round_id = p_round_id and o.athlete_id = p.id
        )
      ) order by public.display_name(p))
      from public.team_members m
      join public.profiles p on p.id = m.profile_id
      where m.team_id = v_round.team_id and m.team_role = 'athlete'
    ), '[]'::jsonb)
  );
end;
$$;
revoke execute on function public.admin_selection_audit(uuid) from public, anon;
grant execute on function public.admin_selection_audit(uuid) to authenticated;

-- Admins and the round's auditors (guard only changed).
create or replace function public.admin_selection_milestones(p_round_id uuid)
returns table (
  id uuid,
  title text,
  due_on date,
  shared boolean,
  done_at timestamptz,
  done_by_name text,
  removed_at timestamptz,
  removed_by_name text,
  created_by_name text,
  created_at timestamptz,
  -- Days past its day: when it was done, or today while it is still open.
  days_late integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.can_read_selection_audit(p_round_id) then
    raise exception 'Only admins can see a selection round’s dates';
  end if;
  return query
  select m.id, m.title, m.due_on, m.shared, m.done_at,
    coalesce(public.member_display_name(m.done_by), m.done_by_name),
    m.removed_at,
    coalesce(public.member_display_name(m.removed_by), m.removed_by_name),
    coalesce(public.member_display_name(m.created_by), m.created_by_name),
    m.created_at,
    greatest(0, coalesce(public.club_day(m.done_at), public.club_day(m.removed_at), public.club_today()) - m.due_on)::int
  from public.selection_round_milestones m
  where m.round_id = p_round_id
  order by (m.removed_at is not null), m.due_on, m.created_at;
end;
$$;
revoke execute on function public.admin_selection_milestones(uuid) from public, anon;
grant execute on function public.admin_selection_milestones(uuid) to authenticated;

-- Admins and the round's auditors (guard only changed).
create or replace function public.admin_selection_summaries(p_round_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_round public.selection_rounds;
  v_child uuid;
begin
  if not public.can_read_selection_audit(p_round_id) then
    raise exception 'Only admins can see who has signed';
  end if;
  select * into v_round from public.selection_rounds r where r.id = p_round_id;
  if v_round.id is null then
    raise exception 'Round not found';
  end if;
  for v_child in
    select m.profile_id from public.team_members m
    where m.team_id = v_round.team_id and m.team_role = 'athlete'
  loop
    perform public.write_record_access(v_child, 'assessment_audit', p_round_id);
  end loop;

  return jsonb_build_object(
    'ends_on', v_round.ends_on,
    'closed', v_round.closed_at is not null,
    'selectors', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', n.name,
        'on_panel', n.on_panel,
        -- Athletes in the round who aren't the selector or their own child.
        'athletes', (
          select count(*)::int from public.team_members a
          where a.team_id = v_round.team_id and a.team_role = 'athlete'
            and a.profile_id is distinct from n.profile_id
            and not exists (
              select 1 from public.guardianships g
              where g.guardian_id = n.profile_id and g.athlete_id = a.profile_id
            )
        ),
        'signed', (
          select count(*)::int from public.assessment_summaries s
          where s.round_id = p_round_id and s.author_id = n.profile_id and s.signed_at is not null
        ),
        'signed_late', (
          select count(*)::int from public.assessment_summaries s
          where s.round_id = p_round_id and s.author_id = n.profile_id and s.signed_at is not null
            and coalesce((select e.late from public.assessment_summary_events e
              where e.summary_id = s.id and e.kind = 'signed' order by e.at desc, e.id desc limit 1), false)
        ),
        'drafts', (
          select count(*)::int from public.assessment_summaries s
          where s.round_id = p_round_id and s.author_id = n.profile_id and s.signed_at is null
        ),
        'reopened', (
          select count(*)::int from public.assessment_summary_events e
          join public.assessment_summaries s on s.id = e.summary_id
          where s.round_id = p_round_id and s.author_id = n.profile_id and e.kind = 'reopened'
        )
      ) order by n.on_panel desc, n.name)
      from (
        select m.profile_id, coalesce(public.member_display_name(m.profile_id), m.profile_name) as name,
          true as on_panel
        from public.selection_round_panel m
        where m.round_id = p_round_id and m.removed_at is null and m.profile_id is not null
        union
        select s.author_id, coalesce(public.member_display_name(s.author_id), s.author_name), false
        from public.assessment_summaries s
        where s.round_id = p_round_id and s.author_id is not null
          and not exists (
            select 1 from public.selection_round_panel m
            where m.round_id = p_round_id and m.removed_at is null and m.profile_id = s.author_id
          )
      ) n
    ), '[]'::jsonb),
    'signed', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id,
        'selector_name', coalesce(public.member_display_name(s.author_id), s.author_name),
        'athlete_name', public.member_display_name(s.athlete_id),
        'signed_at', s.signed_at,
        'late', coalesce((select e.late from public.assessment_summary_events e
              where e.summary_id = s.id and e.kind = 'signed' order by e.at desc, e.id desc limit 1), false)
      ) order by coalesce(public.member_display_name(s.author_id), s.author_name), public.member_display_name(s.athlete_id))
      from public.assessment_summaries s
      where s.round_id = p_round_id and s.signed_at is not null
    ), '[]'::jsonb),
    'reopenings', coalesce((
      select jsonb_agg(jsonb_build_object(
        'selector_name', coalesce(public.member_display_name(s.author_id), s.author_name),
        'athlete_name', public.member_display_name(s.athlete_id),
        'by_name', e.by_name,
        'at', e.at
      ) order by e.at)
      from public.assessment_summary_events e
      join public.assessment_summaries s on s.id = e.summary_id
      where s.round_id = p_round_id and e.kind = 'reopened'
    ), '[]'::jsonb)
  );
end;
$$;
revoke execute on function public.admin_selection_summaries(uuid) from public, anon;
grant execute on function public.admin_selection_summaries(uuid) to authenticated;

-- Admins and the round's auditors (guard only changed).
create or replace function public.admin_selection_feedback(p_round_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_round public.selection_rounds;
  v_child uuid;
begin
  if not public.can_read_selection_audit(p_round_id) then
    raise exception 'Only admins can see the feedback record';
  end if;
  select * into v_round from public.selection_rounds r where r.id = p_round_id;
  if v_round.id is null then
    raise exception 'Round not found';
  end if;
  for v_child in
    select m.profile_id from public.team_members m
    where m.team_id = v_round.team_id and m.team_role = 'athlete'
  loop
    perform public.write_record_access(v_child, 'assessment_audit', p_round_id);
  end loop;

  return jsonb_build_object(
    'athletes', (
      select count(*)::int from public.team_members m
      where m.team_id = v_round.team_id and m.team_role = 'athlete'
    ),
    'shared', coalesce((
      select jsonb_agg(jsonb_build_object(
        'athlete_name', public.member_display_name(f.athlete_id),
        'shared_at', f.shared_at,
        'shared_by_name', (
          select e.by_name from public.assessment_feedback_events e
          where e.feedback_id = f.id and e.kind = 'shared' order by e.at desc, e.id desc limit 1
        ),
        'seen_at', f.seen_at,
        'withdrawn', (
          select count(*)::int from public.assessment_feedback_events e
          where e.feedback_id = f.id and e.kind = 'withdrawn'
        )
      ) order by public.member_display_name(f.athlete_id))
      from public.assessment_feedback f
      where f.round_id = p_round_id
        and exists (select 1 from public.assessment_feedback_events e where e.feedback_id = f.id)
    ), '[]'::jsonb)
  );
end;
$$;
revoke execute on function public.admin_selection_feedback(uuid) from public, anon;
grant execute on function public.admin_selection_feedback(uuid) to authenticated;


-- ---------------------------------------------------------------------------
-- Auditors read, and change nothing
-- ---------------------------------------------------------------------------

create or replace function public.my_selection_audits()
returns table (
  id uuid,
  name text,
  phase smallint,
  round_number smallint,
  team_name text,
  starts_on date,
  ends_on date,
  closed_at timestamptz,
  criteria_set_name text,
  athletes integer,
  observations integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select r.id, r.name, r.phase, r.round_number, coalesce(t.name, r.team_name), r.starts_on, r.ends_on, r.closed_at,
    coalesce(r.criteria_set_name, (select s.name from public.assessment_criteria_sets s where s.legacy limit 1)),
    (select count(*)::int from public.team_members m
      where m.team_id = r.team_id and m.team_role = 'athlete' and public.can_audit_athlete(r.id, m.profile_id)),
    (select count(*)::int from public.assessment_observations o
      where o.round_id = r.id and public.can_audit_athlete(r.id, o.athlete_id))
  from public.selection_rounds r
  left join public.teams t on t.id = r.team_id
  where public.audits_selection_round(r.id)
  order by (r.closed_at is not null), r.starts_on, r.name;
$$;
revoke execute on function public.my_selection_audits() from public, anon;
grant execute on function public.my_selection_audits() to authenticated;

create or replace function public.auditor_selection_round(p_round_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_round public.selection_rounds;
begin
  if not public.audits_selection_round(p_round_id) then
    raise exception 'You don’t audit this round';
  end if;
  select * into v_round from public.selection_rounds r where r.id = p_round_id;
  return jsonb_build_object(
    'id', v_round.id,
    'name', v_round.name,
    'phase', v_round.phase,
    'round_number', v_round.round_number,
    'team_name', coalesce((select t.name from public.teams t where t.id = v_round.team_id), v_round.team_name),
    'starts_on', v_round.starts_on,
    'ends_on', v_round.ends_on,
    'closed', v_round.closed_at is not null,
    'criteria', v_round.criteria,
    'criteria_set_name', coalesce(v_round.criteria_set_name,
      (select s.name from public.assessment_criteria_sets s where s.legacy limit 1)),
    'criteria_set_version', v_round.criteria_set_version,
    'today', public.club_today(),
    'hidden', (
      select count(*)::int from public.team_members m
      where m.team_id = v_round.team_id and m.team_role = 'athlete'
        and not public.can_audit_athlete(p_round_id, m.profile_id)
    ),
    'panel', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', coalesce(public.member_display_name(m.profile_id), m.profile_name),
        'added_at', m.added_at, 'added_by_name', m.added_by_name,
        'removed_at', m.removed_at, 'removed_by_name', m.removed_by_name,
        'independent', m.profile_id is not null and public.is_independent_selector(m.profile_id)
      ) order by (m.removed_at is not null), m.added_at, m.profile_name)
      from public.selection_round_panel m where m.round_id = p_round_id
    ), '[]'::jsonb),
    'auditors', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', coalesce(public.member_display_name(a.profile_id), a.profile_name),
        'added_at', a.added_at, 'added_by_name', a.added_by_name,
        'removed_at', a.removed_at, 'removed_by_name', a.removed_by_name
      ) order by (a.removed_at is not null), a.added_at, a.profile_name)
      from public.selection_round_auditors a where a.round_id = p_round_id
    ), '[]'::jsonb),
    'athletes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id,
        'name', public.display_name(p),
        'is_minor', public.is_minor(p.date_of_birth, p.under_17),
        'observations', (
          select count(*)::int from public.assessment_observations o
          where o.round_id = p_round_id and o.athlete_id = p.id
        ),
        'selectors', (
          select count(distinct coalesce(o.author_id::text, o.author_name))::int from public.assessment_observations o
          where o.round_id = p_round_id and o.athlete_id = p.id
        ),
        'summaries_signed', (
          select count(*)::int from public.assessment_summaries s
          where s.round_id = p_round_id and s.athlete_id = p.id and s.signed_at is not null
        ),
        'selectors_on_panel', (
          select count(*)::int from public.selection_round_panel m
          where m.round_id = p_round_id and m.removed_at is null
        ),
        'feedback', coalesce((
          select case when f.shared_at is not null then 'shared' else 'draft' end
          from public.assessment_feedback f where f.round_id = p_round_id and f.athlete_id = p.id
          order by f.updated_at desc limit 1
        ), 'none')
      ) order by public.display_name(p))
      from public.team_members m
      join public.profiles p on p.id = m.profile_id
      where m.team_id = v_round.team_id and m.team_role = 'athlete'
        and public.can_audit_athlete(p_round_id, m.profile_id)
    ), '[]'::jsonb)
  );
end;
$$;
revoke execute on function public.auditor_selection_round(uuid) from public, anon;
grant execute on function public.auditor_selection_round(uuid) to authenticated;

-- One athlete's whole assessment, for the round's auditor. Opening an under
-- 18's goes in their record views.
create or replace function public.auditor_athlete_assessment(p_round_id uuid, p_athlete_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_round public.selection_rounds;
  v_feedback public.assessment_feedback;
begin
  if not public.can_audit_athlete(p_round_id, p_athlete_id) then
    raise exception 'You can’t see this athlete’s assessment';
  end if;
  perform public.write_record_access(p_athlete_id, 'assessment', p_round_id);
  select * into v_round from public.selection_rounds r where r.id = p_round_id;
  select * into v_feedback from public.assessment_feedback f
  where f.round_id = p_round_id and f.athlete_id = p_athlete_id
  order by f.updated_at desc limit 1;

  return jsonb_build_object(
    'round_id', v_round.id,
    'round_name', v_round.name,
    'phase', v_round.phase,
    'round_number', v_round.round_number,
    'team_name', coalesce((select t.name from public.teams t where t.id = v_round.team_id), v_round.team_name),
    'starts_on', v_round.starts_on,
    'ends_on', v_round.ends_on,
    'closed', v_round.closed_at is not null,
    'criteria', v_round.criteria,
    'today', public.club_today(),
    'athlete_id', p_athlete_id,
    'athlete_name', public.member_display_name(p_athlete_id),
    'is_minor', (select public.is_minor(p.date_of_birth, p.under_17) from public.profiles p where p.id = p_athlete_id),
    'observations', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', o.id,
        'author_name', coalesce(public.member_display_name(o.author_id), o.author_name),
        'mine', false,
        'can_change', false,
        'context', o.context,
        'observed_on', o.observed_on,
        'note', o.note,
        'corrects_id', o.corrects_id,
        'created_at', o.created_at,
        'ratings', coalesce((
          select jsonb_agg(jsonb_build_object('item_key', ra.item_key, 'rating', ra.rating) order by ra.item_key)
          from public.assessment_observation_ratings ra where ra.observation_id = o.id
        ), '[]'::jsonb)
      ) order by o.observed_on desc, o.created_at desc)
      from public.assessment_observations o
      where o.round_id = p_round_id and o.athlete_id = p_athlete_id
    ), '[]'::jsonb),
    'summaries', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id,
        'author_name', coalesce(public.member_display_name(s.author_id), s.author_name),
        'ratings', s.ratings, 'recommendation', s.recommendation,
        'strengths', s.strengths, 'priorities', s.priorities, 'comments', s.comments,
        'signed_at', s.signed_at
      ) order by s.signed_at)
      from public.assessment_summaries s
      where s.round_id = p_round_id and s.athlete_id = p_athlete_id and s.signed_at is not null
    ), '[]'::jsonb),
    'unsigned', (
      select count(*)::int from public.assessment_summaries s
      where s.round_id = p_round_id and s.athlete_id = p_athlete_id and s.signed_at is null
    ),
    'summary_events', coalesce((
      select jsonb_agg(jsonb_build_object(
        'author_name', coalesce(public.member_display_name(s.author_id), s.author_name),
        'kind', e.kind, 'late', e.late, 'by_name', e.by_name, 'at', e.at
      ) order by e.at)
      from public.assessment_summary_events e
      join public.assessment_summaries s on s.id = e.summary_id
      where s.round_id = p_round_id and s.athlete_id = p_athlete_id
    ), '[]'::jsonb),
    'feedback', case
      when v_feedback.id is null then null
      when v_feedback.shared_at is null then jsonb_build_object('draft', true)
      else jsonb_build_object(
        'went_well', v_feedback.went_well, 'work_on', v_feedback.work_on,
        'author_name', coalesce(public.member_display_name(v_feedback.author_id), v_feedback.author_name),
        'shared_at', v_feedback.shared_at, 'seen_at', v_feedback.seen_at)
    end,
    'feedback_events', coalesce((
      select jsonb_agg(jsonb_build_object('kind', e.kind, 'by_name', e.by_name, 'at', e.at) order by e.at)
      from public.assessment_feedback_events e
      where e.feedback_id = v_feedback.id
    ), '[]'::jsonb)
  );
end;
$$;
revoke execute on function public.auditor_athlete_assessment(uuid, uuid) from public, anon;
grant execute on function public.auditor_athlete_assessment(uuid, uuid) to authenticated;

-- Admin rounds list, now with how many auditors each has.
drop function if exists public.admin_selection_rounds();
create or replace function public.admin_selection_rounds()
returns table (
  id uuid,
  team_id uuid,
  team_name text,
  season integer,
  name text,
  starts_on date,
  ends_on date,
  closed_at timestamptz,
  created_at timestamptz,
  athletes integer,
  observations integer,
  panel jsonb,
  criteria_set_id uuid,
  criteria_set_name text,
  criteria_set_version integer,
  can_change_criteria boolean,
  phase smallint,
  round_number smallint,
  auditors integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() or not public.selection_assessments_on() then
    raise exception 'Only admins can see the selection rounds';
  end if;
  return query
  select r.id, r.team_id, coalesce(t.name, r.team_name), r.season, r.name, r.starts_on, r.ends_on,
    r.closed_at, r.created_at,
    (select count(*)::int from public.team_members m
      where m.team_id = r.team_id and m.team_role = 'athlete'),
    (select count(*)::int from public.assessment_observations o where o.round_id = r.id),
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'profile_id', m.profile_id,
        'name', coalesce(public.member_display_name(m.profile_id), m.profile_name),
        'added_at', m.added_at,
        'added_by_name', m.added_by_name,
        'removed_at', m.removed_at,
        'removed_by_name', m.removed_by_name,
        'declared_conflict', exists (
          select 1 from public.conflict_declarations d
          where d.profile_id = m.profile_id and d.season = r.season and d.has_conflict
        ),
        'can_assess', m.profile_id is not null and public.can_join_selection_panel(m.profile_id),
        'independent', m.profile_id is not null and public.is_independent_selector(m.profile_id),
        'own_children', (
          select count(*)::int
          from public.guardianships g
          join public.team_members a on a.profile_id = g.athlete_id
            and a.team_id = r.team_id and a.team_role = 'athlete'
          where g.guardian_id = m.profile_id
        )
      ) order by (m.removed_at is not null), m.added_at, m.profile_name)
      from public.selection_round_panel m where m.round_id = r.id
    ), '[]'::jsonb),
    r.criteria_set_id,
    coalesce(r.criteria_set_name, (select s.name from public.assessment_criteria_sets s where s.legacy limit 1)),
    r.criteria_set_version,
    r.closed_at is null
      and not exists (select 1 from public.assessment_observations o where o.round_id = r.id)
      and not exists (select 1 from public.assessment_summaries su where su.round_id = r.id),
    r.phase, r.round_number,
    (select count(*)::int from public.selection_round_auditors a where a.round_id = r.id and a.removed_at is null)
  from public.selection_rounds r
  left join public.teams t on t.id = r.team_id
  order by (r.closed_at is not null), r.starts_on desc, r.created_at desc;
end;
$$;
revoke execute on function public.admin_selection_rounds() from public, anon;
grant execute on function public.admin_selection_rounds() to authenticated;

commit;
