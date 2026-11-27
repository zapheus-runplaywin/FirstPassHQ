-- Criteria sets: an admin keeps any number of named sets of criteria, each for
-- every squad and team or for chosen ones. A round picks its set when it opens
-- and keeps its own copy, as before. A set a round has used is archived, never
-- deleted. Nothing here updates or deletes an existing row.
begin;

create table if not exists public.assessment_criteria_sets (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 60),
  criteria jsonb not null default '{"groups": []}'::jsonb check (jsonb_typeof(criteria) = 'object'),
  version integer not null default 1 check (version >= 1),
  for_all boolean not null default true,
  -- The set made from the club's single criteria: rounds opened before sets existed used it.
  legacy boolean not null default false,
  archived_at timestamptz,
  archived_by_name text,
  created_by uuid references public.profiles (id) on delete set null,
  created_by_name text,
  created_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null,
  updated_by_name text,
  updated_at timestamptz not null default now()
);
create unique index if not exists assessment_criteria_sets_name_key
  on public.assessment_criteria_sets (lower(trim(name))) where archived_at is null;

create table if not exists public.assessment_criteria_set_groups (
  set_id uuid not null references public.assessment_criteria_sets (id) on delete cascade,
  team_id uuid references public.teams (id) on delete set null,
  team_name text not null,
  unique (set_id, team_name)
);

create table if not exists public.assessment_criteria_set_events (
  id uuid primary key default gen_random_uuid(),
  set_id uuid not null,
  set_name text not null,
  kind text not null check (kind in ('created', 'saved', 'renamed', 'for', 'archived', 'restored', 'deleted')),
  version integer,
  criteria jsonb,
  detail text,
  by_id uuid references public.profiles (id) on delete set null,
  by_name text,
  at timestamptz not null default now()
);
create index if not exists assessment_criteria_set_events_set_idx on public.assessment_criteria_set_events (set_id, at);

alter table public.assessment_criteria_sets enable row level security;
alter table public.assessment_criteria_set_groups enable row level security;
alter table public.assessment_criteria_set_events enable row level security;
revoke all on table public.assessment_criteria_sets from public, anon, authenticated;
revoke all on table public.assessment_criteria_set_groups from public, anon, authenticated;
revoke all on table public.assessment_criteria_set_events from public, anon, authenticated;
grant all on table public.assessment_criteria_sets to service_role;
grant all on table public.assessment_criteria_set_groups to service_role;
grant all on table public.assessment_criteria_set_events to service_role;

alter table public.selection_rounds
  add column if not exists criteria_set_id uuid references public.assessment_criteria_sets (id),
  add column if not exists criteria_set_name text,
  add column if not exists criteria_set_version integer;
create index if not exists selection_rounds_criteria_set_idx on public.selection_rounds (criteria_set_id);

-- Today's single criteria become the first set, once.
insert into public.assessment_criteria_sets (name, criteria, for_all, legacy, created_by, created_by_name, updated_by, updated_by_name, created_at, updated_at)
select 'Club criteria', c.criteria, true, true, c.updated_by, public.member_display_name(c.updated_by),
  c.updated_by, public.member_display_name(c.updated_by), c.updated_at, c.updated_at
from public.assessment_criteria c
where c.id
  and jsonb_array_length(coalesce(c.criteria -> 'groups', '[]'::jsonb)) > 0
  and not exists (select 1 from public.assessment_criteria_sets);

insert into public.assessment_criteria_set_events (set_id, set_name, kind, version, criteria, detail, by_id, by_name, at)
select s.id, s.name, 'created', 1, s.criteria, 'Made from the club’s criteria when criteria sets were added',
  s.created_by, s.created_by_name, s.created_at
from public.assessment_criteria_sets s
where not exists (select 1 from public.assessment_criteria_set_events e where e.set_id = s.id);

-- Whether a set can be chosen for this squad or team.
create or replace function public.criteria_set_fits(p_set_id uuid, p_team_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.assessment_criteria_sets s
    join public.teams g on g.id = p_team_id
    left join public.teams sq on sq.id = g.squad_id
    where s.id = p_set_id
      and s.archived_at is null
      and jsonb_array_length(coalesce(s.criteria -> 'groups', '[]'::jsonb)) > 0
      and (
        s.for_all
        or exists (
          select 1 from public.assessment_criteria_set_groups x
          where x.set_id = s.id
            and (
              x.team_id in (g.id, g.squad_id)
              or lower(x.team_name) in (lower(g.name), lower(sq.name))
            )
        )
      )
  );
$$;
revoke execute on function public.criteria_set_fits(uuid, uuid) from public, anon, authenticated;

-- What changed about a round, and who changed it. Never removed.
create table if not exists public.selection_round_events (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references public.selection_rounds (id) on delete cascade,
  kind text not null check (kind in ('opened', 'renamed', 'dates', 'phase', 'criteria', 'closed', 'reopened')),
  detail text,
  by_id uuid references public.profiles (id) on delete set null,
  by_name text,
  at timestamptz not null default now()
);
create index if not exists selection_round_events_round_idx on public.selection_round_events (round_id, at);
alter table public.selection_round_events enable row level security;
revoke all on table public.selection_round_events from public, anon, authenticated;
grant all on table public.selection_round_events to service_role;

-- How many rounds have used a set. Rounds opened before sets existed count
-- against the set made from the club's old criteria.
create or replace function public.criteria_set_rounds(p_set_id uuid)
returns integer language sql stable security definer set search_path = '' as $$
  select count(*)::int
  from public.selection_rounds r
  where r.criteria_set_id = p_set_id
     or (r.criteria_set_id is null
         and exists (select 1 from public.assessment_criteria_sets s where s.id = p_set_id and s.legacy));
$$;
revoke execute on function public.criteria_set_rounds(uuid) from public, anon, authenticated;

-- Items in a set of criteria.
create or replace function public.criteria_item_count(p_criteria jsonb)
returns integer language sql immutable security definer set search_path = '' as $$
  select coalesce(sum(jsonb_array_length(coalesce(g -> 'items', '[]'::jsonb))), 0)::int
  from jsonb_array_elements(coalesce(p_criteria -> 'groups', '[]'::jsonb)) g;
$$;
revoke execute on function public.criteria_item_count(jsonb) from public, anon, authenticated;

-- Who a set is for, in words.
create or replace function public.criteria_set_for_label(p_set_id uuid)
returns text language sql stable security definer set search_path = '' as $$
  select case
    when s.for_all then 'Every squad and team'
    else coalesce((
      select string_agg(
        coalesce(t.name, x.team_name) || case when t.kind = 'squad' then ' and its teams' else '' end,
        ', ' order by coalesce(t.name, x.team_name))
      from public.assessment_criteria_set_groups x
      left join public.teams t on t.id = x.team_id
      where x.set_id = s.id
    ), '')
  end
  from public.assessment_criteria_sets s where s.id = p_set_id;
$$;
revoke execute on function public.criteria_set_for_label(uuid) from public, anon, authenticated;

-- The set the app chooses for a squad or team: the one set named for it, else
-- the only set that fits, else none.
create or replace function public.criteria_set_default(p_team_id uuid)
returns uuid language plpgsql stable security definer set search_path = '' as $$
declare
  v_ids uuid[];
begin
  select array_agg(s.id) into v_ids
  from public.assessment_criteria_sets s
  where not s.for_all and public.criteria_set_fits(s.id, p_team_id);
  if coalesce(array_length(v_ids, 1), 0) = 1 then
    return v_ids[1];
  end if;
  select array_agg(s.id) into v_ids
  from public.assessment_criteria_sets s
  where public.criteria_set_fits(s.id, p_team_id);
  if coalesce(array_length(v_ids, 1), 0) = 1 then
    return v_ids[1];
  end if;
  return null;
end;
$$;
revoke execute on function public.criteria_set_default(uuid) from public, anon, authenticated;

-- Every set, for admins: those in use first, then archived, each by name.
create or replace function public.admin_criteria_sets()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() or not public.selection_assessments_on() then
    raise exception 'Only admins can see the criteria sets';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', s.id, 'name', s.name, 'version', s.version, 'for_all', s.for_all,
      'for_label', public.criteria_set_for_label(s.id),
      'groups', jsonb_array_length(coalesce(s.criteria -> 'groups', '[]'::jsonb)),
      'items', public.criteria_item_count(s.criteria),
      'rounds', public.criteria_set_rounds(s.id),
      'archived_at', s.archived_at, 'archived_by_name', s.archived_by_name,
      'updated_at', s.updated_at, 'updated_by_name', s.updated_by_name
    ) order by (s.archived_at is not null), lower(s.name), s.created_at)
    from public.assessment_criteria_sets s
  ), '[]'::jsonb);
end;
$$;
revoke execute on function public.admin_criteria_sets() from public, anon;
grant execute on function public.admin_criteria_sets() to authenticated;

-- One set, with the rounds that used it and its history.
create or replace function public.admin_criteria_set(p_set_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v public.assessment_criteria_sets;
begin
  if not public.is_admin() or not public.selection_assessments_on() then
    raise exception 'Only admins can see the criteria sets';
  end if;
  select * into v from public.assessment_criteria_sets s where s.id = p_set_id;
  if v.id is null then
    raise exception 'Criteria set not found';
  end if;
  return jsonb_build_object(
    'id', v.id, 'name', v.name, 'version', v.version, 'criteria', v.criteria,
    'for_all', v.for_all,
    'for', coalesce((
      select jsonb_agg(jsonb_build_object('team_id', x.team_id, 'team_name', coalesce(t.name, x.team_name))
        order by coalesce(t.name, x.team_name))
      from public.assessment_criteria_set_groups x
      left join public.teams t on t.id = x.team_id
      where x.set_id = v.id
    ), '[]'::jsonb),
    'for_label', public.criteria_set_for_label(v.id),
    'rounds', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id, 'name', r.name, 'team_name', coalesce(t.name, r.team_name),
        'starts_on', r.starts_on, 'ends_on', r.ends_on,
        'criteria_set_version', r.criteria_set_version
      ) order by r.starts_on desc, r.created_at desc)
      from public.selection_rounds r
      left join public.teams t on t.id = r.team_id
      where r.criteria_set_id = v.id or (r.criteria_set_id is null and v.legacy)
    ), '[]'::jsonb),
    'archived_at', v.archived_at,
    'events', coalesce((
      select jsonb_agg(jsonb_build_object(
        'kind', e.kind, 'version', e.version, 'detail', e.detail, 'by_name', e.by_name, 'at', e.at
      ) order by e.at desc, e.id)
      from public.assessment_criteria_set_events e where e.set_id = v.id
    ), '[]'::jsonb)
  );
end;
$$;
revoke execute on function public.admin_criteria_set(uuid) from public, anon;
grant execute on function public.admin_criteria_set(uuid) to authenticated;

-- Make or change a set. Returns its id.
create or replace function public.admin_save_criteria_set(
  p_set_id uuid,
  p_name text,
  p_criteria jsonb,
  p_for_all boolean,
  p_team_ids uuid[]
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_old public.assessment_criteria_sets;
  v_name text := trim(coalesce(p_name, ''));
  v_criteria jsonb;
  v_id uuid;
  v_for_all boolean := coalesce(p_for_all, true);
  v_old_label text;
  v_new_label text;
  v_me text := public.member_display_name(auth.uid());
begin
  if not public.is_admin() or not public.selection_assessments_on() then
    raise exception 'Only admins can change the criteria sets';
  end if;
  if p_set_id is not null then
    select * into v_old from public.assessment_criteria_sets s where s.id = p_set_id for update;
    if v_old.id is null then
      raise exception 'Criteria set not found';
    end if;
    if v_old.archived_at is not null then
      raise exception 'Bring this set back before you change it';
    end if;
  end if;
  if length(v_name) not between 1 and 60 then
    raise exception 'Name the set, in up to 60 characters';
  end if;
  if exists (
    select 1 from public.assessment_criteria_sets s
    where s.archived_at is null and lower(trim(s.name)) = lower(v_name)
      and s.id is distinct from p_set_id
  ) then
    raise exception 'Another set is called “%”', v_name;
  end if;
  v_criteria := public.check_assessment_criteria(p_criteria);
  if jsonb_array_length(coalesce(v_criteria -> 'groups', '[]'::jsonb)) = 0 then
    raise exception 'Add at least one group of criteria';
  end if;
  if not v_for_all and (
    coalesce(array_length(p_team_ids, 1), 0) = 0
    or exists (
      select 1 from unnest(p_team_ids) i
      where not exists (select 1 from public.teams t where t.id = i and not t.archived)
    )
  ) then
    raise exception 'Choose the squads or teams this set is for';
  end if;

  if p_set_id is null then
    insert into public.assessment_criteria_sets (name, criteria, version, for_all,
      created_by, created_by_name, updated_by, updated_by_name)
    values (v_name, v_criteria, 1, v_for_all, auth.uid(), v_me, auth.uid(), v_me)
    returning id into v_id;
    if not v_for_all then
      insert into public.assessment_criteria_set_groups (set_id, team_id, team_name)
      select distinct on (lower(t.name)) v_id, t.id, t.name
      from public.teams t where t.id = any (p_team_ids)
      order by lower(t.name), t.id;
    end if;
    insert into public.assessment_criteria_set_events (set_id, set_name, kind, version, criteria, detail, by_id, by_name)
    values (v_id, v_name, 'created', 1, v_criteria, public.criteria_set_for_label(v_id), auth.uid(), v_me);
    return v_id;
  end if;

  v_id := p_set_id;
  v_old_label := public.criteria_set_for_label(v_id);
  if v_old.name <> v_name then
    insert into public.assessment_criteria_set_events (set_id, set_name, kind, detail, by_id, by_name)
    values (v_id, v_name, 'renamed', format('From “%s” to “%s”', v_old.name, v_name), auth.uid(), v_me);
  end if;
  update public.assessment_criteria_sets s
    set name = v_name,
        for_all = v_for_all,
        criteria = v_criteria,
        version = case when v_criteria is distinct from v_old.criteria then s.version + 1 else s.version end,
        updated_by = auth.uid(), updated_by_name = v_me, updated_at = now()
    where s.id = v_id;
  if v_criteria is distinct from v_old.criteria then
    insert into public.assessment_criteria_set_events (set_id, set_name, kind, version, criteria, by_id, by_name)
    values (v_id, v_name, 'saved', v_old.version + 1, v_criteria, auth.uid(), v_me);
  end if;
  delete from public.assessment_criteria_set_groups x where x.set_id = v_id;
  if not v_for_all then
    insert into public.assessment_criteria_set_groups (set_id, team_id, team_name)
    select distinct on (lower(t.name)) v_id, t.id, t.name
    from public.teams t where t.id = any (p_team_ids)
    order by lower(t.name), t.id;
  end if;
  v_new_label := public.criteria_set_for_label(v_id);
  if v_new_label is distinct from v_old_label then
    insert into public.assessment_criteria_set_events (set_id, set_name, kind, detail, by_id, by_name)
    values (v_id, v_name, 'for', v_new_label, auth.uid(), v_me);
  end if;
  return v_id;
end;
$$;
revoke execute on function public.admin_save_criteria_set(uuid, text, jsonb, boolean, uuid[]) from public, anon;
grant execute on function public.admin_save_criteria_set(uuid, text, jsonb, boolean, uuid[]) to authenticated;

-- Archive a set, or bring it back.
create or replace function public.admin_archive_criteria_set(p_set_id uuid, p_archived boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v public.assessment_criteria_sets;
  v_me text := public.member_display_name(auth.uid());
begin
  if not public.is_admin() or not public.selection_assessments_on() then
    raise exception 'Only admins can change the criteria sets';
  end if;
  select * into v from public.assessment_criteria_sets s where s.id = p_set_id for update;
  if v.id is null then
    raise exception 'Criteria set not found';
  end if;
  if coalesce(p_archived, true) then
    if v.archived_at is not null then
      return;
    end if;
    update public.assessment_criteria_sets s
      set archived_at = now(), archived_by_name = v_me where s.id = v.id;
    insert into public.assessment_criteria_set_events (set_id, set_name, kind, by_id, by_name)
    values (v.id, v.name, 'archived', auth.uid(), v_me);
  else
    if v.archived_at is null then
      return;
    end if;
    if exists (
      select 1 from public.assessment_criteria_sets s
      where s.archived_at is null and lower(trim(s.name)) = lower(trim(v.name))
    ) then
      raise exception 'Another set is called “%”. Rename one first.', v.name;
    end if;
    update public.assessment_criteria_sets s
      set archived_at = null, archived_by_name = null where s.id = v.id;
    insert into public.assessment_criteria_set_events (set_id, set_name, kind, by_id, by_name)
    values (v.id, v.name, 'restored', auth.uid(), v_me);
  end if;
end;
$$;
revoke execute on function public.admin_archive_criteria_set(uuid, boolean) from public, anon;
grant execute on function public.admin_archive_criteria_set(uuid, boolean) to authenticated;

-- Delete a set no round has used. Its history stays.
create or replace function public.admin_delete_criteria_set(p_set_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v public.assessment_criteria_sets;
begin
  if not public.is_admin() or not public.selection_assessments_on() then
    raise exception 'Only admins can change the criteria sets';
  end if;
  select * into v from public.assessment_criteria_sets s where s.id = p_set_id for update;
  if v.id is null then
    raise exception 'Criteria set not found';
  end if;
  if public.criteria_set_rounds(v.id) > 0 then
    raise exception 'A round has used this set, so it can be archived, not deleted';
  end if;
  insert into public.assessment_criteria_set_events (set_id, set_name, kind, by_id, by_name)
  values (v.id, v.name, 'deleted', auth.uid(), public.member_display_name(auth.uid()));
  delete from public.assessment_criteria_sets s where s.id = v.id;
end;
$$;
revoke execute on function public.admin_delete_criteria_set(uuid) from public, anon;
grant execute on function public.admin_delete_criteria_set(uuid) to authenticated;

-- The sets an admin can choose for a round of this squad or team.
create or replace function public.admin_selection_round_set_choices(p_team_id uuid)
returns table (set_id uuid, name text, version integer, groups integer, items integer,
  for_label text, is_default boolean)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_default uuid;
begin
  if not public.is_admin() or not public.selection_assessments_on() then
    raise exception 'Only admins can see the criteria sets';
  end if;
  v_default := public.criteria_set_default(p_team_id);
  return query
  select s.id, s.name, s.version,
    jsonb_array_length(coalesce(s.criteria -> 'groups', '[]'::jsonb)),
    public.criteria_item_count(s.criteria),
    public.criteria_set_for_label(s.id),
    s.id = v_default
  from public.assessment_criteria_sets s
  where public.criteria_set_fits(s.id, p_team_id)
  order by lower(s.name), s.created_at;
end;
$$;
revoke execute on function public.admin_selection_round_set_choices(uuid) from public, anon;
grant execute on function public.admin_selection_round_set_choices(uuid) to authenticated;

-- Swap a round's set, until assessing starts.
create or replace function public.admin_set_selection_round_criteria(p_round_id uuid, p_set_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_round public.selection_rounds;
  v_set public.assessment_criteria_sets;
  v_old_name text;
begin
  if not public.is_admin() or not public.selection_assessments_on() then
    raise exception 'Only admins can change a round’s criteria';
  end if;
  select * into v_round from public.selection_rounds r where r.id = p_round_id for update;
  if v_round.id is null then
    raise exception 'Round not found';
  end if;
  if v_round.closed_at is not null then
    raise exception 'This round is closed';
  end if;
  if exists (select 1 from public.assessment_observations o where o.round_id = v_round.id)
     or exists (select 1 from public.assessment_summaries s where s.round_id = v_round.id) then
    raise exception 'Assessing has started, so this round keeps its criteria';
  end if;
  if not public.criteria_set_fits(p_set_id, v_round.team_id) then
    raise exception 'That criteria set isn’t for %',
      coalesce((select t.name from public.teams t where t.id = v_round.team_id), v_round.team_name);
  end if;
  select * into v_set from public.assessment_criteria_sets s where s.id = p_set_id;
  v_old_name := coalesce(v_round.criteria_set_name,
    (select s.name from public.assessment_criteria_sets s where s.legacy limit 1));
  update public.selection_rounds r
    set criteria = v_set.criteria, criteria_set_id = v_set.id,
        criteria_set_name = v_set.name, criteria_set_version = v_set.version
    where r.id = v_round.id;
  insert into public.selection_round_events (round_id, kind, detail, by_id, by_name)
  values (v_round.id, 'criteria',
    format('From “%s” to “%s, version %s”', coalesce(v_old_name, 'no set'), v_set.name, v_set.version),
    auth.uid(), public.member_display_name(auth.uid()));
end;
$$;
revoke execute on function public.admin_set_selection_round_criteria(uuid, uuid) from public, anon;
grant execute on function public.admin_set_selection_round_criteria(uuid, uuid) to authenticated;

-- Opening a round now takes a criteria set (chosen for the admin when one fits).
drop function if exists public.admin_open_selection_round(uuid, text, date, date);
create or replace function public.admin_open_selection_round(
  p_team_id uuid,
  p_name text,
  p_starts_on date,
  p_ends_on date,
  p_set_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_team public.teams;
  v_set public.assessment_criteria_sets;
  v_set_id uuid;
  v_id uuid;
  v_me text := public.member_display_name(auth.uid());
begin
  if not public.is_admin() or not public.selection_assessments_on() then
    raise exception 'Only admins can open a selection round';
  end if;
  select * into v_team from public.teams t where t.id = p_team_id and not t.archived;
  if v_team.id is null then
    raise exception 'Choose a squad or team from this season';
  end if;
  if length(trim(coalesce(p_name, ''))) not between 1 and 80 then
    raise exception 'Name the round, in up to 80 characters';
  end if;
  if p_starts_on is null or p_ends_on is null then
    raise exception 'Choose when the round starts and ends';
  end if;
  if p_ends_on < p_starts_on then
    raise exception 'The round ends before it starts';
  end if;
  if p_ends_on > p_starts_on + 366 then
    raise exception 'Keep a round to a year or less';
  end if;
  if not exists (
    select 1 from public.assessment_criteria_sets s
    where s.archived_at is null and jsonb_array_length(coalesce(s.criteria -> 'groups', '[]'::jsonb)) > 0
  ) then
    raise exception 'Add a criteria set first';
  end if;
  v_set_id := coalesce(p_set_id, public.criteria_set_default(p_team_id));
  if v_set_id is null then
    raise exception 'Choose the criteria for this round';
  end if;
  if not public.criteria_set_fits(v_set_id, p_team_id) then
    raise exception 'That criteria set isn’t for %', v_team.name;
  end if;
  select * into v_set from public.assessment_criteria_sets s where s.id = v_set_id;
  if exists (
    select 1 from public.selection_rounds r where r.team_id = p_team_id and r.closed_at is null
  ) then
    raise exception '% already has an open round. Close it first.', v_team.name;
  end if;

  insert into public.selection_rounds (team_id, team_name, season, name, starts_on, ends_on, criteria,
    criteria_set_id, criteria_set_name, criteria_set_version, created_by, created_by_name)
  values (p_team_id, v_team.name, v_team.season, trim(p_name), p_starts_on, p_ends_on, v_set.criteria,
    v_set.id, v_set.name, v_set.version, auth.uid(), v_me)
  returning id into v_id;

  insert into public.selection_round_panel (round_id, profile_id, profile_name, added_by, added_by_name)
  select v_id, m.profile_id, coalesce(public.member_display_name(m.profile_id), 'Member'), auth.uid(), v_me
  from public.team_members m
  where m.team_id = p_team_id and m.team_role = 'coach'
    and public.can_join_selection_panel(m.profile_id);

  insert into public.selection_round_events (round_id, kind, detail, by_id, by_name)
  values (v_id, 'opened', format('%s, version %s', v_set.name, v_set.version), auth.uid(), v_me);

  return v_id;
end;
$$;
revoke execute on function public.admin_open_selection_round(uuid, text, date, date, uuid) from public, anon;
grant execute on function public.admin_open_selection_round(uuid, text, date, date, uuid) to authenticated;

-- Every round, now with its criteria set.
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
  can_change_criteria boolean
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
      and not exists (select 1 from public.assessment_summaries su where su.round_id = r.id)
  from public.selection_rounds r
  left join public.teams t on t.id = r.team_id
  order by (r.closed_at is not null), r.starts_on desc, r.created_at desc;
end;
$$;
revoke execute on function public.admin_selection_rounds() from public, anon;
grant execute on function public.admin_selection_rounds() to authenticated;

-- For an app that hasn't updated: the oldest set in use stands in for the
-- club's single criteria.
create or replace function public.admin_assessment_criteria()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() or not public.selection_assessments_on() then
    raise exception 'Only admins can see the assessment criteria';
  end if;
  return coalesce(
    (select s.criteria from public.assessment_criteria_sets s
      where s.archived_at is null order by s.created_at, s.id limit 1),
    '{"groups": []}'::jsonb
  );
end;
$$;
revoke execute on function public.admin_assessment_criteria() from public, anon;
grant execute on function public.admin_assessment_criteria() to authenticated;

create or replace function public.admin_save_assessment_criteria(p_criteria jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.assessment_criteria_sets;
  v_name text := 'Club criteria';
  v_n integer := 1;
begin
  if not public.is_admin() or not public.selection_assessments_on() then
    raise exception 'Only admins can change the assessment criteria';
  end if;
  select * into v from public.assessment_criteria_sets s
    where s.archived_at is null order by s.created_at, s.id limit 1;
  if v.id is not null then
    perform public.admin_save_criteria_set(v.id, v.name, p_criteria, v.for_all,
      (select array_agg(x.team_id) from public.assessment_criteria_set_groups x
        where x.set_id = v.id and x.team_id is not null));
    return;
  end if;
  while exists (select 1 from public.assessment_criteria_sets s
                where s.archived_at is null and lower(s.name) = lower(v_name)) loop
    v_n := v_n + 1;
    v_name := 'Club criteria ' || v_n;
  end loop;
  perform public.admin_save_criteria_set(null, v_name, p_criteria, true, null);
end;
$$;
revoke execute on function public.admin_save_assessment_criteria(jsonb) from public, anon;
grant execute on function public.admin_save_assessment_criteria(jsonb) to authenticated;

commit;
