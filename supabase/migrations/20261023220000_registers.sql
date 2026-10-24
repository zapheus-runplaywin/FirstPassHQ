-- Policy and conflict-of-interest registers (customer review R9, Matt, 23
-- October 2026: "Policies and conflicts").
--
-- Policy register: each club policy with its owner, version, a link to the
-- document (on the club's website or shared drive) and its next review date.
-- Admins add and change policies; the owner (or an admin) records a review,
-- with the new version, link and next review date. The owner gets a to-do 30
-- days before the review is due. The committee and admins read the register;
-- an owner reads the policies they own.
--
-- Conflict-of-interest register: committee members and coaches (who select
-- teams) declare each season whether they have a conflict of interest, such as
-- a child trialling for a team they select, and what it is. The committee and
-- admins read the register, including who still has to declare; admins can
-- change a declaration. Each member reads their own.
--
-- The app shows both only when an admin turns on "Policy and conflict
-- registers" in Club settings (off by default). Risk and incident registers
-- and the AGM pack aren't in the app yet.
--
-- Additive: two new tables and new functions. No existing rows change.

begin;

-- ---------------------------------------------------------------------------
-- Policy register
-- ---------------------------------------------------------------------------

create table if not exists public.policy_register (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(trim(title)) between 1 and 120),
  owner_id uuid references public.profiles (id) on delete set null,
  version text check (length(version) <= 30),
  link text check (length(link) <= 500),
  review_on date not null,
  notes text check (length(notes) <= 1000),
  last_reviewed_at timestamptz,
  last_reviewed_by uuid references public.profiles (id) on delete set null,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now()
);

create index if not exists policy_register_owner_idx on public.policy_register (owner_id);

-- Read and written only through the functions below.
alter table public.policy_register enable row level security;
revoke all on table public.policy_register from public, anon, authenticated;
grant all on table public.policy_register to service_role;

-- Whether the signed-in member reads the registers: the committee and admins
-- (a paused committee role doesn't count).
create or replace function public.can_read_registers()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_approved() and public.is_committee();
$$;
revoke execute on function public.can_read_registers() from public, anon;
grant execute on function public.can_read_registers() to authenticated;

-- Who can own a policy: an approved adult who isn't a guest or temporary
-- helper and isn't stood down.
create or replace function public.can_own_policy(p_profile_id uuid)
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
      and exists (
        select 1 from unnest(array[p.role] || p.extra_roles) r
        where r not in ('guest', 'volunteer', 'athlete', 'guardian')
      )
  );
$$;
revoke execute on function public.can_own_policy(uuid) from public, anon, authenticated;

-- The register, for the committee and admins; an owner sees their own.
create or replace function public.policy_register_list()
returns table (
  id uuid,
  title text,
  owner_id uuid,
  owner_name text,
  version text,
  link text,
  review_on date,
  notes text,
  last_reviewed_at timestamptz,
  last_reviewed_by_name text,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select r.id, r.title, r.owner_id, public.display_name(o), r.version, r.link, r.review_on, r.notes,
    r.last_reviewed_at, public.display_name(b), r.updated_at
  from public.policy_register r
  left join public.profiles o on o.id = r.owner_id
  left join public.profiles b on b.id = r.last_reviewed_by
  where public.is_approved()
    and (public.can_read_registers() or r.owner_id = auth.uid())
  order by r.review_on, r.title;
$$;
revoke execute on function public.policy_register_list() from public, anon;
grant execute on function public.policy_register_list() to authenticated;

-- The policies the signed-in member owns whose review is due within 30 days
-- or overdue, for their to-do list.
create or replace function public.my_policy_reviews()
returns table (id uuid, title text, review_on date)
language sql
stable
security definer
set search_path = ''
as $$
  select r.id, r.title, r.review_on
  from public.policy_register r
  where public.is_approved()
    and not public.is_stood_down()
    and r.owner_id = auth.uid()
    and r.review_on <= current_date + 30
  order by r.review_on, r.title;
$$;
revoke execute on function public.my_policy_reviews() from public, anon;
grant execute on function public.my_policy_reviews() to authenticated;

create or replace function public.check_policy_link(p_link text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v text := nullif(trim(coalesce(p_link, '')), '');
begin
  if v is not null and v !~* '^https?://[^ ]+$' then
    raise exception 'The link must start with https://';
  end if;
  return v;
end;
$$;
revoke execute on function public.check_policy_link(text) from public, anon, authenticated;

-- Admins add a policy (no id) or change one. Returns its id.
create or replace function public.admin_save_policy(
  p_id uuid,
  p_title text,
  p_owner_id uuid,
  p_version text,
  p_link text,
  p_review_on date,
  p_notes text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_link text := public.check_policy_link(p_link);
begin
  if not public.is_admin() then
    raise exception 'Only admins can change the policy register';
  end if;
  if length(trim(coalesce(p_title, ''))) not between 1 and 120 then
    raise exception 'Name the policy, in up to 120 characters';
  end if;
  if p_review_on is null then
    raise exception 'Choose when the policy is next reviewed';
  end if;
  if p_review_on > current_date + interval '5 years' then
    raise exception 'Choose a review date within 5 years';
  end if;
  if p_owner_id is not null and not public.can_own_policy(p_owner_id) then
    raise exception 'The owner must be an approved adult member of the club';
  end if;
  if length(coalesce(p_version, '')) > 30 then
    raise exception 'Keep the version to 30 characters';
  end if;
  if length(coalesce(p_notes, '')) > 1000 then
    raise exception 'Keep the notes to 1,000 characters';
  end if;

  if p_id is null then
    insert into public.policy_register (title, owner_id, version, link, review_on, notes, created_by, updated_by)
    values (trim(p_title), p_owner_id, nullif(trim(p_version), ''), v_link, p_review_on,
      nullif(trim(p_notes), ''), auth.uid(), auth.uid())
    returning id into v_id;
  else
    update public.policy_register r
    set title = trim(p_title), owner_id = p_owner_id, version = nullif(trim(p_version), ''), link = v_link,
      review_on = p_review_on, notes = nullif(trim(p_notes), ''), updated_by = auth.uid(), updated_at = now()
    where r.id = p_id
    returning r.id into v_id;
    if v_id is null then
      raise exception 'Policy not found';
    end if;
  end if;
  return v_id;
end;
$$;
revoke execute on function public.admin_save_policy(uuid, text, uuid, text, text, date, text) from public, anon;
grant execute on function public.admin_save_policy(uuid, text, uuid, text, text, date, text) to authenticated;

-- Admins take a policy off the register.
create or replace function public.admin_delete_policy(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Only admins can change the policy register';
  end if;
  delete from public.policy_register r where r.id = p_id;
  if not found then
    raise exception 'Policy not found';
  end if;
end;
$$;
revoke execute on function public.admin_delete_policy(uuid) from public, anon;
grant execute on function public.admin_delete_policy(uuid) to authenticated;

-- The owner, or an admin, records a review: the version and link now in force
-- and when it's next reviewed.
create or replace function public.review_policy(
  p_id uuid,
  p_version text,
  p_link text,
  p_next_review_on date
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_link text := public.check_policy_link(p_link);
begin
  if not exists (
    select 1 from public.policy_register r
    where r.id = p_id
      and public.is_approved()
      and (public.is_admin() or (r.owner_id = auth.uid() and not public.is_stood_down()))
  ) then
    raise exception 'Only the policy''s owner or an admin can record a review';
  end if;
  if p_next_review_on is null or p_next_review_on <= current_date then
    raise exception 'Choose a next review date after today';
  end if;
  if p_next_review_on > current_date + interval '5 years' then
    raise exception 'Choose a review date within 5 years';
  end if;
  if length(coalesce(p_version, '')) > 30 then
    raise exception 'Keep the version to 30 characters';
  end if;

  update public.policy_register r
  set version = nullif(trim(p_version), ''), link = v_link, review_on = p_next_review_on,
    last_reviewed_at = now(), last_reviewed_by = auth.uid(), updated_by = auth.uid(), updated_at = now()
  where r.id = p_id;
end;
$$;
revoke execute on function public.review_policy(uuid, text, text, date) from public, anon;
grant execute on function public.review_policy(uuid, text, text, date) to authenticated;

-- ---------------------------------------------------------------------------
-- Conflict-of-interest register
-- ---------------------------------------------------------------------------

create table if not exists public.conflict_declarations (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  season integer not null,
  has_conflict boolean not null,
  details text check (length(details) <= 2000),
  declared_at timestamptz not null default now(),
  -- An admin who changed it, if one did.
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (profile_id, season),
  check (has_conflict = (details is not null))
);

-- Read and written only through the functions below.
alter table public.conflict_declarations enable row level security;
revoke all on table public.conflict_declarations from public, anon, authenticated;
grant all on table public.conflict_declarations to service_role;

-- Who declares: approved members, not stood down, on the committee or
-- coaching (by role or in a current squad or team).
create or replace function public.declares_conflicts(p_profile_id uuid)
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
      and (
        p.role in ('committee', 'coach')
        or p.extra_roles && array['committee', 'coach']::public.app_role[]
        or exists (
          select 1 from public.team_members tm
          join public.teams t on t.id = tm.team_id
          where tm.profile_id = p.id and tm.team_role = 'coach' and not t.archived
        )
      )
  );
$$;
revoke execute on function public.declares_conflicts(uuid) from public, anon, authenticated;

create or replace function public.check_conflict_details(p_has_conflict boolean, p_details text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v text := nullif(trim(coalesce(p_details, '')), '');
begin
  if p_has_conflict is null then
    raise exception 'Say whether you have a conflict of interest';
  end if;
  if p_has_conflict and v is null then
    raise exception 'Describe the conflict of interest';
  end if;
  if length(coalesce(v, '')) > 2000 then
    raise exception 'Keep the details to 2,000 characters';
  end if;
  return case when p_has_conflict then v end;
end;
$$;
revoke execute on function public.check_conflict_details(boolean, text) from public, anon, authenticated;

-- The signed-in member's declaration for this season, and whether they're
-- asked to make one.
create or replace function public.my_conflict_declaration()
returns table (
  required boolean,
  season integer,
  has_conflict boolean,
  details text,
  declared_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select public.declares_conflicts(auth.uid()) and public.is_approved(),
    public.conduct_season(), d.has_conflict, d.details, d.declared_at
  from (select true) x
  left join public.conflict_declarations d
    on d.profile_id = auth.uid() and d.season = public.conduct_season()
  where auth.uid() is not null;
$$;
revoke execute on function public.my_conflict_declaration() from public, anon;
grant execute on function public.my_conflict_declaration() to authenticated;

-- A committee member or coach declares for this season, or changes what they
-- declared.
create or replace function public.declare_conflicts(p_has_conflict boolean, p_details text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_details text := public.check_conflict_details(p_has_conflict, p_details);
begin
  if not (public.is_approved() and public.declares_conflicts(auth.uid())) then
    raise exception 'Only committee members and coaches declare conflicts of interest';
  end if;
  insert into public.conflict_declarations (profile_id, season, has_conflict, details)
  values (auth.uid(), public.conduct_season(), p_has_conflict, v_details)
  on conflict (profile_id, season) do update
    set has_conflict = excluded.has_conflict, details = excluded.details,
      declared_at = now(), updated_by = null, updated_at = now();
end;
$$;
revoke execute on function public.declare_conflicts(boolean, text) from public, anon;
grant execute on function public.declare_conflicts(boolean, text) to authenticated;

-- The register for a season, for the committee and admins: everyone who
-- declared, and everyone who still has to (this season only).
create or replace function public.conflict_register(p_season integer)
returns table (
  profile_id uuid,
  name text,
  roles text[],
  declared boolean,
  has_conflict boolean,
  details text,
  declared_at timestamptz,
  changed_by_name text
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, public.display_name(p), (array[p.role] || p.extra_roles)::text[],
    d.id is not null, d.has_conflict, d.details, d.declared_at, public.display_name(u)
  from public.profiles p
  left join public.conflict_declarations d on d.profile_id = p.id and d.season = p_season
  left join public.profiles u on u.id = d.updated_by
  where public.can_read_registers()
    and (d.id is not null or (p_season = public.conduct_season() and public.declares_conflicts(p.id)))
  order by d.id is not null, d.has_conflict desc nulls last, public.display_name(p);
$$;
revoke execute on function public.conflict_register(integer) from public, anon;
grant execute on function public.conflict_register(integer) to authenticated;

-- The seasons with declarations, newest first, always including this one.
create or replace function public.conflict_register_seasons()
returns setof integer
language sql
stable
security definer
set search_path = ''
as $$
  select s from (
    select public.conduct_season() as s
    union
    select d.season from public.conflict_declarations d
  ) x
  where public.can_read_registers()
  order by s desc;
$$;
revoke execute on function public.conflict_register_seasons() from public, anon;
grant execute on function public.conflict_register_seasons() to authenticated;

-- Admins change a declaration (or record one a member gave on paper).
create or replace function public.admin_set_conflict_declaration(
  p_profile_id uuid,
  p_season integer,
  p_has_conflict boolean,
  p_details text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_details text;
begin
  if not public.is_admin() then
    raise exception 'Only admins can change the conflict-of-interest register';
  end if;
  v_details := public.check_conflict_details(p_has_conflict, p_details);
  if p_season is null or p_season not between public.conduct_season() - 10 and public.conduct_season() then
    raise exception 'Choose this season or an earlier one';
  end if;
  if not exists (select 1 from public.profiles p where p.id = p_profile_id and p.status = 'approved') then
    raise exception 'Member not found';
  end if;
  insert into public.conflict_declarations (profile_id, season, has_conflict, details, updated_by)
  values (p_profile_id, p_season, p_has_conflict, v_details, auth.uid())
  on conflict (profile_id, season) do update
    set has_conflict = excluded.has_conflict, details = excluded.details,
      updated_by = auth.uid(), updated_at = now();
end;
$$;
revoke execute on function public.admin_set_conflict_declaration(uuid, integer, boolean, text) from public, anon;
grant execute on function public.admin_set_conflict_declaration(uuid, integer, boolean, text) to authenticated;

commit;
