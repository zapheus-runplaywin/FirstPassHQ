-- Safeguarding contacts, Raise a concern, and the concerns register.
--
-- Until now nobody in the app had a path to report something worrying about
-- a child, there was no name to call, and the club kept no record of a
-- concern or what was done about it (child-safety audit finding 3).
--
-- Admins now name the club's Child Safety Officer and Complaints Manager,
-- who must be approved adults with a current check or exemption, and can add
-- the governing body's name, phone and complaints link and the club's
-- safeguarding policy. Every signed-in person, including guests and people
-- still waiting for approval, can raise a concern, and can ask for their name
-- not to be shown. The two officers and admins see the concerns register and
-- record what they did: referred to the governing body or Police, notes, and
-- the status. Nobody sees a concern about themselves, even an admin or an
-- officer. The register is read through functions only, so an anonymous
-- concern never shows who raised it.
--
-- Additive only: new types, tables and functions.

begin;

-- ---------------------------------------------------------------------------
-- Safeguarding contacts
-- ---------------------------------------------------------------------------

create table if not exists public.safeguarding_settings (
  -- Always true: the table holds a single row.
  id boolean primary key default true check (id),
  child_safety_officer_id uuid references public.profiles (id) on delete set null,
  complaints_manager_id uuid references public.profiles (id) on delete set null,
  governing_body_name text check (length(governing_body_name) <= 100),
  governing_body_phone text check (length(governing_body_phone) <= 30),
  governing_body_url text check (governing_body_url ~ '^https://' and length(governing_body_url) <= 500),
  policy_url text check (policy_url ~ '^https://' and length(policy_url) <= 500),
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz
);

insert into public.safeguarding_settings default values on conflict (id) do nothing;

-- No policies: only reached through the functions below.
alter table public.safeguarding_settings enable row level security;

-- Whether a member can be a safeguarding contact: an approved adult, not
-- stood down, with a current check or an exemption that applies.
create or replace function public.can_be_safeguarding_contact(p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = p_profile_id and p.status = 'approved' and p.stood_down_at is null
      and not public.is_minor(p.date_of_birth, p.under_17)
  ) and public.is_cleared(p_profile_id);
$$;

revoke execute on function public.can_be_safeguarding_contact(uuid) from public, anon, authenticated;

-- Whether the signed-in member is the Child Safety Officer or Complaints
-- Manager, and can act as one right now.
create or replace function public.is_safeguarding_officer()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.safeguarding_settings s
    where auth.uid() in (s.child_safety_officer_id, s.complaints_manager_id)
  ) and public.can_be_safeguarding_contact(auth.uid());
$$;

revoke execute on function public.is_safeguarding_officer() from public, anon;
grant execute on function public.is_safeguarding_officer() to authenticated;

create or replace function public.display_name(p public.profiles)
returns text
language sql
immutable
set search_path = ''
as $$
  select coalesce(nullif(trim(p.preferred_name), ''), nullif(trim(p.full_name), ''), p.email);
$$;

revoke execute on function public.display_name(public.profiles) from public, anon, authenticated;

-- Who to talk to, for everyone signed in (guests and people waiting for
-- approval too). A contact who can't act right now isn't shown.
create or replace function public.safeguarding_contacts()
returns table (
  child_safety_officer_id uuid,
  child_safety_officer_name text,
  complaints_manager_id uuid,
  complaints_manager_name text,
  governing_body_name text,
  governing_body_phone text,
  governing_body_url text,
  policy_url text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    case when public.can_be_safeguarding_contact(o.id) then o.id end,
    case when public.can_be_safeguarding_contact(o.id) then public.display_name(o) end,
    case when public.can_be_safeguarding_contact(m.id) then m.id end,
    case when public.can_be_safeguarding_contact(m.id) then public.display_name(m) end,
    s.governing_body_name, s.governing_body_phone, s.governing_body_url, s.policy_url
  from public.safeguarding_settings s
  left join public.profiles o on o.id = s.child_safety_officer_id
  left join public.profiles m on m.id = s.complaints_manager_id
  where auth.uid() is not null;
$$;

revoke execute on function public.safeguarding_contacts() from public, anon;
grant execute on function public.safeguarding_contacts() to authenticated;

-- Saves the safeguarding contacts and links. Blank text clears a field.
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
declare
  v_body_url text := nullif(trim(p_governing_body_url), '');
  v_policy_url text := nullif(trim(p_policy_url), '');
begin
  if not public.is_admin() then
    raise exception 'Only admins can change the safeguarding contacts';
  end if;
  if p_child_safety_officer_id is not null
     and not public.can_be_safeguarding_contact(p_child_safety_officer_id) then
    raise exception 'The Child Safety Officer must be an approved adult with a current Working With Children Check';
  end if;
  if p_complaints_manager_id is not null
     and not public.can_be_safeguarding_contact(p_complaints_manager_id) then
    raise exception 'The Complaints Manager must be an approved adult with a current Working With Children Check';
  end if;
  if p_child_safety_officer_id = p_complaints_manager_id then
    raise exception 'Choose two different people, so a concern about one of them can go to the other';
  end if;
  if auth.uid() in (p_child_safety_officer_id, p_complaints_manager_id)
     and (p_child_safety_officer_id is null or p_complaints_manager_id is null) then
    raise exception 'Choose a second contact as well, so a concern about you has somewhere to go';
  end if;
  if v_body_url !~ '^https://' or v_policy_url !~ '^https://' then
    raise exception 'Links must start with https://';
  end if;

  update public.safeguarding_settings
  set child_safety_officer_id = p_child_safety_officer_id,
      complaints_manager_id = p_complaints_manager_id,
      governing_body_name = nullif(trim(p_governing_body_name), ''),
      governing_body_phone = nullif(trim(p_governing_body_phone), ''),
      governing_body_url = v_body_url,
      policy_url = v_policy_url,
      updated_by = auth.uid(),
      updated_at = now()
  where id;
end;
$$;

revoke execute on function public.admin_set_safeguarding(uuid, uuid, text, text, text, text) from public, anon;
grant execute on function public.admin_set_safeguarding(uuid, uuid, text, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Concerns
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_type where typname = 'concern_status'
                 and typnamespace = 'public'::regnamespace) then
    create type public.concern_status as enum ('received', 'referred', 'under_review', 'closed');
  end if;
  if not exists (select 1 from pg_type where typname = 'concern_event_kind'
                 and typnamespace = 'public'::regnamespace) then
    create type public.concern_event_kind as enum (
      'note', 'referred_governing_body', 'referred_police', 'status_changed', 'about_changed'
    );
  end if;
end;
$$;

create table if not exists public.concerns (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  -- Kept even when they asked for their name not to be shown, so they can
  -- follow it and so the club can stop misuse. Never shown to the officers
  -- when anonymous.
  raised_by uuid references public.profiles (id) on delete set null,
  raised_by_name text,
  anonymous boolean not null default false,
  contact_ok boolean not null default false,
  contact_details text check (length(contact_details) <= 300),
  -- Who it's about: a member, when known, and in the raiser's words.
  about_member_id uuid references public.profiles (id) on delete set null,
  about_member_name text,
  about_text text check (length(about_text) <= 300),
  happened_on date,
  body text not null check (length(trim(body)) between 1 and 5000),
  involves_child text not null default 'unsure' check (involves_child in ('yes', 'no', 'unsure')),
  -- Where it was raised from, for example a message or an injury.
  context text check (length(context) <= 300),
  status public.concern_status not null default 'received',
  closed_at timestamptz
);

create index if not exists concerns_created_at_idx on public.concerns (created_at desc);
create index if not exists concerns_raised_by_idx on public.concerns (raised_by);

create table if not exists public.concern_events (
  id uuid primary key default gen_random_uuid(),
  concern_id uuid not null references public.concerns (id) on delete cascade,
  created_at timestamptz not null default now(),
  by_id uuid references public.profiles (id) on delete set null,
  by_name text,
  kind public.concern_event_kind not null,
  status public.concern_status,
  note text check (length(note) <= 2000)
);

create index if not exists concern_events_concern_idx on public.concern_events (concern_id, created_at);

-- No policies: read and written only through the functions below.
alter table public.concerns enable row level security;
alter table public.concern_events enable row level security;

-- Whether the signed-in member handles this concern: an admin or a
-- safeguarding officer, and not the person it's about.
create or replace function public.can_handle_concern(p_concern_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (public.is_admin() or public.is_safeguarding_officer())
    and exists (
      select 1 from public.concerns c
      where c.id = p_concern_id and c.about_member_id is distinct from auth.uid()
    );
$$;

revoke execute on function public.can_handle_concern(uuid) from public, anon, authenticated;

-- Raises a concern. Anyone signed in can, guests and people waiting for
-- approval included. Returns the new concern's id.
create or replace function public.raise_concern(
  p_body text,
  p_about_text text default null,
  p_about_member_id uuid default null,
  p_happened_on date default null,
  p_involves_child text default 'unsure',
  p_contact_ok boolean default false,
  p_contact_details text default null,
  p_anonymous boolean default false,
  p_context text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me public.profiles;
  v_about public.profiles;
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
  if p_about_member_id is not null then
    select * into v_about from public.profiles where id = p_about_member_id;
  end if;

  insert into public.concerns (
    raised_by, raised_by_name, anonymous, contact_ok, contact_details,
    about_member_id, about_member_name, about_text, happened_on, body, involves_child, context
  )
  values (
    auth.uid(),
    public.display_name(v_me),
    coalesce(p_anonymous, false),
    coalesce(p_contact_ok, false) and not coalesce(p_anonymous, false),
    case when coalesce(p_contact_ok, false) and not coalesce(p_anonymous, false)
      then nullif(trim(left(p_contact_details, 300)), '') end,
    v_about.id,
    case when v_about.id is not null then public.display_name(v_about) end,
    nullif(trim(left(p_about_text, 300)), ''),
    p_happened_on,
    trim(p_body),
    coalesce(p_involves_child, 'unsure'),
    nullif(trim(left(p_context, 300)), '')
  )
  returning id into v_id;
  return v_id;
end;
$$;

revoke execute on function public.raise_concern(text, text, uuid, date, text, boolean, text, boolean, text) from public, anon;
grant execute on function public.raise_concern(text, text, uuid, date, text, boolean, text, boolean, text) to authenticated;

-- Club leaders a concern can be about, picked by name on the form: approved
-- coaches, managers, physios, committee members and admins.
create or replace function public.concern_people()
returns table (id uuid, name text)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, public.display_name(p)
  from public.profiles p
  where auth.uid() is not null and p.status = 'approved'
    and public.roles_of(p.role, p.extra_roles)
      && array['coach', 'manager', 'physio', 'committee', 'admin']::public.app_role[]
  order by 2;
$$;

revoke execute on function public.concern_people() from public, anon;
grant execute on function public.concern_people() to authenticated;

-- The concerns the signed-in member raised, so they can see where each is up to.
create or replace function public.my_concerns()
returns table (id uuid, created_at timestamptz, status public.concern_status, about_text text, anonymous boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id, c.created_at, c.status, coalesce(c.about_text, c.about_member_name), c.anonymous
  from public.concerns c
  where c.raised_by = auth.uid()
  order by c.created_at desc;
$$;

revoke execute on function public.my_concerns() from public, anon;
grant execute on function public.my_concerns() to authenticated;

-- The concerns register, newest first, for those who handle concerns. The
-- raiser's name and contact details are left out when they asked.
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
  last_action_at timestamptz
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
    (select max(e.created_at) from public.concern_events e where e.concern_id = c.id)
  from public.concerns c
  where public.can_handle_concern(c.id)
  order by c.status = 'closed', c.created_at desc;
$$;

revoke execute on function public.concern_register() from public, anon;
grant execute on function public.concern_register() to authenticated;

-- What was done about a concern, oldest first.
create or replace function public.concern_history(p_concern_id uuid)
returns table (
  id uuid,
  created_at timestamptz,
  by_name text,
  kind public.concern_event_kind,
  status public.concern_status,
  note text
)
language sql
stable
security definer
set search_path = ''
as $$
  select e.id, e.created_at, e.by_name, e.kind, e.status, e.note
  from public.concern_events e
  where e.concern_id = p_concern_id and public.can_handle_concern(p_concern_id)
  order by e.created_at;
$$;

revoke execute on function public.concern_history(uuid) from public, anon;
grant execute on function public.concern_history(uuid) to authenticated;

-- Records something done about a concern: a note, a referral, or a new
-- status (closing it needs a note saying why).
create or replace function public.add_concern_event(
  p_concern_id uuid,
  p_kind public.concern_event_kind,
  p_note text default null,
  p_status public.concern_status default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_note text := nullif(trim(p_note), '');
  v_status public.concern_status := p_status;
begin
  if not public.can_handle_concern(p_concern_id) then
    raise exception 'Only the Child Safety Officer, the Complaints Manager and admins can update concerns';
  end if;
  if length(v_note) > 2000 then
    raise exception 'Keep the note under 2000 characters';
  end if;
  if p_kind = 'about_changed' then
    raise exception 'Use set_concern_about to change who it''s about';
  end if;
  if p_kind = 'note' and v_note is null then
    raise exception 'Write the note';
  end if;
  if p_kind in ('referred_governing_body', 'referred_police') then
    v_status := coalesce(v_status, 'referred');
  end if;
  if p_kind = 'status_changed' and v_status is null then
    raise exception 'Choose the new status';
  end if;
  if v_status = 'closed' and v_note is null then
    raise exception 'Write why it''s closed';
  end if;

  insert into public.concern_events (concern_id, by_id, by_name, kind, status, note)
  select p_concern_id, p.id, public.display_name(p), p_kind, v_status, v_note
  from public.profiles p where p.id = auth.uid();

  if v_status is not null then
    update public.concerns
    set status = v_status,
        closed_at = case when v_status = 'closed' then now() end
    where id = p_concern_id;
  end if;
end;
$$;

revoke execute on function public.add_concern_event(uuid, public.concern_event_kind, text, public.concern_status) from public, anon;
grant execute on function public.add_concern_event(uuid, public.concern_event_kind, text, public.concern_status) to authenticated;

-- Records which member a concern is about, or clears it. From then on that
-- member can't see it, even as an admin or officer.
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
    raise exception 'Only the Child Safety Officer, the Complaints Manager and admins can update concerns';
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
  update public.concerns
  set about_member_id = v_about.id,
      about_member_name = case when v_about.id is not null then public.display_name(v_about) end
  where id = p_concern_id;
end;
$$;

revoke execute on function public.set_concern_about(uuid, uuid) from public, anon;
grant execute on function public.set_concern_about(uuid, uuid) to authenticated;

-- How many concerns nobody has acted on yet, for the handlers' to-do list.
create or replace function public.new_concerns_count()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::int from public.concerns c
  where c.status = 'received' and public.can_handle_concern(c.id)
    and not exists (select 1 from public.concern_events e where e.concern_id = c.id);
$$;

revoke execute on function public.new_concerns_count() from public, anon;
grant execute on function public.new_concerns_count() to authenticated;

commit;
