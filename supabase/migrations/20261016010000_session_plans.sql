-- Session plans (Matt, 2026-10-16).
--
-- Coaches (head and assistant), and admins, keep a plan for each training
-- session, before or after it, for governance: free text, photos and files
-- such as PDFs or Word documents. The session's details can be filled in from
-- the coach's calendar, but are copied, not linked, so a later calendar change
-- doesn't change the plan.
--
-- The author shares a plan with the other coaches of its squad or team, its
-- athletes (and so the parents and guardians of athletes under 18) and chosen
-- coaches of other squads and teams. Sharing is read only: nobody can comment
-- or react, so it adds no social features for members under 18.
--
-- The author and admins can edit a plan and remove its files. Only admins
-- delete a whole plan. Admins see every plan and a governance report of which
-- squads and teams have plans for which days. Plans follow the attendance keep
-- period, once an admin has switched on "Remove old records".
--
-- Additive only: new tables, a private storage bucket, new functions and
-- policies, and purge_expired_records() replaced to add plans.

begin;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.session_plans (
  id uuid primary key default gen_random_uuid(),
  -- The squad or team the session was for. Its name is kept too, so the
  -- record still reads correctly if the group is renamed or removed.
  team_id uuid references public.teams (id) on delete set null,
  team_name text not null,
  title text not null check (length(btrim(title)) between 1 and 120),
  session_on date not null,
  starts_at time,
  ends_at time,
  location text check (length(location) <= 200),
  notes text check (length(notes) <= 20000),
  -- Who ran the session when it wasn't the author, such as the S&C partner.
  run_by text check (length(run_by) <= 120),
  share_team_coaches boolean not null default true,
  share_athletes boolean not null default false,
  -- No foreign key, so the record outlives the author's account.
  author_id uuid not null,
  author_name text not null,
  -- Head coach, Assistant coach or Admin, when the plan was added.
  author_position text not null,
  copied_from uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  edited_at timestamptz,
  edited_by_name text
);

create index if not exists session_plans_team_idx on public.session_plans (team_id, session_on);
create index if not exists session_plans_author_idx on public.session_plans (author_id, session_on);
create index if not exists session_plans_session_on_idx on public.session_plans (session_on);

drop trigger if exists session_plans_touch_updated_at on public.session_plans;
create trigger session_plans_touch_updated_at
  before update on public.session_plans
  for each row execute function public.touch_updated_at();

-- Photos and files attached to a plan, stored in the session-plans bucket.
create table if not exists public.session_plan_files (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.session_plans (id) on delete cascade,
  path text not null unique,
  name text not null check (length(name) between 1 and 200),
  content_type text not null,
  size_bytes bigint,
  added_by uuid,
  added_by_name text,
  created_at timestamptz not null default now()
);

create index if not exists session_plan_files_plan_idx on public.session_plan_files (plan_id);

-- Coaches of other squads and teams the author shared a plan with.
create table if not exists public.session_plan_shares (
  plan_id uuid not null references public.session_plans (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (plan_id, profile_id)
);

create index if not exists session_plan_shares_profile_idx on public.session_plan_shares (profile_id);

-- When each member first and last opened a plan. Marks plans as new in the
-- Shared tab until they are opened.
create table if not exists public.session_plan_views (
  plan_id uuid not null references public.session_plans (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  first_viewed_at timestamptz not null default now(),
  last_viewed_at timestamptz not null default now(),
  primary key (plan_id, profile_id)
);

alter table public.session_plans enable row level security;
alter table public.session_plan_files enable row level security;
alter table public.session_plan_shares enable row level security;
alter table public.session_plan_views enable row level security;

-- Read through the policies below; written only through the functions below.
revoke all on table public.session_plans from public, anon, authenticated;
revoke all on table public.session_plan_files from public, anon, authenticated;
revoke all on table public.session_plan_shares from public, anon, authenticated;
revoke all on table public.session_plan_views from public, anon, authenticated;
grant select on table public.session_plans to authenticated;
grant select on table public.session_plan_files to authenticated;
grant select on table public.session_plan_shares to authenticated;

-- ---------------------------------------------------------------------------
-- Who can do what
-- ---------------------------------------------------------------------------

-- Whether the club has session plans switched on (Club settings). On unless an
-- admin has turned them off.
create or replace function public.session_plans_on()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select (s.features ->> 'sessionPlans')::boolean is distinct from false
     from public.club_settings s where s.id),
    true
  );
$$;
revoke execute on function public.session_plans_on() from public, anon;
grant execute on function public.session_plans_on() to authenticated;

-- Whether the signed-in member coaches this current squad or team.
create or replace function public.coaches_group(p_team_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_approved() and public.can_work_with_children() and exists (
    select 1
    from public.team_members tm
    join public.teams t on t.id = tm.team_id
    where tm.team_id = p_team_id
      and tm.profile_id = auth.uid()
      and tm.team_role = 'coach'
      and not t.archived
  );
$$;
revoke execute on function public.coaches_group(uuid) from public, anon;
grant execute on function public.coaches_group(uuid) to authenticated;

-- Coaches add plans for the squads and teams they coach; admins for any.
create or replace function public.can_add_session_plan(p_team_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.session_plans_on() and (public.is_admin() or public.coaches_group(p_team_id));
$$;
revoke execute on function public.can_add_session_plan(uuid) from public, anon;
grant execute on function public.can_add_session_plan(uuid) to authenticated;

-- The author changes their own plan while they can still work with children;
-- admins change any plan.
create or replace function public.can_edit_session_plan(p_plan_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.session_plans_on() and exists (
    select 1 from public.session_plans p
    where p.id = p_plan_id
      and (
        public.is_admin()
        or (p.author_id = auth.uid() and public.is_approved() and public.can_work_with_children())
      )
  );
$$;
revoke execute on function public.can_edit_session_plan(uuid) from public, anon;
grant execute on function public.can_edit_session_plan(uuid) to authenticated;

-- Whether a plan has been shared with the signed-in member: as another coach
-- of its squad or team, as one of its athletes, as the parent or guardian of
-- one of its athletes under 18, or by name as a coach of another group. Admins
-- see every plan, but plans aren't "shared" with them by being admins.
create or replace function public.session_plan_shared_with_me(p_plan public.session_plans)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_plan.author_id <> auth.uid() and public.is_approved() and (
    (p_plan.share_team_coaches and p_plan.team_id is not null
      and public.coaches_group(p_plan.team_id))
    or (p_plan.share_athletes and p_plan.team_id is not null and exists (
      select 1 from public.team_members tm
      join public.teams t on t.id = tm.team_id
      where tm.team_id = p_plan.team_id
        and tm.team_role = 'athlete'
        and not t.archived
        and (tm.profile_id = auth.uid() or public.is_guardian_of(tm.profile_id))
    ))
    or (public.can_work_with_children() and exists (
      select 1 from public.session_plan_shares s
      where s.plan_id = p_plan.id and s.profile_id = auth.uid()
    ))
  );
$$;
revoke execute on function public.session_plan_shared_with_me(public.session_plans) from public, anon;
grant execute on function public.session_plan_shared_with_me(public.session_plans) to authenticated;

create or replace function public.can_view_session_plan(p_plan_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.session_plans_on() and exists (
    select 1 from public.session_plans p
    where p.id = p_plan_id
      and (
        public.is_admin()
        or (p.author_id = auth.uid() and public.is_approved())
        or public.session_plan_shared_with_me(p)
      )
  );
$$;
revoke execute on function public.can_view_session_plan(uuid) from public, anon;
grant execute on function public.can_view_session_plan(uuid) to authenticated;

drop policy if exists "Authors, admins and those shared with see session plans" on public.session_plans;
create policy "Authors, admins and those shared with see session plans"
  on public.session_plans for select to authenticated
  using (public.can_view_session_plan(id));

drop policy if exists "Whoever sees a session plan sees its files" on public.session_plan_files;
create policy "Whoever sees a session plan sees its files"
  on public.session_plan_files for select to authenticated
  using (public.can_view_session_plan(plan_id));

-- Only the author and admins see who a plan was shared with by name.
drop policy if exists "Authors and admins see who a plan is shared with" on public.session_plan_shares;
create policy "Authors and admins see who a plan is shared with"
  on public.session_plan_shares for select to authenticated
  using (public.can_edit_session_plan(plan_id));

-- ---------------------------------------------------------------------------
-- Files
-- ---------------------------------------------------------------------------

-- Private: files are only reachable through short-lived signed links.
-- 10 MB each: photos, PDFs and Word documents.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'session-plans', 'session-plans', false, 10485760,
  array[
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/heic',
    'image/heif',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]
)
on conflict (id) do nothing;

-- Files are stored as <plan id>/<upload id>/<file name>. Returns the plan a
-- path belongs to, or null when the path isn't in that shape.
create or replace function public.session_plan_of(p_name text)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_parts text[] := string_to_array(p_name, '/');
  v_uuid constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
begin
  if coalesce(array_length(v_parts, 1), 0) <> 3
    or v_parts[1] !~ v_uuid or v_parts[2] !~ v_uuid or v_parts[3] = '' then
    return null;
  end if;
  return v_parts[1]::uuid;
end;
$$;
revoke execute on function public.session_plan_of(text) from public, anon;
grant execute on function public.session_plan_of(text) to authenticated;

drop policy if exists "Authors and admins upload session plan files" on storage.objects;
create policy "Authors and admins upload session plan files"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'session-plans'
    and public.session_plan_of(name) is not null
    and public.can_edit_session_plan(public.session_plan_of(name))
  );

drop policy if exists "Whoever sees a session plan sees its files" on storage.objects;
create policy "Whoever sees a session plan sees its files"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'session-plans'
    and public.session_plan_of(name) is not null
    and public.can_view_session_plan(public.session_plan_of(name))
  );

-- The author and admins can remove a file, for example a wrong photo. Files
-- can't be replaced in place.
drop policy if exists "Authors and admins remove session plan files" on storage.objects;
create policy "Authors and admins remove session plan files"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'session-plans'
    and public.session_plan_of(name) is not null
    and public.can_edit_session_plan(public.session_plan_of(name))
  );

-- ---------------------------------------------------------------------------
-- Notifications
-- ---------------------------------------------------------------------------

-- Who has been told about a plan, so each person is told once: when it is
-- first shared with them, not when it is changed later (Matt, 2026-10-16).
create table if not exists public.session_plan_notices (
  plan_id uuid not null references public.session_plans (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  notified_at timestamptz not null default now(),
  primary key (plan_id, profile_id)
);

alter table public.session_plan_notices enable row level security;
revoke all on table public.session_plan_notices from public, anon, authenticated;

-- Everyone a plan is shared with right now, by the same rules as
-- session_plan_shared_with_me(), leaving out its author.
create or replace function public.session_plan_audience(p_plan_id uuid)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  with plan as (select * from public.session_plans where id = p_plan_id),
  people as (
    -- The other coaches of its squad or team, while they can work with children.
    select tm.profile_id
    from plan p
    join public.team_members tm on tm.team_id = p.team_id and tm.team_role = 'coach'
    join public.teams t on t.id = tm.team_id and not t.archived
    join public.profiles c on c.id = tm.profile_id
    where p.share_team_coaches and c.stood_down_at is null and public.is_cleared(c.id)
    union
    -- Its athletes.
    select tm.profile_id
    from plan p
    join public.team_members tm on tm.team_id = p.team_id and tm.team_role = 'athlete'
    join public.teams t on t.id = tm.team_id and not t.archived
    where p.share_athletes
    union
    -- The parents and guardians of its athletes under 18.
    select g.guardian_id
    from plan p
    join public.team_members tm on tm.team_id = p.team_id and tm.team_role = 'athlete'
    join public.teams t on t.id = tm.team_id and not t.archived
    join public.guardianships g on g.athlete_id = tm.profile_id
    join public.profiles a on a.id = tm.profile_id
    where p.share_athletes and public.is_minor(a.date_of_birth, a.under_17)
    union
    -- Coaches chosen by name, while they can work with children.
    select s.profile_id
    from public.session_plan_shares s
    join public.profiles c on c.id = s.profile_id
    where s.plan_id = p_plan_id and c.stood_down_at is null and public.is_cleared(c.id)
  )
  select pe.profile_id
  from people pe
  join public.profiles pr on pr.id = pe.profile_id
  cross join plan p
  where pr.id <> p.author_id
    and pr.status = 'approved'
    and pr.role <> 'volunteer';
$$;
revoke execute on function public.session_plan_audience(uuid) from public, anon, authenticated;

-- Sends a push notification to each person a plan has just been shared with
-- for the first time, on every phone they've registered. Changes to the plan,
-- and people who were already told, send nothing. Returns how many people
-- were told.
create or replace function public.notify_session_plan_shared(p_plan_id uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan public.session_plans;
  v_new uuid[];
  v_messages jsonb;
begin
  select * into v_plan from public.session_plans where id = p_plan_id;
  if not found then
    return 0;
  end if;

  with added as (
    insert into public.session_plan_notices (plan_id, profile_id)
    select p_plan_id, a from public.session_plan_audience(p_plan_id) as a
    on conflict do nothing
    returning profile_id
  )
  select coalesce(array_agg(profile_id), '{}') into v_new from added;
  if cardinality(v_new) = 0 then
    return 0;
  end if;

  -- The lock screen shows only who shared it, the session's name and group.
  select jsonb_agg(jsonb_build_object(
    'to', t.token,
    'title', 'New session plan',
    'body', v_plan.author_name || ' shared ' || v_plan.title || ' ('
      || v_plan.team_name || ', '
      || to_char(v_plan.session_on, 'FMDy FMDD Mon') || ').',
    'data', jsonb_build_object('planId', v_plan.id),
    'sound', 'default'
  ))
  into v_messages
  from public.push_tokens t
  where t.profile_id = any (v_new);

  if v_messages is not null then
    -- Sent in the background once the transaction commits.
    perform net.http_post(
      url := 'https://exp.host/--/api/v2/push/send',
      body := v_messages,
      headers := '{"Content-Type": "application/json", "Accept": "application/json"}'::jsonb
    );
  end if;
  return cardinality(v_new);
end;
$$;
revoke execute on function public.notify_session_plan_shared(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Adding and changing plans
-- ---------------------------------------------------------------------------

-- Adds a plan, or changes one when p_id is given. p_coach_ids are coaches of
-- other squads and teams to share it with by name. Returns the plan's id.
create or replace function public.save_session_plan(
  p_id uuid,
  p_team_id uuid,
  p_title text,
  p_session_on date,
  p_starts_at time,
  p_ends_at time,
  p_location text,
  p_notes text,
  p_run_by text,
  p_share_team_coaches boolean,
  p_share_athletes boolean,
  p_coach_ids uuid[],
  p_copied_from uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan public.session_plans;
  v_team public.teams;
  v_id uuid;
  v_title text := nullif(btrim(p_title), '');
  v_location text := nullif(btrim(p_location), '');
  v_notes text := nullif(btrim(p_notes), '');
  v_run_by text := nullif(btrim(p_run_by), '');
  v_coach_ids uuid[] := coalesce(p_coach_ids, '{}');
  v_position text;
  v_title_kind public.coach_title;
begin
  if not public.session_plans_on() then
    raise exception 'Session plans are switched off for the club';
  end if;
  if p_id is not null then
    select * into v_plan from public.session_plans where id = p_id;
    if not found or not public.can_edit_session_plan(p_id) then
      raise exception 'Only the coach who added this plan, or an admin, can change it';
    end if;
  end if;

  select * into v_team from public.teams where id = p_team_id;
  if not found then
    raise exception 'Choose the squad or team the session was for';
  end if;
  -- Moving a plan to another group needs the same right as adding one there.
  if (p_id is null or v_plan.team_id is distinct from p_team_id)
     and not public.can_add_session_plan(p_team_id) then
    raise exception 'You can only add plans for squads and teams you coach';
  end if;

  if v_title is null then
    raise exception 'Name the session, for example Tuesday training';
  end if;
  if length(v_title) > 120 then
    raise exception 'Keep the session name under 120 characters';
  end if;
  if p_session_on is null then
    raise exception 'Choose the day of the session';
  end if;
  if p_session_on > current_date + 366 or p_session_on < current_date - 3660 then
    raise exception 'Choose a day within a year from today';
  end if;
  if p_starts_at is not null and p_ends_at is not null and p_ends_at <= p_starts_at then
    raise exception 'The session has to finish after it starts';
  end if;
  if length(v_location) > 200 then
    raise exception 'Keep the place under 200 characters';
  end if;
  if length(v_notes) > 20000 then
    raise exception 'Keep the plan under 20,000 characters, or attach it as a file';
  end if;
  if length(v_run_by) > 120 then
    raise exception 'Keep "Run by" under 120 characters';
  end if;
  if cardinality(v_coach_ids) > 50 then
    raise exception 'Share with up to 50 coaches by name';
  end if;
  -- Only coaches of current squads and teams can be chosen by name.
  if exists (
    select 1 from unnest(v_coach_ids) as c(id)
    where c.id = auth.uid()
       or not exists (
         select 1
         from public.team_members tm
         join public.teams t on t.id = tm.team_id
         join public.profiles pr on pr.id = tm.profile_id
         where tm.profile_id = c.id
           and tm.team_role = 'coach'
           and not t.archived
           and pr.status = 'approved'
       )
  ) then
    raise exception 'Plans can only be shared by name with coaches';
  end if;
  if p_copied_from is not null and not public.can_view_session_plan(p_copied_from) then
    raise exception 'That plan can''t be copied';
  end if;

  if p_id is null then
    select tm.coach_title into v_title_kind
    from public.team_members tm
    where tm.team_id = p_team_id and tm.profile_id = auth.uid() and tm.team_role = 'coach';
    v_position := case
      when found and v_title_kind = 'head_coach' then 'Head coach'
      when found and v_title_kind = 'assistant_coach' then 'Assistant coach'
      when found then 'Coach'
      else 'Admin'
    end;

    insert into public.session_plans (
      team_id, team_name, title, session_on, starts_at, ends_at, location, notes, run_by,
      share_team_coaches, share_athletes, author_id, author_name, author_position, copied_from
    )
    values (
      p_team_id, v_team.name, v_title, p_session_on, p_starts_at, p_ends_at, v_location, v_notes,
      v_run_by, coalesce(p_share_team_coaches, true), coalesce(p_share_athletes, false),
      auth.uid(), coalesce(public.member_display_name(auth.uid()), 'Unnamed member'), v_position,
      p_copied_from
    )
    returning id into v_id;
  else
    v_id := p_id;
    update public.session_plans
    set team_id = p_team_id,
        team_name = v_team.name,
        title = v_title,
        session_on = p_session_on,
        starts_at = p_starts_at,
        ends_at = p_ends_at,
        location = v_location,
        notes = v_notes,
        run_by = v_run_by,
        share_team_coaches = coalesce(p_share_team_coaches, true),
        share_athletes = coalesce(p_share_athletes, false),
        edited_at = now(),
        edited_by_name = public.member_display_name(auth.uid())
    where id = p_id;

    delete from public.session_plan_shares
    where plan_id = p_id and not (profile_id = any (v_coach_ids));
  end if;

  insert into public.session_plan_shares (plan_id, profile_id)
  select v_id, c.id from unnest(v_coach_ids) as c(id)
  on conflict do nothing;

  -- Tells anyone it's now shared with for the first time.
  perform public.notify_session_plan_shared(v_id);

  return v_id;
end;
$$;
revoke execute on function public.save_session_plan(
  uuid, uuid, text, date, time, time, text, text, text, boolean, boolean, uuid[], uuid
) from public, anon;
grant execute on function public.save_session_plan(
  uuid, uuid, text, date, time, time, text, text, text, boolean, boolean, uuid[], uuid
) to authenticated;

-- Records a file already uploaded to the plan's folder. At most 5 per plan.
create or replace function public.add_session_plan_file(
  p_plan_id uuid,
  p_path text,
  p_name text,
  p_content_type text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_size bigint;
begin
  if not public.can_edit_session_plan(p_plan_id) then
    raise exception 'Only the coach who added this plan, or an admin, can add files to it';
  end if;
  if public.session_plan_of(p_path) is distinct from p_plan_id then
    raise exception 'That file wasn''t uploaded. Try attaching it again.';
  end if;
  select (o.metadata ->> 'size')::bigint into v_size
  from storage.objects o
  where o.bucket_id = 'session-plans' and o.name = p_path;
  if not found then
    raise exception 'That file wasn''t uploaded. Try attaching it again.';
  end if;
  if (select count(*) from public.session_plan_files where plan_id = p_plan_id) >= 5 then
    raise exception 'A plan can have up to 5 photos and files';
  end if;
  insert into public.session_plan_files (
    plan_id, path, name, content_type, size_bytes, added_by, added_by_name
  )
  values (
    p_plan_id, p_path, left(coalesce(nullif(btrim(p_name), ''), 'File'), 200),
    coalesce(nullif(p_content_type, ''), 'application/octet-stream'), v_size, auth.uid(),
    public.member_display_name(auth.uid())
  )
  returning id into v_id;
  return v_id;
end;
$$;
revoke execute on function public.add_session_plan_file(uuid, text, text, text) from public, anon;
grant execute on function public.add_session_plan_file(uuid, text, text, text) to authenticated;

-- Removes a file's record once the file itself has been removed from storage
-- (the app removes it through the storage API first).
create or replace function public.remove_session_plan_file(p_file_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_file public.session_plan_files;
begin
  select * into v_file from public.session_plan_files where id = p_file_id;
  if not found then
    return;
  end if;
  if not public.can_edit_session_plan(v_file.plan_id) then
    raise exception 'Only the coach who added this plan, or an admin, can remove its files';
  end if;
  if exists (
    select 1 from storage.objects o where o.bucket_id = 'session-plans' and o.name = v_file.path
  ) then
    raise exception 'The file is still there. Try removing it again.';
  end if;
  delete from public.session_plan_files where id = p_file_id;
  update public.session_plans
  set edited_at = now(), edited_by_name = public.member_display_name(auth.uid())
  where id = v_file.plan_id;
end;
$$;
revoke execute on function public.remove_session_plan_file(uuid) from public, anon;
grant execute on function public.remove_session_plan_file(uuid) to authenticated;

-- Admins delete a whole plan, once its files have been removed from storage.
create or replace function public.admin_delete_session_plan(p_plan_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Only admins can delete a session plan';
  end if;
  if exists (
    select 1 from storage.objects o
    where o.bucket_id = 'session-plans' and public.session_plan_of(o.name) = p_plan_id
  ) then
    raise exception 'The plan''s files are still there. Try deleting it again.';
  end if;
  delete from public.session_plans where id = p_plan_id;
end;
$$;
revoke execute on function public.admin_delete_session_plan(uuid) from public, anon;
grant execute on function public.admin_delete_session_plan(uuid) to authenticated;

-- The signed-in member opened a plan.
create or replace function public.mark_session_plan_seen(p_plan_id uuid)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  insert into public.session_plan_views (plan_id, profile_id)
  select p_plan_id, auth.uid()
  where auth.uid() is not null and public.can_view_session_plan(p_plan_id)
  on conflict (plan_id, profile_id) do update set last_viewed_at = now();
$$;
revoke execute on function public.mark_session_plan_seen(uuid) from public, anon;
grant execute on function public.mark_session_plan_seen(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Lists
-- ---------------------------------------------------------------------------

-- Plans shared with the signed-in member, newest session first, with whether
-- they've opened each one.
create or replace function public.shared_session_plans()
returns table (
  id uuid,
  team_id uuid,
  team_name text,
  title text,
  session_on date,
  starts_at time,
  ends_at time,
  author_name text,
  author_position text,
  file_count int,
  is_new boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.team_id, p.team_name, p.title, p.session_on, p.starts_at, p.ends_at,
    p.author_name, p.author_position,
    (select count(*)::int from public.session_plan_files f where f.plan_id = p.id),
    not exists (
      select 1 from public.session_plan_views v
      where v.plan_id = p.id and v.profile_id = auth.uid()
    )
  from public.session_plans p
  where public.session_plans_on() and public.session_plan_shared_with_me(p)
  order by p.session_on desc, p.starts_at desc nulls last, p.created_at desc
  limit 500;
$$;
revoke execute on function public.shared_session_plans() from public, anon;
grant execute on function public.shared_session_plans() to authenticated;

-- What the home screen needs: whether the member can add plans, and how many
-- plans shared with them they haven't opened yet.
create or replace function public.session_plan_summary()
returns table (can_add boolean, shared int, new_shared int)
language sql
stable
security definer
set search_path = ''
as $$
  with shared as (select * from public.shared_session_plans())
  select
    public.session_plans_on() and (
      public.is_admin() or exists (
        select 1 from public.team_members tm
        where tm.profile_id = auth.uid() and tm.team_role = 'coach'
          and public.coaches_group(tm.team_id)
      )
    ),
    (select count(*)::int from shared),
    (select count(*)::int from shared where is_new);
$$;
revoke execute on function public.session_plan_summary() from public, anon;
grant execute on function public.session_plan_summary() to authenticated;

-- Coaches of current squads and teams, to share a plan with by name, with
-- the groups they coach.
create or replace function public.session_plan_coaches()
returns table (profile_id uuid, full_name text, groups text, team_ids uuid[])
language sql
stable
security definer
set search_path = ''
as $$
  select tm.profile_id,
    coalesce(public.member_display_name(tm.profile_id), 'Unnamed member'),
    string_agg(t.name, ', ' order by t.sort_order, t.name),
    array_agg(t.id)
  from public.team_members tm
  join public.teams t on t.id = tm.team_id
  join public.profiles pr on pr.id = tm.profile_id
  where tm.team_role = 'coach'
    and not t.archived
    and pr.status = 'approved'
    and tm.profile_id <> auth.uid()
    and public.session_plans_on()
    and (public.is_admin() or public.can_work_with_children())
    and (public.is_admin() or exists (
      select 1 from public.team_members me
      where me.profile_id = auth.uid() and me.team_role = 'coach'
    ))
  group by tm.profile_id
  order by 2;
$$;
revoke execute on function public.session_plan_coaches() from public, anon;
grant execute on function public.session_plan_coaches() to authenticated;

-- The admin governance report: every plan with a session in the period, with
-- who added it, how many files it has and when it was added and last edited.
create or replace function public.session_plan_report(p_from date, p_to date)
returns table (
  id uuid,
  team_id uuid,
  team_name text,
  title text,
  session_on date,
  starts_at time,
  author_name text,
  author_position text,
  run_by text,
  has_notes boolean,
  file_count int,
  created_at timestamptz,
  edited_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.team_id, p.team_name, p.title, p.session_on, p.starts_at, p.author_name,
    p.author_position, p.run_by, p.notes is not null,
    (select count(*)::int from public.session_plan_files f where f.plan_id = p.id),
    p.created_at, p.edited_at
  from public.session_plans p
  where public.is_admin()
    and p.session_on between p_from and p_to
  order by p.session_on, p.team_name, p.starts_at nulls last;
$$;
revoke execute on function public.session_plan_report(date, date) from public, anon;
grant execute on function public.session_plan_report(date, date) to authenticated;

-- ---------------------------------------------------------------------------
-- Keeping records
-- ---------------------------------------------------------------------------

-- Files of plans whose session is past the attendance keep period. Nothing is
-- listed while removal is switched off.
create or replace function public.expired_session_plan_files()
returns setof text
language sql
stable
security definer
set search_path = ''
as $$
  select f.path
  from public.session_plan_files f
  join public.session_plans p on p.id = f.plan_id
  join public.club_settings s on s.retention_enabled
  where p.session_on < (current_date - make_interval(months => s.retention_attendance_months))::date;
$$;
revoke execute on function public.expired_session_plan_files() from public, anon, authenticated;
grant execute on function public.expired_session_plan_files() to service_role;

-- Removes records past the club's keep periods, and returns how many of each
-- went. Does nothing while removal is switched off. A certificate record or a
-- session plan only goes once its files have been removed from storage.
create or replace function public.purge_expired_records()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.club_settings;
  v_check_ins int := 0;
  v_goals int := 0;
  v_team_goals int := 0;
  v_messages int := 0;
  v_attendance int := 0;
  v_absences int := 0;
  v_certificates int := 0;
  v_access int := 0;
  v_kpis int := 0;
  v_kpi_reviews int := 0;
  v_plans int := 0;
begin
  select * into s from public.club_settings where id;
  if not found or not s.retention_enabled then
    return jsonb_build_object('enabled', false);
  end if;

  delete from public.check_ins
  where day < (current_date - make_interval(months => s.retention_check_ins_months))::date;
  get diagnostics v_check_ins = row_count;

  -- Goals, reflections and their comments go together, counted from the game.
  delete from public.game_goals g
  using public.fixtures f
  where f.id = g.fixture_id
    and f.starts_at < now() - make_interval(months => s.retention_goals_months);
  get diagnostics v_goals = row_count;
  delete from public.team_game_goals g
  using public.fixtures f
  where f.id = g.fixture_id
    and f.starts_at < now() - make_interval(months => s.retention_goals_months);
  get diagnostics v_team_goals = row_count;

  delete from public.season_kpis k
  using public.teams t
  where t.id = k.team_id and t.archived and k.team_role = 'athlete'
    and k.updated_at < now() - make_interval(months => s.retention_goals_months);
  get diagnostics v_kpis = row_count;
  delete from public.season_kpi_reviews r
  using public.teams t
  where t.id = r.team_id and t.archived and r.team_role = 'athlete'
    and r.updated_at < now() - make_interval(months => s.retention_goals_months);
  get diagnostics v_kpi_reviews = row_count;

  -- The message stays with who sent it, who it went to and who read it; only
  -- the text is replaced.
  update public.messages
  set body = 'This message was removed after the club''s keep period.', body_removed_at = now()
  where body_removed_at is null
    and created_at < now() - make_interval(months => s.retention_messages_months);
  get diagnostics v_messages = row_count;

  delete from public.attendance_sessions
  where held_at < now() - make_interval(months => s.retention_attendance_months);
  get diagnostics v_attendance = row_count;

  delete from public.attendance_absences
  where to_day < (current_date - make_interval(months => s.retention_attendance_months))::date;
  get diagnostics v_absences = row_count;

  delete from public.training_certificates c
  where c.created_at < now() - make_interval(months => s.retention_certificates_months)
    and not exists (
      select 1 from storage.objects o
      where o.bucket_id = 'training-certificates' and o.name = c.document_path
    );
  get diagnostics v_certificates = row_count;

  delete from public.record_access_log
  where created_at < now() - make_interval(months => s.retention_access_log_months);
  get diagnostics v_access = row_count;

  -- Session plans follow the attendance keep period, counted from the session.
  delete from public.session_plans p
  where p.session_on < (current_date - make_interval(months => s.retention_attendance_months))::date
    and not exists (
      select 1 from storage.objects o
      where o.bucket_id = 'session-plans' and public.session_plan_of(o.name) = p.id
    );
  get diagnostics v_plans = row_count;

  return jsonb_build_object(
    'enabled', true,
    'check_ins', v_check_ins,
    'game_goals', v_goals,
    'team_goals', v_team_goals,
    'season_kpis', v_kpis,
    'season_kpi_reviews', v_kpi_reviews,
    'messages', v_messages,
    'attendance_sessions', v_attendance,
    'absences', v_absences,
    'certificates', v_certificates,
    'record_views', v_access,
    'session_plans', v_plans
  );
end;
$$;
revoke execute on function public.purge_expired_records() from public, anon, authenticated;
grant execute on function public.purge_expired_records() to service_role;

commit;
