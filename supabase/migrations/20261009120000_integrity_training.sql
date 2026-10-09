-- Integrity training (Sports Integrity Australia compliance).
--
-- Each club year an admin lists the training members must complete, such as
-- Sports Integrity Australia's safeguarding or anti-doping courses, with a due
-- date and who must do it: one or more roles, across all squads and teams or
-- only chosen ones (junior and senior teams can need different courses).
--
-- A member (or the parent or guardian of an athlete under 18) ticks the
-- training a certificate covers, uploads the certificate, and a committee
-- member or admin checks it and approves it, or sends it back with a note.
-- Nobody approves their own certificate or their own child's.
--
-- Certificates are private: only the member, their guardians, the committee
-- and admins can see them. Uploaded files can't be changed or removed, so the
-- club keeps a record for its Sports Integrity Australia reporting.
--
-- Additive only: three new tables, a storage bucket and new functions.

begin;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

-- A course members must complete in a club year (season 2026 is 2026–27).
create table if not exists public.training_requirements (
  id uuid primary key default gen_random_uuid(),
  season integer not null,
  name text not null check (length(trim(name)) between 1 and 120),
  details text check (length(details) <= 2000),
  -- Where to do the course, such as the Sports Integrity Australia e-learning site.
  course_url text check (
    course_url is null or (course_url ~* '^https?://[^\s]+$' and length(course_url) <= 500)
  ),
  due_on date not null,
  -- Members holding any of these roles must complete it.
  roles public.app_role[] not null check (cardinality(roles) > 0),
  -- False when only members of the squads and teams in training_requirement_teams must.
  all_teams boolean not null default true,
  archived boolean not null default false,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists training_requirements_season_idx
  on public.training_requirements (season, due_on);

drop trigger if exists training_requirements_touch_updated_at on public.training_requirements;
create trigger training_requirements_touch_updated_at
  before update on public.training_requirements
  for each row execute function public.touch_updated_at();

-- The squads and teams a requirement is limited to. A chosen squad includes the
-- teams named from it.
create table if not exists public.training_requirement_teams (
  requirement_id uuid not null references public.training_requirements (id) on delete cascade,
  team_id uuid not null references public.teams (id) on delete cascade,
  primary key (requirement_id, team_id)
);

-- A certificate uploaded for a requirement. A send-back keeps the row, and the
-- member uploads a new one, so the history stays.
create table if not exists public.training_certificates (
  id uuid primary key default gen_random_uuid(),
  -- Requirements with certificates can be archived but not deleted.
  requirement_id uuid not null references public.training_requirements (id) on delete restrict,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  submitted_by uuid references public.profiles (id) on delete set null,
  submitted_by_name text,
  completed_on date not null,
  notes text check (length(notes) <= 1000),
  -- A file in the training-certificates bucket.
  document_path text not null,
  document_name text,
  status text not null default 'submitted'
    check (status in ('submitted', 'approved', 'sent_back')),
  reviewed_by uuid references public.profiles (id) on delete set null,
  reviewed_by_name text,
  reviewed_at timestamptz,
  review_note text check (length(review_note) <= 1000),
  created_at timestamptz not null default now()
);

create index if not exists training_certificates_profile_idx
  on public.training_certificates (profile_id, requirement_id, created_at desc);
create index if not exists training_certificates_status_idx
  on public.training_certificates (status);
-- One certificate waiting or approved per member and requirement.
create unique index if not exists training_certificates_one_open_idx
  on public.training_certificates (requirement_id, profile_id)
  where status in ('submitted', 'approved');

-- Written only through the functions below.
alter table public.training_requirements enable row level security;
alter table public.training_requirement_teams enable row level security;
alter table public.training_certificates enable row level security;

-- ---------------------------------------------------------------------------
-- Who must do what, and who can see it
-- ---------------------------------------------------------------------------

-- Whether a requirement applies to a member: they hold one of its roles and,
-- when it is limited to chosen squads and teams, are in one of them in that
-- role. Archived requirements still answer, for the record.
create or replace function public.training_applies(p_requirement_id uuid, p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.training_requirements r
    join public.profiles p on p.id = p_profile_id and p.status = 'approved'
    where r.id = p_requirement_id
      and public.roles_of(p.role, p.extra_roles) && r.roles
      and (
        r.all_teams or exists (
          select 1
          from public.training_requirement_teams rt
          join public.teams t on (t.id = rt.team_id or t.squad_id = rt.team_id)
          join public.team_members m on m.team_id = t.id and m.profile_id = p.id
          where rt.requirement_id = r.id
            and m.team_role::text = any (r.roles::text[])
        )
      )
  );
$$;

-- The member themselves, their guardians, the committee and admins.
create or replace function public.can_view_training_of(p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_approved() and (
    p_profile_id = auth.uid()
    or public.is_guardian_of(p_profile_id)
    or public.is_committee()
  );
$$;

-- The member themselves, or the parent or guardian of an athlete under 18.
create or replace function public.can_submit_training_for(p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_approved() and (
    p_profile_id = auth.uid() or public.is_guardian_of(p_profile_id)
  );
$$;

revoke execute on function public.training_applies(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.can_view_training_of(uuid) from public, anon;
revoke execute on function public.can_submit_training_for(uuid) from public, anon;
grant execute on function public.can_view_training_of(uuid) to authenticated;
grant execute on function public.can_submit_training_for(uuid) to authenticated;

drop policy if exists "Members see training requirements" on public.training_requirements;
create policy "Members see training requirements"
  on public.training_requirements for select to authenticated
  using (public.is_approved());

drop policy if exists "Members see training requirement groups" on public.training_requirement_teams;
create policy "Members see training requirement groups"
  on public.training_requirement_teams for select to authenticated
  using (public.is_approved());

drop policy if exists "Members, guardians and committee see certificates" on public.training_certificates;
create policy "Members, guardians and committee see certificates"
  on public.training_certificates for select to authenticated
  using (public.can_view_training_of(profile_id));

-- ---------------------------------------------------------------------------
-- Certificate files
-- ---------------------------------------------------------------------------

-- Private: files are only reachable through short-lived signed links.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'training-certificates', 'training-certificates', false, 10485760,
  array['application/pdf', 'image/jpeg', 'image/png', 'image/heic', 'image/heif']
)
on conflict (id) do nothing;

-- Files are stored as <member id>/<upload id>/<file name>. Returns the member a
-- path belongs to, or null when the path isn't in that shape.
create or replace function public.training_certificate_owner(p_name text)
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

revoke execute on function public.training_certificate_owner(text) from public, anon;
grant execute on function public.training_certificate_owner(text) to authenticated;

-- No update or delete policies, so uploaded certificates can't be changed or removed.
drop policy if exists "Members and guardians upload training certificates" on storage.objects;
create policy "Members and guardians upload training certificates"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'training-certificates'
    and public.training_certificate_owner(name) is not null
    and public.can_submit_training_for(public.training_certificate_owner(name))
  );

drop policy if exists "Members, guardians and committee see training certificates" on storage.objects;
create policy "Members, guardians and committee see training certificates"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'training-certificates'
    and public.training_certificate_owner(name) is not null
    and public.can_view_training_of(public.training_certificate_owner(name))
  );

-- ---------------------------------------------------------------------------
-- Admins set the training
-- ---------------------------------------------------------------------------

-- Adds a requirement, or changes one when p_id is given. An empty p_team_ids
-- means every squad and team. Returns the requirement's id.
create or replace function public.admin_save_training_requirement(
  p_id uuid,
  p_season integer,
  p_name text,
  p_details text,
  p_course_url text,
  p_due_on date,
  p_roles public.app_role[],
  p_team_ids uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := p_id;
  v_teams uuid[] := coalesce(p_team_ids, '{}');
  v_roles public.app_role[] := array(
    select distinct r from unnest(coalesce(p_roles, '{}')) as r
  );
begin
  if not public.is_admin() then
    raise exception 'Only admins can set training';
  end if;
  if coalesce(trim(p_name), '') = '' then
    raise exception 'Name the training';
  end if;
  if p_due_on is null then
    raise exception 'Choose when it is due';
  end if;
  if p_season is null then
    raise exception 'Choose the season';
  end if;
  if cardinality(v_roles) = 0 then
    raise exception 'Choose who must complete it';
  end if;
  if 'guest' = any (v_roles) then
    raise exception 'Guests can''t be asked to complete training';
  end if;
  if nullif(trim(p_course_url), '') is not null
    and trim(p_course_url) !~* '^https?://[^\s]+$' then
    raise exception 'The course link must start with https://';
  end if;
  if exists (
    select 1 from unnest(v_teams) as chosen(id)
    where not exists (select 1 from public.teams t where t.id = chosen.id and not t.archived)
  ) then
    raise exception 'Choose squads and teams from a current season';
  end if;

  if v_id is null then
    insert into public.training_requirements (
      season, name, details, course_url, due_on, roles, all_teams, created_by
    )
    values (
      p_season, trim(p_name), nullif(trim(p_details), ''), nullif(trim(p_course_url), ''),
      p_due_on, v_roles, cardinality(v_teams) = 0, auth.uid()
    )
    returning id into v_id;
  else
    update public.training_requirements
    set season = p_season,
        name = trim(p_name),
        details = nullif(trim(p_details), ''),
        course_url = nullif(trim(p_course_url), ''),
        due_on = p_due_on,
        roles = v_roles,
        all_teams = cardinality(v_teams) = 0
    where id = v_id;
    if not found then
      raise exception 'Training not found';
    end if;
    delete from public.training_requirement_teams where requirement_id = v_id;
  end if;

  insert into public.training_requirement_teams (requirement_id, team_id)
  select v_id, chosen.id from unnest(v_teams) as chosen(id)
  on conflict do nothing;

  return v_id;
end;
$$;

revoke execute on function public.admin_save_training_requirement(
  uuid, integer, text, text, text, date, public.app_role[], uuid[]
) from public, anon;
grant execute on function public.admin_save_training_requirement(
  uuid, integer, text, text, text, date, public.app_role[], uuid[]
) to authenticated;

-- Archived training leaves members' to-do lists but keeps its certificates.
create or replace function public.admin_set_training_archived(p_id uuid, p_archived boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Only admins can archive training';
  end if;
  update public.training_requirements set archived = coalesce(p_archived, false) where id = p_id;
end;
$$;

revoke execute on function public.admin_set_training_archived(uuid, boolean) from public, anon;
grant execute on function public.admin_set_training_archived(uuid, boolean) to authenticated;

-- Removes training added by mistake. Training with certificates can only be archived.
create or replace function public.admin_delete_training_requirement(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Only admins can remove training';
  end if;
  if exists (select 1 from public.training_certificates where requirement_id = p_id) then
    raise exception 'Members have uploaded certificates for this training. Archive it instead.';
  end if;
  delete from public.training_requirements where id = p_id;
end;
$$;

revoke execute on function public.admin_delete_training_requirement(uuid) from public, anon;
grant execute on function public.admin_delete_training_requirement(uuid) to authenticated;

-- Copies one season's training into the next: due dates move on a year, and
-- chosen squads and teams are matched by name in the new season. Training the
-- new season already has (same name) is skipped. Returns how many were copied.
create or replace function public.admin_copy_training_requirements(p_from integer, p_to integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.training_requirements;
  v_new uuid;
  v_count integer := 0;
begin
  if not public.is_admin() then
    raise exception 'Only admins can copy training';
  end if;
  if p_to is null or p_from is null or p_to <= p_from then
    raise exception 'Copy into a later season';
  end if;

  for v_old in
    select * from public.training_requirements
    where season = p_from and not archived
    order by due_on, name
  loop
    if exists (
      select 1 from public.training_requirements
      where season = p_to and lower(name) = lower(v_old.name)
    ) then
      continue;
    end if;

    insert into public.training_requirements (
      season, name, details, course_url, due_on, roles, all_teams, created_by
    )
    values (
      p_to, v_old.name, v_old.details, v_old.course_url,
      (v_old.due_on + make_interval(years => p_to - p_from))::date,
      v_old.roles, v_old.all_teams, auth.uid()
    )
    returning id into v_new;

    insert into public.training_requirement_teams (requirement_id, team_id)
    select v_new, new_group.id
    from public.training_requirement_teams rt
    join public.teams old_group on old_group.id = rt.team_id
    join public.teams new_group on new_group.season = p_to
      and new_group.name = old_group.name and new_group.kind = old_group.kind
      and not new_group.archived
    where rt.requirement_id = v_old.id
    on conflict do nothing;

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke execute on function public.admin_copy_training_requirements(integer, integer) from public, anon;
grant execute on function public.admin_copy_training_requirements(integer, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- Members see and complete their training
-- ---------------------------------------------------------------------------

-- Current training for the signed-in member and the athletes they are a
-- guardian of, with where each one is up to. status is to_do, submitted,
-- approved or sent_back (the latest certificate's).
create or replace function public.my_training()
returns table (
  requirement_id uuid,
  season integer,
  name text,
  details text,
  course_url text,
  due_on date,
  profile_id uuid,
  profile_name text,
  is_me boolean,
  status text,
  certificate_id uuid,
  completed_on date,
  document_path text,
  document_name text,
  review_note text,
  reviewed_by_name text,
  reviewed_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    r.id, r.season, r.name, r.details, r.course_url, r.due_on,
    p.id,
    coalesce(nullif(p.preferred_name, ''), nullif(p.full_name, ''), p.email),
    p.id = auth.uid(),
    coalesce(c.status, 'to_do'),
    c.id, c.completed_on, c.document_path, c.document_name, c.review_note,
    c.reviewed_by_name, c.reviewed_at
  from public.profiles p
  join public.training_requirements r
    on not r.archived and public.training_applies(r.id, p.id)
  left join lateral (
    select * from public.training_certificates tc
    where tc.requirement_id = r.id and tc.profile_id = p.id
    order by (tc.status = 'sent_back'), tc.created_at desc
    limit 1
  ) c on true
  where public.is_approved()
    and p.status = 'approved'
    and (p.id = auth.uid() or public.is_guardian_of(p.id))
  order by p.id <> auth.uid(), p.full_name, r.due_on, r.name;
$$;

revoke execute on function public.my_training() from public, anon;
grant execute on function public.my_training() to authenticated;

-- Uploads a certificate for one or more requirements it covers. The file must
-- already be in the training-certificates bucket under the member's folder.
-- Returns how many requirements it was added to.
create or replace function public.submit_training_certificate(
  p_profile_id uuid,
  p_requirement_ids uuid[],
  p_completed_on date,
  p_document_path text,
  p_document_name text,
  p_notes text default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids uuid[] := array(select distinct x from unnest(coalesce(p_requirement_ids, '{}')) as x);
  v_count integer;
begin
  if not public.can_submit_training_for(p_profile_id) then
    raise exception 'Only the member or their parent or guardian can upload certificates';
  end if;
  if cardinality(v_ids) = 0 then
    raise exception 'Tick the training this certificate is for';
  end if;
  if p_completed_on is null or p_completed_on > current_date then
    raise exception 'Choose the day you completed it';
  end if;
  if p_document_path is null
    or public.training_certificate_owner(p_document_path) is distinct from p_profile_id
    or not exists (
      select 1 from storage.objects
      where bucket_id = 'training-certificates' and name = p_document_path
    ) then
    raise exception 'The certificate wasn’t uploaded. Try attaching it again.';
  end if;
  if exists (
    select 1 from unnest(v_ids) as x(id)
    where not exists (
      select 1 from public.training_requirements r
      where r.id = x.id and not r.archived and public.training_applies(r.id, p_profile_id)
    )
  ) then
    raise exception 'That training isn’t on your list';
  end if;
  if exists (
    select 1 from public.training_certificates
    where profile_id = p_profile_id and requirement_id = any (v_ids)
      and status in ('submitted', 'approved')
  ) then
    raise exception 'A certificate for that training is already in. Refresh and try again.';
  end if;

  insert into public.training_certificates (
    requirement_id, profile_id, submitted_by, submitted_by_name, completed_on, notes,
    document_path, document_name
  )
  select
    x.id, p_profile_id, auth.uid(), public.my_display_name(), p_completed_on,
    nullif(trim(p_notes), ''), p_document_path, nullif(trim(p_document_name), '')
  from unnest(v_ids) as x(id);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke execute on function public.submit_training_certificate(uuid, uuid[], date, text, text, text)
  from public, anon;
grant execute on function public.submit_training_certificate(uuid, uuid[], date, text, text, text)
  to authenticated;

-- ---------------------------------------------------------------------------
-- The committee and admins check certificates
-- ---------------------------------------------------------------------------

-- Certificates waiting to be checked, oldest first. Committee and admins only.
-- can_review is false for their own and their own child's.
create or replace function public.training_to_review()
returns table (
  certificate_id uuid,
  requirement_id uuid,
  requirement_name text,
  due_on date,
  profile_id uuid,
  profile_name text,
  submitted_by_name text,
  completed_on date,
  notes text,
  document_path text,
  document_name text,
  created_at timestamptz,
  can_review boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    c.id, r.id, r.name, r.due_on, p.id,
    coalesce(nullif(p.full_name, ''), p.email),
    c.submitted_by_name, c.completed_on, c.notes, c.document_path, c.document_name,
    c.created_at,
    p.id <> auth.uid() and not public.is_guardian_of(p.id)
  from public.training_certificates c
  join public.training_requirements r on r.id = c.requirement_id
  join public.profiles p on p.id = c.profile_id
  where c.status = 'submitted' and public.is_committee()
  order by c.created_at;
$$;

revoke execute on function public.training_to_review() from public, anon;
grant execute on function public.training_to_review() to authenticated;

-- Approves a certificate, or sends it back with a note saying what's wrong.
create or replace function public.review_training_certificate(
  p_certificate_id uuid,
  p_approve boolean,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cert public.training_certificates;
begin
  if not public.is_committee() then
    raise exception 'Only the committee and admins can check certificates';
  end if;
  select * into v_cert from public.training_certificates where id = p_certificate_id for update;
  if v_cert.id is null then
    raise exception 'Certificate not found';
  end if;
  if v_cert.profile_id = auth.uid() or public.is_guardian_of(v_cert.profile_id) then
    raise exception 'Someone else on the committee needs to check this one';
  end if;
  if v_cert.status <> 'submitted' then
    raise exception 'This certificate has already been checked';
  end if;
  if not coalesce(p_approve, false) and coalesce(trim(p_note), '') = '' then
    raise exception 'Say why it is being sent back';
  end if;

  update public.training_certificates
  set status = case when p_approve then 'approved' else 'sent_back' end,
      reviewed_by = auth.uid(),
      reviewed_by_name = public.my_display_name(),
      reviewed_at = now(),
      review_note = nullif(trim(p_note), '')
  where id = p_certificate_id;
end;
$$;

revoke execute on function public.review_training_certificate(uuid, boolean, text) from public, anon;
grant execute on function public.review_training_certificate(uuid, boolean, text) to authenticated;

-- Each requirement in a season with how many members are done, waiting to be
-- checked or still to do it. Committee and admins only.
create or replace function public.training_overview(p_season integer)
returns table (
  requirement_id uuid,
  required integer,
  approved integer,
  submitted integer,
  outstanding integer
)
language sql
stable
security definer
set search_path = ''
as $$
  with people as (
    select r.id as requirement_id, p.id as profile_id, (
      select c.status from public.training_certificates c
      where c.requirement_id = r.id and c.profile_id = p.id
      order by (c.status = 'sent_back'), c.created_at desc
      limit 1
    ) as status
    from public.training_requirements r
    join public.profiles p on p.status = 'approved' and public.training_applies(r.id, p.id)
    where r.season = p_season and public.is_committee()
  )
  select
    r.id,
    count(pp.profile_id)::int,
    count(pp.profile_id) filter (where pp.status = 'approved')::int,
    count(pp.profile_id) filter (where pp.status = 'submitted')::int,
    count(pp.profile_id) filter (
      where pp.status is null or pp.status = 'sent_back'
    )::int
  from public.training_requirements r
  left join people pp on pp.requirement_id = r.id
  where r.season = p_season and public.is_committee()
  group by r.id;
$$;

revoke execute on function public.training_overview(integer) from public, anon;
grant execute on function public.training_overview(integer) to authenticated;

-- Everyone who must complete a requirement and where they are up to.
-- Committee and admins only.
create or replace function public.training_requirement_members(p_requirement_id uuid)
returns table (
  profile_id uuid,
  full_name text,
  status text,
  completed_on date,
  certificate_id uuid,
  document_path text,
  document_name text,
  reviewed_by_name text,
  reviewed_at timestamptz,
  review_note text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    p.id, coalesce(nullif(p.full_name, ''), p.email),
    coalesce(c.status, 'to_do'), c.completed_on, c.id, c.document_path, c.document_name,
    c.reviewed_by_name, c.reviewed_at, c.review_note
  from public.profiles p
  left join lateral (
    select * from public.training_certificates tc
    where tc.requirement_id = p_requirement_id and tc.profile_id = p.id
    order by (tc.status = 'sent_back'), tc.created_at desc
    limit 1
  ) c on true
  where public.is_committee()
    and p.status = 'approved'
    and public.training_applies(p_requirement_id, p.id)
  order by p.full_name;
$$;

revoke execute on function public.training_requirement_members(uuid) from public, anon;
grant execute on function public.training_requirement_members(uuid) to authenticated;

commit;
