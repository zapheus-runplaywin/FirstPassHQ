-- Several people in each safeguarding post, and several people a concern is
-- about (Matt, 21 November 2026).
--
-- 1. Safeguarding posts. A larger club can name up to 5 Child Safety
--    Officers, up to 5 Complaints Managers and up to 5 WWC Registration
--    Officers. Each holder acts in the post exactly as the single holder did:
--    they see the concerns register (except a concern about themselves), can
--    ask to read messages for a concern, see their post on home, and so on.
--    Nobody can be both a Child Safety Officer and a Complaints Manager, and
--    an admin who names themselves needs at least one other person named, so
--    a concern about any one of them still has somewhere to go. The to-do
--    "Name a Child Safety Officer" (or Complaints Manager) now shows only when
--    nobody holding the post can act in it. A holder whose check has lapsed
--    stays named but can't act until it's renewed, as before; saving the
--    screen doesn't drop them, and only people newly named are checked.
--    The holders live in a new table. The old single columns stay, and are
--    kept set to the first person named, for anything still reading them.
--    The old save functions keep working for app versions not yet updated:
--    saving an unchanged screen keeps every holder.
--
-- 2. Who a concern is about. The person raising a concern, and those who
--    handle it, can name several members (up to 10). None of them can see the
--    concern, even as an admin or a safeguarding contact. Message access
--    requests can name any of them as "the person it's about", none of them
--    can approve a request on it, and each of them is on legal hold while it's
--    open. A concern about several children shows each child's verified
--    parents and guardians. The member's own list of concerns shows only the
--    names they gave, not names added later by those handling it.
--    The names live in a new table, filled in from each concern's existing
--    "about" member. concerns.about_member_id stays, kept set to the first
--    person named, for app versions not yet updated.
--
-- Additive: two new tables with their grants, filled in from existing columns
-- (no row is changed or removed), and new or replaced functions. The access
-- rules let the same people or fewer see each concern: a member named in the
-- new table is shut out just as the old column shut them out.

begin;

-- ---------------------------------------------------------------------------
-- 1. Safeguarding post holders
-- ---------------------------------------------------------------------------

create table if not exists public.safeguarding_post_holders (
  post text not null check (post in ('child_safety_officer', 'complaints_manager', 'wwc_officer')),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  added_by uuid references public.profiles (id) on delete set null,
  added_at timestamptz not null default now(),
  primary key (post, profile_id)
);

create index if not exists safeguarding_post_holders_profile_idx
  on public.safeguarding_post_holders (profile_id);

-- Reached only through the functions below.
alter table public.safeguarding_post_holders enable row level security;
revoke all on public.safeguarding_post_holders from public, anon, authenticated;
grant all on public.safeguarding_post_holders to service_role;

-- Today's holders, from the single columns.
insert into public.safeguarding_post_holders (post, profile_id, added_by, added_at)
select x.post, x.profile_id, s.updated_by, coalesce(s.updated_at, now())
from public.safeguarding_settings s
cross join lateral (values
  ('child_safety_officer', s.child_safety_officer_id),
  ('complaints_manager', s.complaints_manager_id),
  ('wwc_officer', s.wwc_officer_id)
) x (post, profile_id)
where s.id and x.profile_id is not null
on conflict (post, profile_id) do nothing;

-- Whether a member holds a post (whether or not they can act in it now).
create or replace function public.holds_safeguarding_post(p_post text, p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.safeguarding_post_holders h
    where h.post = p_post and h.profile_id = p_profile_id
  );
$$;

revoke execute on function public.holds_safeguarding_post(text, uuid) from public, anon, authenticated;

-- Whether someone holding the post can act in it now.
create or replace function public.safeguarding_post_filled(p_post text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.safeguarding_post_holders h
    where h.post = p_post and public.can_be_safeguarding_contact(h.profile_id)
      and (p_post <> 'wwc_officer' or exists (
        select 1 from public.profiles p
        where p.id = h.profile_id
          and public.roles_of(p.role, p.extra_roles) && array['admin', 'committee']::public.app_role[]
      ))
  );
$$;

revoke execute on function public.safeguarding_post_filled(text) from public, anon, authenticated;

-- The holders who can act now, as [{id, name}], by name.
create or replace function public.safeguarding_post_people(p_post text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', public.display_name(p))
    order by public.display_name(p), p.id), '[]'::jsonb)
  from public.safeguarding_post_holders h
  join public.profiles p on p.id = h.profile_id
  where h.post = p_post and public.can_be_safeguarding_contact(p.id);
$$;

revoke execute on function public.safeguarding_post_people(text) from public, anon, authenticated;

-- Whether the signed-in member is a Child Safety Officer or a Complaints
-- Manager, and can act as one right now.
create or replace function public.is_safeguarding_officer()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.safeguarding_post_holders h
    where h.profile_id = auth.uid() and h.post in ('child_safety_officer', 'complaints_manager')
  ) and public.can_be_safeguarding_contact(auth.uid());
$$;

revoke execute on function public.is_safeguarding_officer() from public, anon;
grant execute on function public.is_safeguarding_officer() to authenticated;

-- Whether the signed-in member is a Child Safety Officer who can act now.
create or replace function public.is_child_safety_officer()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.holds_safeguarding_post('child_safety_officer', auth.uid())
    and public.can_be_safeguarding_contact(auth.uid());
$$;

-- The signed-in member's safeguarding post, when they can act in it now.
-- Nobody holds both, so there is at most one.
create or replace function public.my_safeguarding_post()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when auth.uid() is null or not public.can_be_safeguarding_contact(auth.uid()) then null
    when public.holds_safeguarding_post('child_safety_officer', auth.uid()) then 'child_safety_officer'
    when public.holds_safeguarding_post('complaints_manager', auth.uid()) then 'complaints_manager'
  end;
$$;

revoke execute on function public.my_safeguarding_post() from public, anon, authenticated;

-- The posts the signed-in member holds and can act in, for the titles line.
create or replace function public.my_safeguarding_posts()
returns table (
  child_safety_officer boolean,
  complaints_manager boolean,
  wwc_registration_officer boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    public.holds_safeguarding_post('child_safety_officer', auth.uid()) and ok.contact,
    public.holds_safeguarding_post('complaints_manager', auth.uid()) and ok.contact,
    public.holds_safeguarding_post('wwc_officer', auth.uid()) and ok.contact and exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and public.roles_of(p.role, p.extra_roles) && array['admin', 'committee']::public.app_role[]
    )
  from (select public.can_be_safeguarding_contact(auth.uid()) as contact) ok
  where auth.uid() is not null;
$$;

-- Who to talk to, for everyone signed in. As before (the first contact in
-- each post, for app versions not yet updated), and every contact who can
-- act now in child_safety_officers and complaints_managers.
drop function if exists public.safeguarding_contacts();

create or replace function public.safeguarding_contacts()
returns table (
  child_safety_officer_id uuid,
  child_safety_officer_name text,
  complaints_manager_id uuid,
  complaints_manager_name text,
  governing_body_name text,
  governing_body_phone text,
  governing_body_url text,
  policy_url text,
  child_safety_officers jsonb,
  complaints_managers jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    (o.people -> 0 ->> 'id')::uuid, o.people -> 0 ->> 'name',
    (m.people -> 0 ->> 'id')::uuid, m.people -> 0 ->> 'name',
    s.governing_body_name, s.governing_body_phone, s.governing_body_url, s.policy_url,
    o.people, m.people
  from public.safeguarding_settings s
  cross join lateral (select public.safeguarding_post_people('child_safety_officer') as people) o
  cross join lateral (select public.safeguarding_post_people('complaints_manager') as people) m
  where s.id and auth.uid() is not null;
$$;

revoke execute on function public.safeguarding_contacts() from public, anon;
grant execute on function public.safeguarding_contacts() to authenticated;

-- Everyone holding a post, for the admin screen: including anyone who can't
-- act now (their check lapsed), so the admin can see them and replace them.
create or replace function public.admin_safeguarding_posts()
returns table (post text, profile_id uuid, name text, can_act boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select h.post, p.id, public.display_name(p),
    public.can_be_safeguarding_contact(p.id)
      and (h.post <> 'wwc_officer'
        or public.roles_of(p.role, p.extra_roles) && array['admin', 'committee']::public.app_role[])
  from public.safeguarding_post_holders h
  join public.profiles p on p.id = h.profile_id
  where public.is_admin()
  order by h.post, public.display_name(p), p.id;
$$;

revoke execute on function public.admin_safeguarding_posts() from public, anon;
grant execute on function public.admin_safeguarding_posts() to authenticated;

-- Replaces the holders of one post with these people. Only people newly
-- named must qualify; someone already holding it whose check has lapsed can
-- stay named while it's renewed (they can't act meanwhile). Keeps the old
-- single column set to the first person named. Callers check who may save.
create or replace function public.replace_safeguarding_post(p_post text, p_ids uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids uuid[] := array(select distinct x from unnest(coalesce(p_ids, '{}')) x where x is not null);
  v_first uuid := (select x from unnest(coalesce(p_ids, '{}')) with ordinality u (x, n) where x is not null order by n limit 1);
  v_label text := case p_post
    when 'child_safety_officer' then 'Child Safety Officer'
    when 'complaints_manager' then 'Complaints Manager'
    else 'WWC Registration Officer' end;
  v_new uuid;
begin
  if cardinality(v_ids) > 5 then
    raise exception 'Name up to 5 people as %', v_label;
  end if;
  for v_new in
    select x from unnest(v_ids) x
    where not public.holds_safeguarding_post(p_post, x)
  loop
    if not public.can_be_safeguarding_contact(v_new) then
      raise exception 'Each % must be an approved adult with a current Working With Children Check', v_label;
    end if;
    if p_post = 'wwc_officer' and not exists (
      select 1 from public.profiles p
      where p.id = v_new
        and public.roles_of(p.role, p.extra_roles) && array['admin', 'committee']::public.app_role[]
    ) then
      raise exception 'Each WWC Registration Officer must be an admin or committee member with a current Working With Children Check';
    end if;
  end loop;

  delete from public.safeguarding_post_holders h
  where h.post = p_post and not (h.profile_id = any (v_ids));
  insert into public.safeguarding_post_holders (post, profile_id, added_by)
  select p_post, x, auth.uid() from unnest(v_ids) x
  on conflict (post, profile_id) do nothing;

  if p_post = 'child_safety_officer' then
    update public.safeguarding_settings set child_safety_officer_id = v_first where id;
  elsif p_post = 'complaints_manager' then
    update public.safeguarding_settings set complaints_manager_id = v_first where id;
  else
    update public.safeguarding_settings set wwc_officer_id = v_first where id;
  end if;
end;
$$;

revoke execute on function public.replace_safeguarding_post(text, uuid[]) from public, anon, authenticated;

-- Saves the Child Safety Officers, Complaints Managers and the governing body
-- and policy links. Blank text clears a field.
create or replace function public.admin_set_safeguarding_contacts(
  p_child_safety_officer_ids uuid[],
  p_complaints_manager_ids uuid[],
  p_governing_body_name text,
  p_governing_body_phone text,
  p_governing_body_url text,
  p_policy_url text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_officers uuid[] := array(select distinct x from unnest(coalesce(p_child_safety_officer_ids, '{}')) x where x is not null);
  v_managers uuid[] := array(select distinct x from unnest(coalesce(p_complaints_manager_ids, '{}')) x where x is not null);
  v_body_url text := nullif(trim(p_governing_body_url), '');
  v_policy_url text := nullif(trim(p_policy_url), '');
begin
  if not public.is_admin() then
    raise exception 'Only admins can change the safeguarding contacts';
  end if;
  if v_officers && v_managers then
    raise exception 'Nobody can be both a Child Safety Officer and a Complaints Manager, so a concern about one can go to another';
  end if;
  if auth.uid() = any (v_officers || v_managers) and cardinality(v_officers || v_managers) < 2 then
    raise exception 'Choose a second contact as well, so a concern about you has somewhere to go';
  end if;
  if v_body_url !~ '^https://' or v_policy_url !~ '^https://' then
    raise exception 'Links must start with https://';
  end if;

  perform public.replace_safeguarding_post('child_safety_officer', p_child_safety_officer_ids);
  perform public.replace_safeguarding_post('complaints_manager', p_complaints_manager_ids);

  update public.safeguarding_settings
  set governing_body_name = nullif(trim(p_governing_body_name), ''),
      governing_body_phone = nullif(trim(p_governing_body_phone), ''),
      governing_body_url = v_body_url,
      policy_url = v_policy_url,
      updated_by = auth.uid(),
      updated_at = now()
  where id;
end;
$$;

revoke execute on function public.admin_set_safeguarding_contacts(uuid[], uuid[], text, text, text, text) from public, anon;
grant execute on function public.admin_set_safeguarding_contacts(uuid[], uuid[], text, text, text, text) to authenticated;

-- What an app version not yet updated means by one person in a post: the
-- person shown was the first holder who can act, so naming someone already
-- holding it, or leaving it blank when nobody could act, keeps every holder.
-- Naming someone new replaces them all; clearing a name shown clears the post.
create or replace function public.legacy_post_choice(p_post text, p_id uuid)
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_id is not null and public.holds_safeguarding_post(p_post, p_id)
      then array(select h.profile_id from public.safeguarding_post_holders h where h.post = p_post order by h.added_at, h.profile_id)
    when p_id is not null then array[p_id]
    when public.safeguarding_post_filled(p_post) then '{}'::uuid[]
    else array(select h.profile_id from public.safeguarding_post_holders h where h.post = p_post order by h.added_at, h.profile_id)
  end;
$$;

revoke execute on function public.legacy_post_choice(text, uuid) from public, anon, authenticated;

-- The old save, for app versions not yet updated.
create or replace function public.admin_set_safeguarding(
  p_child_safety_officer_id uuid,
  p_complaints_manager_id uuid,
  p_governing_body_name text,
  p_governing_body_phone text,
  p_governing_body_url text,
  p_policy_url text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Only admins can change the safeguarding contacts';
  end if;
  perform public.admin_set_safeguarding_contacts(
    public.legacy_post_choice('child_safety_officer', p_child_safety_officer_id),
    public.legacy_post_choice('complaints_manager', p_complaints_manager_id),
    p_governing_body_name, p_governing_body_phone, p_governing_body_url, p_policy_url
  );
end;
$$;

-- Saves the WWC Registration Officers.
create or replace function public.admin_set_wwc_officers(p_profile_ids uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Only admins can choose the WWC Registration Officer';
  end if;
  perform public.replace_safeguarding_post('wwc_officer', p_profile_ids);
end;
$$;

revoke execute on function public.admin_set_wwc_officers(uuid[]) from public, anon;
grant execute on function public.admin_set_wwc_officers(uuid[]) to authenticated;

-- The old save, for app versions not yet updated (the screen only calls it
-- when the person shown changed).
create or replace function public.admin_set_wwc_officer(p_profile_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Only admins can choose the WWC Registration Officer';
  end if;
  perform public.replace_safeguarding_post('wwc_officer', case
    when p_profile_id is null then '{}'::uuid[]
    when public.holds_safeguarding_post('wwc_officer', p_profile_id) then
      array(select h.profile_id from public.safeguarding_post_holders h where h.post = 'wwc_officer' order by h.added_at, h.profile_id)
    else array[p_profile_id] end);
end;
$$;

-- Every WWC Registration Officer, for those who read reports.
create or replace function public.admin_wwc_officers()
returns table (officer_id uuid, officer_name text)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, public.display_name(p)
  from public.safeguarding_post_holders h
  join public.profiles p on p.id = h.profile_id
  where h.post = 'wwc_officer' and public.can_read_reports()
  order by 2, 1;
$$;

revoke execute on function public.admin_wwc_officers() from public, anon;
grant execute on function public.admin_wwc_officers() to authenticated;

-- The first of them, for app versions not yet updated (they expect one row).
create or replace function public.admin_wwc_officer()
returns table (officer_id uuid, officer_name text)
language sql
stable
security definer
set search_path = ''
as $$
  select o.officer_id, o.officer_name from public.admin_wwc_officers() o limit 1;
$$;

-- The admin's safety to-dos: as in 20261101000000_parent_link_codes, except
-- that a post counts as missing only when nobody holding it can act.
create or replace function public.admin_safety_todos()
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
      -- A temporary helper needs a check only while helping: not before
      -- their first day, nor after their last.
      public.needs_wwcc(public.roles_of(p.role, p.extra_roles), p.wwcc_exempt_reason)
        and not (p.role = 'volunteer'
          and (p.volunteer_until < current_date or p.volunteer_from > current_date)) as needs_check
    from public.profiles p
    where p.status = 'approved' and public.is_admin()
  )
  select
    count(*) filter (
      where m.needs_check and not public.is_cleared(m.id)
    )::int,
    count(*) filter (
      where m.needs_check
        and public.has_current_wwcc(m.id)
        and m.wwcc_expires_on < current_date + 60
        and not (m.role = 'volunteer' and m.wwcc_expires_on >= m.volunteer_until)
    )::int,
    -- Locked: under 18 with no approved, verified parent or guardian linked.
    count(*) filter (
      where 'athlete' = any (m.roles) and public.is_minor(m.date_of_birth, m.under_17)
        and public.is_locked_child(m.id)
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
    (select count(*) from (select 1) one
     where public.is_admin() and not exists (
       select 1 from public.safeguarding_post_holders h where h.post = 'wwc_officer'))::int,
    -- Members behind wwcc_missing, wwcc_expiring, wwcc_to_validate or
    -- wwcc_to_link, each counted once. Keep these in step with those counts.
    count(*) filter (
      where m.needs_check and (
        not public.is_cleared(m.id)
        or (public.has_current_wwcc(m.id) and (
          (m.wwcc_expires_on < current_date + 60
            and not (m.role = 'volunteer' and m.wwcc_expires_on >= m.volunteer_until))
          or m.wwcc_validated_at is null
          or m.wwcc_validated_at < now() - interval '1 year'
          or m.wwcc_unit_linked_at is null))
      )
    )::int,
    (select count(*) from (select 1) one
     where public.is_admin() and not public.safeguarding_post_filled('child_safety_officer'))::int,
    (select count(*) from (select 1) one
     where public.is_admin() and not public.safeguarding_post_filled('complaints_manager'))::int
  from members m;
$$;


-- ---------------------------------------------------------------------------
-- 2. Several people a concern is about
-- ---------------------------------------------------------------------------

create table if not exists public.concern_about_members (
  id bigint generated always as identity primary key,
  concern_id uuid not null references public.concerns (id) on delete cascade,
  -- Null once the member's account is gone; the name stays.
  member_id uuid references public.profiles (id) on delete set null,
  member_name text not null,
  -- Named by the person who raised it (shown back to them), or added later by
  -- those handling it (never shown to the raiser).
  named_by_raiser boolean not null default false,
  added_at timestamptz not null default now(),
  constraint concern_about_members_once unique (concern_id, member_id)
);

create index if not exists concern_about_members_member_idx
  on public.concern_about_members (member_id);

-- Reached only through the functions below.
alter table public.concern_about_members enable row level security;
revoke all on public.concern_about_members from public, anon, authenticated;
grant all on public.concern_about_members to service_role;

-- Each concern's existing "about" member. Named by the raiser unless someone
-- handling it has changed who it's about.
insert into public.concern_about_members (concern_id, member_id, member_name, named_by_raiser, added_at)
select c.id, c.about_member_id, coalesce(c.about_member_name, 'A member'),
  not exists (select 1 from public.concern_events e where e.concern_id = c.id and e.kind = 'about_changed'),
  c.created_at
from public.concerns c
where c.about_member_id is not null
on conflict (concern_id, member_id) do nothing;

-- Whether a member is named as someone a concern is about.
create or replace function public.is_named_in_concern(p_concern_id uuid, p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_profile_id is not null and (
    exists (
      select 1 from public.concern_about_members a
      where a.concern_id = p_concern_id and a.member_id = p_profile_id
    )
    or exists (
      select 1 from public.concerns c
      where c.id = p_concern_id and c.about_member_id = p_profile_id
    )
  );
$$;

revoke execute on function public.is_named_in_concern(uuid, uuid) from public, anon, authenticated;

-- Keeps concerns.about_member_id and about_member_name set to the first
-- person named, for app versions not yet updated.
create or replace function public.sync_concern_about(p_concern_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.concerns c
  set (about_member_id, about_member_name) = (
    select a.member_id, a.member_name from public.concern_about_members a
    where a.concern_id = p_concern_id
    order by a.id
    limit 1
  )
  where c.id = p_concern_id;
$$;

revoke execute on function public.sync_concern_about(uuid) from public, anon, authenticated;

-- Everyone a concern is about, as [{id, name}] in the order named.
create or replace function public.concern_about_list(p_concern_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', a.member_id, 'name', a.member_name) order by a.id), '[]'::jsonb)
  from public.concern_about_members a
  where a.concern_id = p_concern_id;
$$;

revoke execute on function public.concern_about_list(uuid) from public, anon, authenticated;

-- Whether the signed-in member handles this concern: an admin or a
-- safeguarding officer, and not anyone it's about.
create or replace function public.can_handle_concern(p_concern_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (public.is_admin() or public.is_safeguarding_officer())
    and exists (select 1 from public.concerns c where c.id = p_concern_id)
    and not public.is_named_in_concern(p_concern_id, auth.uid());
$$;

revoke execute on function public.can_handle_concern(uuid) from public, anon, authenticated;

-- Raise a concern, as in 20261121100000_message_archive_and_access, naming
-- up to 10 members it's about (p_about_member_ids, and p_about_member_id from
-- app versions not yet updated).
drop function if exists public.raise_concern(text, text, uuid, date, text, boolean, text, boolean, text, uuid);

create or replace function public.raise_concern(
  p_body text,
  p_about_text text default null,
  p_about_member_id uuid default null,
  p_happened_on date default null,
  p_involves_child text default 'unsure',
  p_contact_ok boolean default false,
  p_contact_details text default null,
  p_anonymous boolean default false,
  p_context text default null,
  p_message_id uuid default null,
  p_about_member_ids uuid[] default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me public.profiles;
  v_about uuid[];
  v_message public.messages;
  v_id uuid;
begin
  select * into v_me from public.profiles where id = auth.uid();
  if not found then
    raise exception 'Sign in to raise a concern';
  end if;
  if coalesce(trim(p_body), '') = '' then
    raise exception 'Say what happened';
  end if;
  if length(p_body) > 5000 then
    raise exception 'Keep it under 5000 characters';
  end if;
  if p_happened_on > current_date then
    raise exception 'The date can''t be in the future';
  end if;
  if (
    select count(*) from public.concerns
    where raised_by = auth.uid() and created_at > now() - interval '1 day'
  ) >= 10 then
    raise exception 'You''ve raised 10 concerns today. Talk to a contact below, or call 000 if a child is in danger.';
  end if;
  -- The members named, in the order given, once each, who exist.
  select coalesce(array_agg(x.id order by x.n), '{}') into v_about
  from (
    select u.id, min(u.n) as n
    from unnest(coalesce(p_about_member_ids, '{}') || p_about_member_id) with ordinality u (id, n)
    join public.profiles p on p.id = u.id
    group by u.id
  ) x;
  if cardinality(v_about) > 10 then
    raise exception 'Name up to 10 people';
  end if;
  if p_message_id is not null then
    select * into v_message from public.messages m
    where m.id = p_message_id
      and ((m.sender_id = auth.uid() and not public.is_stood_down())
        or public.is_message_recipient(m.id));
    if not found then
      raise exception 'That message isn''t available to report';
    end if;
  end if;

  insert into public.concerns (
    raised_by, raised_by_name, anonymous, contact_ok, contact_details,
    about_text, happened_on, body, involves_child, context,
    reported_message_id, reported_message_sender_name, reported_message_sent_at, reported_message_body
  )
  values (
    auth.uid(),
    public.display_name(v_me),
    coalesce(p_anonymous, false),
    coalesce(p_contact_ok, false) and not coalesce(p_anonymous, false),
    case when coalesce(p_contact_ok, false) and not coalesce(p_anonymous, false)
      then nullif(trim(left(p_contact_details, 300)), '') end,
    nullif(trim(left(p_about_text, 300)), ''),
    p_happened_on,
    trim(p_body),
    coalesce(p_involves_child, 'unsure'),
    nullif(trim(left(p_context, 300)), ''),
    v_message.id,
    case when v_message.id is not null then coalesce(v_message.sender_name, 'A former member') end,
    v_message.created_at,
    v_message.body
  )
  returning id into v_id;

  insert into public.concern_about_members (concern_id, member_id, member_name, named_by_raiser)
  select v_id, p.id, public.display_name(p), true
  from unnest(v_about) with ordinality u (id, n)
  join public.profiles p on p.id = u.id
  order by u.n;
  perform public.sync_concern_about(v_id);
  return v_id;
end;
$$;

revoke execute on function public.raise_concern(text, text, uuid, date, text, boolean, text, boolean, text, uuid, uuid[]) from public, anon;
grant execute on function public.raise_concern(text, text, uuid, date, text, boolean, text, boolean, text, uuid, uuid[]) to authenticated;

-- The register, as before, with everyone it's about last.
drop function if exists public.concern_register();

create or replace function public.concern_register()
returns table (
  id uuid,
  created_at timestamptz,
  raised_by_name text,
  anonymous boolean,
  contact_ok boolean,
  contact_details text,
  about_member_id uuid,
  about_member_name text,
  about_text text,
  happened_on date,
  body text,
  involves_child text,
  context text,
  status public.concern_status,
  closed_at timestamptz,
  last_action_at timestamptz,
  reported_message_sender_name text,
  reported_message_sent_at timestamptz,
  reported_message_body text,
  reference text,
  about_members jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    c.id, c.created_at,
    case when c.anonymous then null else c.raised_by_name end,
    c.anonymous,
    c.contact_ok,
    case when c.anonymous then null else c.contact_details end,
    c.about_member_id, c.about_member_name, c.about_text, c.happened_on, c.body,
    c.involves_child, c.context, c.status, c.closed_at,
    (select max(e.created_at) from public.concern_events e where e.concern_id = c.id),
    c.reported_message_sender_name, c.reported_message_sent_at, c.reported_message_body,
    public.concern_reference(c.ref_no),
    public.concern_about_list(c.id)
  from public.concerns c
  where public.can_handle_concern(c.id)
  order by c.status = 'closed', c.created_at desc;
$$;

revoke execute on function public.concern_register() from public, anon;
grant execute on function public.concern_register() to authenticated;

-- The member's own concerns, as before, showing only the names they gave
-- and their own words, never names added by those handling it.
create or replace function public.my_concerns()
returns table (
  id uuid,
  created_at timestamptz,
  status public.concern_status,
  about_text text,
  anonymous boolean,
  reference text
)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id, c.created_at, c.status,
    nullif(concat_ws(', ',
      (select string_agg(a.member_name, ', ' order by a.id) from public.concern_about_members a
       where a.concern_id = c.id and a.named_by_raiser),
      c.about_text), ''),
    c.anonymous,
    public.concern_reference(c.ref_no)
  from public.concerns c
  where c.raised_by = auth.uid()
  order by c.created_at desc;
$$;

-- Adds a member to who a concern is about. From then on they can't see it,
-- even as an admin or a safeguarding contact.
create or replace function public.add_concern_about(p_concern_id uuid, p_member_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_about public.profiles;
begin
  if not public.can_handle_concern(p_concern_id) then
    raise exception 'Only the Child Safety Officers, the Complaints Managers and admins can update concerns';
  end if;
  select * into v_about from public.profiles where id = p_member_id;
  if not found then
    raise exception 'Member not found';
  end if;
  if public.is_named_in_concern(p_concern_id, p_member_id) then
    raise exception '% is already named', public.display_name(v_about);
  end if;
  if (select count(*) from public.concern_about_members a where a.concern_id = p_concern_id) >= 10 then
    raise exception 'Name up to 10 people';
  end if;
  insert into public.concern_events (concern_id, by_id, by_name, kind, note)
  select p_concern_id, p.id, public.display_name(p), 'about_changed',
    'Added: ' || public.display_name(v_about)
  from public.profiles p where p.id = auth.uid();
  insert into public.concern_about_members (concern_id, member_id, member_name)
  values (p_concern_id, v_about.id, public.display_name(v_about));
  perform public.sync_concern_about(p_concern_id);
end;
$$;

revoke execute on function public.add_concern_about(uuid, uuid) from public, anon;
grant execute on function public.add_concern_about(uuid, uuid) to authenticated;

-- Takes a member off who a concern is about. They can see it again if they
-- handle concerns.
create or replace function public.remove_concern_about(p_concern_id uuid, p_member_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
begin
  if not public.can_handle_concern(p_concern_id) then
    raise exception 'Only the Child Safety Officers, the Complaints Managers and admins can update concerns';
  end if;
  select a.member_name into v_name from public.concern_about_members a
  where a.concern_id = p_concern_id and a.member_id = p_member_id;
  if not found then
    raise exception 'That person isn''t named on this concern';
  end if;
  insert into public.concern_events (concern_id, by_id, by_name, kind, note)
  select p_concern_id, p.id, public.display_name(p), 'about_changed', 'Removed: ' || v_name
  from public.profiles p where p.id = auth.uid();
  delete from public.concern_about_members a
  where a.concern_id = p_concern_id and a.member_id = p_member_id;
  perform public.sync_concern_about(p_concern_id);
end;
$$;

revoke execute on function public.remove_concern_about(uuid, uuid) from public, anon;
grant execute on function public.remove_concern_about(uuid, uuid) to authenticated;

-- The old one-person change, for app versions not yet updated: names just
-- this member, or nobody.
create or replace function public.set_concern_about(p_concern_id uuid, p_member_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_about public.profiles;
begin
  if not public.can_handle_concern(p_concern_id) then
    raise exception 'Only the Child Safety Officers, the Complaints Managers and admins can update concerns';
  end if;
  if p_member_id is not null then
    select * into v_about from public.profiles where id = p_member_id;
    if not found then
      raise exception 'Member not found';
    end if;
  end if;
  insert into public.concern_events (concern_id, by_id, by_name, kind, note)
  select p_concern_id, p.id, public.display_name(p), 'about_changed',
    'About: ' || coalesce(public.display_name(v_about), 'nobody named')
  from public.profiles p where p.id = auth.uid();
  delete from public.concern_about_members a
  where a.concern_id = p_concern_id and a.member_id is distinct from v_about.id;
  if v_about.id is not null then
    insert into public.concern_about_members (concern_id, member_id, member_name)
    values (p_concern_id, v_about.id, public.display_name(v_about))
    on conflict (concern_id, member_id) do nothing;
  end if;
  perform public.sync_concern_about(p_concern_id);
end;
$$;

-- The verified parents and guardians of every child under 18 a concern is
-- about, for those who handle it, with the child's name. Each look is kept
-- with the concern, as before.
drop function if exists public.concern_guardians(uuid);

create or replace function public.concern_guardians(p_concern_id uuid)
returns table (guardian_id uuid, name text, email text, child_id uuid, child_name text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not coalesce(public.can_handle_concern(p_concern_id), false) then
    return;
  end if;

  return query
    select g.id, public.display_name(g), g.email, child.id, public.display_name(child)
    from public.concern_about_members a
    join public.profiles child on child.id = a.member_id
    join public.guardianships gs on gs.athlete_id = child.id
    join public.profiles g on g.id = gs.guardian_id
    where a.concern_id = p_concern_id
      and public.is_minor(child.date_of_birth, child.under_17)
      and g.status = 'approved' and g.verified_at is not null
    order by 5, 4, 2, 1;

  if found and not exists (
    select 1 from public.concern_guardian_views v
    where v.concern_id = p_concern_id and v.viewer_id = auth.uid()
      and v.created_at > now() - interval '30 minutes'
  ) then
    insert into public.concern_guardian_views (concern_id, viewer_id, viewer_name)
    values (p_concern_id, auth.uid(), coalesce(public.member_display_name(auth.uid()), 'Member'));
  end if;
end;
$$;

revoke execute on function public.concern_guardians(uuid) from public, anon;
grant execute on function public.concern_guardians(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Message access, as in 20261121100000, with every person a concern is about
-- ---------------------------------------------------------------------------

create or replace function public.message_access_other_admin(p_request public.message_access_requests)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.status = 'approved' and p.stood_down_at is null
      and 'admin' = any (public.roles_of(p.role, p.extra_roles))
      and p.id <> p_request.requested_by
      and p.id <> p_request.subject_id
      and not public.is_named_in_concern(p_request.concern_id, p.id)
  );
$$;

create or replace function public.message_access_can_decide(p_request public.message_access_requests)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null
    and p_request.status = 'pending'
    and auth.uid() <> p_request.requested_by
    and auth.uid() <> p_request.subject_id
    and not public.is_named_in_concern(p_request.concern_id, auth.uid())
    and (
      public.has_role('admin')
      or (public.my_safeguarding_post() is not null and not public.message_access_other_admin(p_request))
    );
$$;

create or replace function public.message_access_can_see(p_request public.message_access_requests)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null
    and auth.uid() <> p_request.subject_id
    and not public.is_named_in_concern(p_request.concern_id, auth.uid())
    and (
      auth.uid() = p_request.requested_by
      or public.has_role('admin')
      or public.my_safeguarding_post() is not null
    );
$$;

create or replace function public.message_access_people(p_concern_id uuid)
returns table (link text, profile_id uuid, name text)
language sql
stable
security definer
set search_path = ''
as $$
  select x.link, p.id, public.display_name(p)
  from public.concerns c
  cross join lateral (
    select 'about' as link, a.member_id as pid, a.id as n
    from public.concern_about_members a where a.concern_id = c.id
    union all
    select 'raised_by', case when not c.anonymous then c.raised_by end, null
  ) x
  join public.profiles p on p.id = x.pid
  where c.id = p_concern_id
    and public.my_safeguarding_post() is not null
    and public.can_handle_concern(c.id)
    and p.id <> auth.uid()
  order by x.link, x.n;
$$;

create or replace function public.request_message_access(
  p_concern_id uuid,
  p_subject_id uuid,
  p_link text,
  p_from date,
  p_to date,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_post text := public.my_safeguarding_post();
  v_concern public.concerns;
  v_subject public.profiles;
  v_me public.profiles;
  v_today date;
  v_id uuid;
begin
  if v_post is null then
    raise exception 'Only the Child Safety Officer or the Complaints Manager can ask to read messages';
  end if;
  select * into v_concern from public.concerns where id = p_concern_id;
  if not found or not public.can_handle_concern(p_concern_id) then
    raise exception 'Concern not found';
  end if;
  if v_concern.status = 'closed' then
    raise exception 'This concern is closed. Reopen it before asking to read messages';
  end if;
  select * into v_subject from public.profiles where id = p_subject_id;
  if not found then
    raise exception 'Choose whose messages to read';
  end if;
  if p_subject_id = auth.uid() then
    raise exception 'You can''t ask to read your own messages';
  end if;
  if p_link is null or p_link not in ('about', 'raised_by', 'other') then
    raise exception 'Say how this person is involved in the concern';
  end if;
  if p_link = 'about' and not public.is_named_in_concern(p_concern_id, p_subject_id) then
    raise exception 'This concern isn''t about that person';
  end if;
  if p_link = 'raised_by' and (v_concern.anonymous or v_concern.raised_by is distinct from p_subject_id) then
    raise exception 'That person didn''t raise this concern';
  end if;
  if length(trim(coalesce(p_reason, ''))) < 10 then
    raise exception 'Give a reason of at least 10 characters';
  end if;
  if length(trim(p_reason)) > 1000 then
    raise exception 'The reason can be up to 1,000 characters';
  end if;
  select (now() at time zone coalesce((select s.timezone from public.club_settings s where s.id), 'Australia/Perth'))::date
  into v_today;
  if p_from is null or p_to is null or p_from > p_to then
    raise exception 'Choose a start date on or before the end date';
  end if;
  if p_to > v_today then
    raise exception 'The end date can''t be in the future';
  end if;
  if p_to - p_from > 90 then
    raise exception 'Ask for 90 days or less at a time';
  end if;
  if exists (
    select 1 from public.message_access_requests r
    where r.requested_by = auth.uid() and r.subject_id = p_subject_id
      and r.concern_id = p_concern_id and r.status = 'pending'
  ) then
    raise exception 'You''ve already asked to read this person''s messages for this concern. Wait for an answer';
  end if;

  select * into v_me from public.profiles where id = auth.uid();
  insert into public.message_access_requests (
    concern_id, requested_by, requested_by_name, requested_post,
    subject_id, subject_name, subject_link, from_date, to_date, reason
  )
  values (
    p_concern_id, auth.uid(), public.display_name(v_me), v_post,
    p_subject_id, public.display_name(v_subject), p_link, p_from, p_to, trim(p_reason)
  )
  returning id into v_id;
  return v_id;
end;
$$;


-- A member is on legal hold, as before, also while any concern names them
-- among the people it's about.
create or replace function public.on_legal_hold(p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_profile_id is not null and (
    exists (select 1 from public.concerns c where c.about_member_id = p_profile_id)
    or exists (select 1 from public.concern_about_members a where a.member_id = p_profile_id)
    or exists (
      select 1 from public.message_access_requests r
      join public.concerns c on c.id = r.concern_id
      where r.subject_id = p_profile_id and c.status <> 'closed'
    )
  );
$$;

commit;
