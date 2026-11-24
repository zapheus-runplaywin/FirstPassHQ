-- Admins act in an empty safeguarding post (Matt, 24 November 2026).
--
-- When nobody named as Child Safety Officer, Complaints Manager or WWC
-- Registration Officer can act (none named, or every one's check has lapsed
-- or they're stood down), each admin who could hold the post acts in it, with
-- the post's full powers, and is shown as "(acting)":
--   * Child Safety Officer (acting): wellbeing flags, training load patterns,
--     asking to read a member's messages for a concern.
--   * Complaints Manager (acting): asking to read a member's messages.
--   * WWC Registration Officer (acting): the title only; admins already keep
--     the check records.
-- "Could hold the post" is the same rule as for anyone named: approved, an
-- adult, not stood down, with a current check or an exemption that applies.
-- An admin without a current check doesn't act. Acting ends the moment
-- someone named can act again. The admin to-dos asking to name someone stay
-- until someone is named, so acting is only ever a stopgap.
--
-- Requests to read messages now record whether the person asking was acting,
-- so the admin answering, and the request's record, say so. Members' "who to
-- talk to" lists the acting admins, marked acting, when nobody named can act.
--
-- Additive: new functions, one new column with a default, a trigger, and
-- functions replaced. No rows are changed.

begin;

-- ---------------------------------------------------------------------------
-- 1. Who acts
-- ---------------------------------------------------------------------------

-- Whether this member acts in the post now: an admin who could hold it, while
-- nobody named in it can act.
create or replace function public.acting_in_safeguarding_post(p_post text, p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_post in ('child_safety_officer', 'complaints_manager', 'wwc_officer')
    and not public.safeguarding_post_filled(p_post)
    and public.can_be_safeguarding_contact(p_profile_id)
    and exists (
      select 1 from public.profiles p
      where p.id = p_profile_id
        and 'admin' = any (public.roles_of(p.role, p.extra_roles))
    );
$$;

revoke execute on function public.acting_in_safeguarding_post(text, uuid) from public, anon, authenticated;

-- The admins acting in the post now, as [{id, name, acting: true}], by name.
create or replace function public.safeguarding_post_acting_people(p_post text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', public.display_name(p), 'acting', true)
    order by public.display_name(p), p.id), '[]'::jsonb)
  from public.profiles p
  where 'admin' = any (public.roles_of(p.role, p.extra_roles))
    and public.acting_in_safeguarding_post(p_post, p.id);
$$;

revoke execute on function public.safeguarding_post_acting_people(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. The post checks, now counting an acting admin
-- ---------------------------------------------------------------------------

create or replace function public.is_safeguarding_officer()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (
    exists (
      select 1 from public.safeguarding_post_holders h
      where h.profile_id = auth.uid() and h.post in ('child_safety_officer', 'complaints_manager')
    ) and public.can_be_safeguarding_contact(auth.uid())
  )
  or public.acting_in_safeguarding_post('child_safety_officer', auth.uid())
  or public.acting_in_safeguarding_post('complaints_manager', auth.uid());
$$;

revoke execute on function public.is_safeguarding_officer() from public, anon;
grant execute on function public.is_safeguarding_officer() to authenticated;

create or replace function public.is_child_safety_officer()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (public.holds_safeguarding_post('child_safety_officer', auth.uid())
      and public.can_be_safeguarding_contact(auth.uid()))
    or public.acting_in_safeguarding_post('child_safety_officer', auth.uid());
$$;

revoke execute on function public.is_child_safety_officer() from public, anon;
grant execute on function public.is_child_safety_officer() to authenticated;

-- The signed-in member's safeguarding post: the one they hold first, then
-- one they act in (Child Safety Officer before Complaints Manager).
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
    when public.acting_in_safeguarding_post('child_safety_officer', auth.uid()) then 'child_safety_officer'
    when public.acting_in_safeguarding_post('complaints_manager', auth.uid()) then 'complaints_manager'
  end;
$$;

revoke execute on function public.my_safeguarding_post() from public, anon, authenticated;

-- The posts the signed-in member acts in, for "(acting)" on the titles line.
-- The same shape as my_safeguarding_posts(), which stays the posts they hold;
-- the app shows both. A new function rather than new columns, so the older
-- migrations that define my_safeguarding_posts() still re-run cleanly.
create or replace function public.my_acting_safeguarding_posts()
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
    public.acting_in_safeguarding_post('child_safety_officer', auth.uid()),
    public.acting_in_safeguarding_post('complaints_manager', auth.uid()),
    public.acting_in_safeguarding_post('wwc_officer', auth.uid())
  where auth.uid() is not null;
$$;

revoke execute on function public.my_acting_safeguarding_posts() from public, anon;
grant execute on function public.my_acting_safeguarding_posts() to authenticated;

-- Who to talk to: the holders who can act now, or, when none can, the admins
-- acting in the post, each marked "acting": true.
create or replace function public.safeguarding_post_people(p_post text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when public.safeguarding_post_filled(p_post) then (
      select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', public.display_name(p), 'acting', false)
        order by public.display_name(p), p.id), '[]'::jsonb)
      from public.safeguarding_post_holders h
      join public.profiles p on p.id = h.profile_id
      where h.post = p_post and public.can_be_safeguarding_contact(p.id)
    )
    else public.safeguarding_post_acting_people(p_post)
  end;
$$;

revoke execute on function public.safeguarding_post_people(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Requests to read messages say when the person asking was acting
-- ---------------------------------------------------------------------------

alter table public.message_access_requests
  add column if not exists requested_acting boolean not null default false;

create or replace function public.message_access_request_acting()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.requested_acting := not public.holds_safeguarding_post(new.requested_post, new.requested_by);
  return new;
end;
$$;

revoke execute on function public.message_access_request_acting() from public, anon, authenticated;

drop trigger if exists message_access_request_acting on public.message_access_requests;
create trigger message_access_request_acting
  before insert on public.message_access_requests
  for each row execute function public.message_access_request_acting();

drop function if exists public.message_access_requests();

create function public.message_access_requests()
returns table (
  id uuid,
  reference text,
  created_at timestamptz,
  concern_id uuid,
  concern_reference text,
  concern_open boolean,
  requested_by_name text,
  requested_post text,
  subject_name text,
  subject_link text,
  from_date date,
  to_date date,
  reason text,
  status text,
  decided_by_name text,
  decided_at timestamptz,
  decision_note text,
  access_expires_at timestamptz,
  mine boolean,
  can_decide boolean,
  views integer,
  requested_acting boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select r.id, 'R-' || lpad(r.ref_no::text, greatest(4, length(r.ref_no::text)), '0'), r.created_at,
    r.concern_id, public.concern_reference(c.ref_no), c.status <> 'closed',
    r.requested_by_name, r.requested_post, r.subject_name, r.subject_link,
    r.from_date, r.to_date, r.reason, r.status,
    r.decided_by_name, r.decided_at, r.decision_note, r.access_expires_at,
    r.requested_by = auth.uid(),
    public.message_access_can_decide(r),
    (select count(*)::int from public.message_access_views v where v.request_id = r.id and v.kind = 'opened'),
    r.requested_acting
  from public.message_access_requests r
  join public.concerns c on c.id = r.concern_id
  where public.message_access_can_see(r)
  order by r.status <> 'pending', r.created_at desc;
$$;

revoke execute on function public.message_access_requests() from public, anon;
grant execute on function public.message_access_requests() to authenticated;

commit;
