-- Child safety finding 15: the code of conduct, accepted every season, and a
-- ready-made safeguarding induction course.
--
-- Once the club links its code of conduct (Safeguarding settings), every
-- approved member accepts it once a season: for themselves, or, for an
-- under 18 with a parent or guardian linked, a verified parent or guardian
-- accepts for them. Guests and
-- temporary helpers aren't asked (helpers already accept the code when they
-- join). The words accepted, the code's link and the policy version are kept
-- with each acceptance.
--
-- Admins can also add Sport Integrity Australia's Child Safeguarding in
-- Sport Induction to a season's integrity training in one tap, for coaches,
-- managers, physios and the committee.
--
-- Additive only: a new table and new functions.

begin;

create table if not exists public.conduct_acceptances (
  id uuid primary key default gen_random_uuid(),
  -- The member bound by the code.
  profile_id uuid not null references public.profiles (id) on delete cascade,
  season integer not null,
  accepted_by uuid references public.profiles (id) on delete set null,
  accepted_by_name text,
  -- 'self', or 'guardian' for a parent or guardian accepting for a child.
  accepted_as text not null check (accepted_as in ('self', 'guardian')),
  policy_version text not null,
  code_of_conduct_url text,
  -- What they accepted, word for word.
  statement text not null,
  accepted_at timestamptz not null default now(),
  unique (profile_id, season)
);

alter table public.conduct_acceptances enable row level security;
-- Read and written only through the functions below.
revoke all on public.conduct_acceptances from public, anon, authenticated;

-- The club's current season: the newest one that isn't archived.
create or replace function public.conduct_season()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.affiliation_season(), extract(year from current_date)::int);
$$;

revoke execute on function public.conduct_season() from public, anon;
grant execute on function public.conduct_season() to authenticated;

-- The words accepted. A parent or guardian accepts for their child too.
create or replace function public.conduct_statement(p_for_child boolean)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when p_for_child then
    'I''ve read the club''s code of conduct, and gone through it with my child. We''ll both follow '
      || 'it at training, at games and online, and I''ll follow it as a parent or guardian.'
  else
    'I''ve read the club''s code of conduct and I''ll follow it at training, at games and online.'
  end;
$$;

revoke execute on function public.conduct_statement(boolean) from public, anon;
grant execute on function public.conduct_statement(boolean) to authenticated;

-- Whether a member must accept the code: the club has linked one, and they're
-- an approved member who isn't only a guest or a temporary helper.
create or replace function public.conduct_required(p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
      select 1 from public.safeguarding_settings s
      where s.id and coalesce(trim(s.code_of_conduct_url), '') <> ''
    )
    and exists (
      select 1 from public.profiles p
      where p.id = p_profile_id
        and p.status = 'approved'
        and exists (
          select 1 from unnest(array[p.role] || coalesce(p.extra_roles, '{}'::public.app_role[])) r
          where r not in ('guest', 'volunteer')
        )
    );
$$;

revoke execute on function public.conduct_required(uuid) from public, anon, authenticated;

-- Whether a parent or guardian accepts for this member: they're under 18 and
-- have a parent or guardian linked. Anyone else accepts for themselves.
create or replace function public.conduct_by_guardian(p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.athlete_is_minor(p_profile_id)
    and exists (select 1 from public.guardianships g where g.athlete_id = p_profile_id);
$$;

revoke execute on function public.conduct_by_guardian(uuid) from public, anon, authenticated;

-- Whether a member has accepted the code this season.
create or replace function public.conduct_accepted(p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.conduct_acceptances a
    where a.profile_id = p_profile_id and a.season = public.conduct_season()
  );
$$;

revoke execute on function public.conduct_accepted(uuid) from public, anon, authenticated;

-- Accept the code for this season: a member for themselves, or a verified
-- parent or guardian for their child under 18.
create or replace function public.accept_code_of_conduct(p_profile_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_settings public.safeguarding_settings;
  v_child boolean;
begin
  if not public.is_approved() or p_profile_id is null then
    raise exception 'Not signed in';
  end if;
  v_child := p_profile_id <> auth.uid();
  if v_child then
    if not public.is_verified_guardian_of(p_profile_id) then
      raise exception 'Only a verified parent or guardian can accept the code of conduct for a child';
    end if;
  elsif public.conduct_by_guardian(p_profile_id) then
    raise exception 'Your parent or guardian accepts the code of conduct for you';
  end if;
  if not public.conduct_required(p_profile_id) then
    raise exception 'There’s no code of conduct to accept';
  end if;
  select * into v_settings from public.safeguarding_settings where id;
  insert into public.conduct_acceptances (
    profile_id, season, accepted_by, accepted_by_name, accepted_as, policy_version,
    code_of_conduct_url, statement
  )
  values (
    p_profile_id, public.conduct_season(), auth.uid(),
    coalesce(public.member_display_name(auth.uid()), 'Member'),
    case when v_child then 'guardian' else 'self' end,
    coalesce(v_settings.policy_version, '1'), v_settings.code_of_conduct_url,
    public.conduct_statement(v_child)
  )
  on conflict (profile_id, season) do nothing;
end;
$$;

revoke execute on function public.accept_code_of_conduct(uuid) from public, anon;
grant execute on function public.accept_code_of_conduct(uuid) to authenticated;

-- What the signed-in member still has to accept this season: themselves
-- (unless a parent or guardian accepts for them) and each of their children
-- under 18 (if they're a verified guardian).
create or replace function public.my_conduct_todos()
returns table (profile_id uuid, full_name text, for_child boolean, statement text, code_of_conduct_url text)
language sql
stable
security definer
set search_path = ''
as $$
  with url as (
    select s.code_of_conduct_url from public.safeguarding_settings s where s.id
  ),
  people as (
    select auth.uid() as id, false as for_child
    where not public.conduct_by_guardian(auth.uid())
    union all
    select a.profile_id, true
    from public.my_athletes() a
    where public.is_verified_guardian_of(a.profile_id)
  )
  select p.id, public.member_display_name(p.id), p.for_child, public.conduct_statement(p.for_child),
    (select code_of_conduct_url from url)
  from people p
  where public.is_approved()
    and public.conduct_required(p.id)
    and not public.conduct_accepted(p.id);
$$;

revoke execute on function public.my_conduct_todos() from public, anon;
grant execute on function public.my_conduct_todos() to authenticated;

-- A member's acceptances, newest first: for them, their parents or guardians
-- and admins.
create or replace function public.conduct_history(p_profile_id uuid)
returns table (
  season integer,
  accepted_by_name text,
  accepted_as text,
  policy_version text,
  statement text,
  accepted_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select a.season, a.accepted_by_name, a.accepted_as, a.policy_version, a.statement, a.accepted_at
  from public.conduct_acceptances a
  where a.profile_id = p_profile_id
    and public.is_approved()
    and (p_profile_id = auth.uid() or public.is_guardian_of(p_profile_id) or public.is_admin())
  order by a.season desc, a.accepted_at desc;
$$;

revoke execute on function public.conduct_history(uuid) from public, anon;
grant execute on function public.conduct_history(uuid) to authenticated;

-- For admins: every member who must accept the code, whether they have this
-- season, and who accepted.
create or replace function public.admin_conduct_status()
returns table (
  profile_id uuid,
  full_name text,
  role text,
  under_18 boolean,
  accepted_at timestamptz,
  accepted_by_name text
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, public.member_display_name(p.id), p.role::text,
    public.is_minor(p.date_of_birth, p.under_17),
    a.accepted_at, a.accepted_by_name
  from public.profiles p
  left join public.conduct_acceptances a
    on a.profile_id = p.id and a.season = public.conduct_season()
  where public.is_admin() and public.conduct_required(p.id)
  order by a.accepted_at is not null, 2;
$$;

revoke execute on function public.admin_conduct_status() from public, anon;
grant execute on function public.admin_conduct_status() to authenticated;

-- Adds Sport Integrity Australia's Child Safeguarding in Sport Induction to a
-- season's integrity training, for coaches, managers, physios and the
-- committee, due in 3 months. Does nothing if the season already has it.
create or replace function public.admin_add_safeguarding_induction(p_season integer)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_name constant text := 'Child Safeguarding in Sport Induction';
begin
  if not public.is_admin() then
    raise exception 'Only admins can add training';
  end if;
  if p_season is null then
    raise exception 'Choose a season';
  end if;
  select id into v_id from public.training_requirements
  where season = p_season and lower(name) = lower(v_name) and not archived;
  if v_id is not null then
    return v_id;
  end if;
  insert into public.training_requirements (
    season, name, details, course_url, due_on, roles, all_teams, created_by
  )
  values (
    p_season, v_name,
    'Sport Integrity Australia’s free online course on keeping children safe in sport, about 45 '
      || 'minutes. Sign in or create an account, complete the course, then upload the certificate here.',
    'https://elearning.sportintegrity.gov.au/',
    current_date + 90,
    array['coach', 'manager', 'physio', 'committee']::public.app_role[],
    true,
    auth.uid()
  )
  returning id into v_id;
  return v_id;
end;
$$;

revoke execute on function public.admin_add_safeguarding_induction(integer) from public, anon;
grant execute on function public.admin_add_safeguarding_induction(integer) to authenticated;

commit;
