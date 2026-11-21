-- Archiving messages, and safeguarding access to a member's messages (Matt,
-- 21 November 2026).
--
-- 1. Archive. A member swipes a message in their inbox to archive it, and the
--    inbox has Inbox, Sent and Archived tabs instead of "Hide read". Nothing
--    is ever deleted: archiving only moves the member's own copy, so the
--    sender, the other recipients and parents' copies are untouched, and the
--    message stays for the club's keep periods like any other. Archiving
--    clears the unread dot without touching the sender's read receipt (the
--    same rule as "Mark all read"). "Move to inbox" and "Mark as unread" bring
--    it back. Sent messages can't be archived.
--
-- 2. Concern references. Every concern (complaints are concerns in the app)
--    gets a short reference such as C-0007, so a request can name it without
--    anyone else needing to read it. Existing concerns are numbered in the
--    order they are stored when the column is added; nothing is overwritten.
--
-- 3. Admins (and the committee, who count as admins in the database) no
--    longer read every message. Each member reads the messages they sent
--    (unless stood down) and the ones they received, and that's all. The only
--    other way to read a member's messages is an approved access request.
--
-- 4. Message access requests. The Child Safety Officer or the Complaints
--    Manager asks to read one member's messages between two dates (at most
--    90 days apart), for an open concern, with a reason. The member must be
--    the person the concern is about, the person who raised it (unless they
--    asked not to be named), or someone else the requester says is involved.
--    An admin who isn't the requester, the member or the person the concern
--    is about approves it with a justification or refuses it with reasons.
--    Only when no such admin exists can the other safeguarding officer decide.
--    Approval opens 24 hours of read-only access for the requester alone, on
--    their own account: there is no code to pass on. The list shows each
--    message's date, sender and who it went to; opening one shows its text,
--    and every list and every opening is logged. Nobody is told: not the
--    member, not their parents, not the committee. The log is its own table,
--    not the "who viewed records" log that parents can read. Requests and
--    their logs are never removed, like concerns.
--
-- 5. Legal hold. A member named in a request for a concern that is still open
--    is on legal hold, so "Remove old records" can't blank their messages in
--    the middle of an investigation.
--
-- Additive: new columns (one nullable, one identity filled in by Postgres),
-- two new tables with their grants, and new or replaced functions and
-- policies that let fewer people read, never more. No rows are changed.

begin;

-- ---------------------------------------------------------------------------
-- 1. Archive
-- ---------------------------------------------------------------------------

alter table public.message_recipients
  add column if not exists archived_at timestamptz;

create index if not exists message_recipients_archived_idx
  on public.message_recipients (profile_id, created_at desc)
  where archived_at is not null;

-- Moves one of the member's own messages to Archived. An unread one is
-- marked read in their own inbox only, so the sender's receipt still means
-- "opened".
create or replace function public.archive_message(p_message_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.message_recipients
  set archived_at = now(),
      inbox_state = case when unread then 'read' else inbox_state end
  where message_id = p_message_id
    and profile_id = auth.uid()
    and archived_at is null;
$$;

revoke execute on function public.archive_message(uuid) from public, anon;
grant execute on function public.archive_message(uuid) to authenticated;

-- Moves one of the member's archived messages back to their inbox.
create or replace function public.move_message_to_inbox(p_message_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.message_recipients
  set archived_at = null
  where message_id = p_message_id
    and profile_id = auth.uid()
    and archived_at is not null;
$$;

revoke execute on function public.move_message_to_inbox(uuid) from public, anon;
grant execute on function public.move_message_to_inbox(uuid) to authenticated;

-- "Mark as unread", as before, and an archived message goes back to the inbox
-- so the dot can be seen.
create or replace function public.mark_message_unread(p_message_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.message_recipients
  set inbox_state = 'unread',
      archived_at = null
  where message_id = p_message_id
    and profile_id = auth.uid()
    and (inbox_state is distinct from 'unread' or archived_at is not null);
$$;

revoke execute on function public.mark_message_unread(uuid) from public, anon;
grant execute on function public.mark_message_unread(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Concern references
-- ---------------------------------------------------------------------------

alter table public.concerns
  add column if not exists ref_no bigint generated always as identity;

create unique index if not exists concerns_ref_no_idx on public.concerns (ref_no);

create or replace function public.concern_reference(p_ref_no bigint)
returns text
language sql
immutable
set search_path = ''
as $$
  select 'C-' || lpad(p_ref_no::text, greatest(4, length(p_ref_no::text)), '0');
$$;

revoke execute on function public.concern_reference(bigint) from public, anon;
grant execute on function public.concern_reference(bigint) to authenticated;

-- The register, as before, with the reference last.
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
  reference text
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
    public.concern_reference(c.ref_no)
  from public.concerns c
  where public.can_handle_concern(c.id)
  order by c.status = 'closed', c.created_at desc;
$$;

revoke execute on function public.concern_register() from public, anon;
grant execute on function public.concern_register() to authenticated;

-- The member's own concerns, as before, with the reference, so they can quote
-- it to the club.
drop function if exists public.my_concerns();

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
  select c.id, c.created_at, c.status, coalesce(c.about_text, c.about_member_name), c.anonymous,
    public.concern_reference(c.ref_no)
  from public.concerns c
  where c.raised_by = auth.uid()
  order by c.created_at desc;
$$;

revoke execute on function public.my_concerns() from public, anon;
grant execute on function public.my_concerns() to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Admins no longer read every message
-- ---------------------------------------------------------------------------

alter policy "Senders, recipients and admins see messages" on public.messages
  using ((((sender_id = (select auth.uid())) and (not (select public.is_stood_down())))
    or public.is_message_recipient(id)));
alter policy "Senders, recipients and admins see messages" on public.messages
  rename to "Senders and recipients see messages";

alter policy "Recipients, senders and admins see receipts" on public.message_recipients
  using ((((profile_id = (select auth.uid())) and public.is_message_recipient(message_id))
    or public.is_message_sender(message_id)));
alter policy "Recipients, senders and admins see receipts" on public.message_recipients
  rename to "Recipients and senders see receipts";

-- Read receipts: the sender only.
create or replace function public.message_receipts(p_message_id uuid)
returns table (profile_id uuid, full_name text, read_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select r.profile_id,
    coalesce(nullif(p.full_name, ''), p.email, r.member_name || ' (deleted)')
      || case when p.no_sign_in then ' (no app, parents copied)' else '' end,
    -- A child who doesn't use the app has read it once a parent read their copy.
    case when p.no_sign_in then (
      select min(gr.read_at) from public.message_recipients gr
      join public.guardianships g on g.guardian_id = gr.profile_id and g.athlete_id = r.profile_id
      where gr.message_id = r.message_id
    ) else r.read_at end
  from public.message_recipients r
  left join public.profiles p on p.id = r.profile_id
  where r.message_id = p_message_id
    and (p.id is not null or r.member_left_at is not null)
    and public.is_message_sender(p_message_id)
  order by 3 is null, 3 desc, 2;
$$;

-- Who answered a message's question: its sender and the coaches and managers
-- of the squad or team it went to. Admins no longer.
create or replace function public.sees_message_answers(p_message_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_message_sender(p_message_id)
    or exists (
      select 1 from public.messages m
      where m.id = p_message_id and m.team_id is not null
        and public.survey_leads_group(m.team_id, true)
    );
$$;
revoke execute on function public.sees_message_answers(uuid) from public, anon;
grant execute on function public.sees_message_answers(uuid) to authenticated;

-- Raise a concern, as in 20261119130000_concern_reported_message, except that
-- an admin can no longer copy a message they didn't send or get into one.
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
  p_message_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me public.profiles;
  v_about public.profiles;
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
  if p_about_member_id is not null then
    select * into v_about from public.profiles where id = p_about_member_id;
  end if;
  -- The message reported: only one the reporter can see, by the same rule as
  -- reading messages (its sender unless stood down, or a recipient). Admins
  -- no longer read every message, so they can't report one they didn't get.
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
    about_member_id, about_member_name, about_text, happened_on, body, involves_child, context,
    reported_message_id, reported_message_sender_name, reported_message_sent_at, reported_message_body
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
    nullif(trim(left(p_context, 300)), ''),
    v_message.id,
    case when v_message.id is not null then coalesce(v_message.sender_name, 'A former member') end,
    v_message.created_at,
    v_message.body
  )
  returning id into v_id;
  return v_id;
end;
$$;

revoke execute on function public.raise_concern(text, text, uuid, date, text, boolean, text, boolean, text, uuid) from public, anon;
grant execute on function public.raise_concern(text, text, uuid, date, text, boolean, text, boolean, text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Message access requests
-- ---------------------------------------------------------------------------

create table if not exists public.message_access_requests (
  id uuid primary key default gen_random_uuid(),
  ref_no bigint generated always as identity unique,
  created_at timestamptz not null default now(),
  concern_id uuid not null references public.concerns (id),
  requested_by uuid not null,
  requested_by_name text not null,
  requested_post text not null check (requested_post in ('child_safety_officer', 'complaints_manager')),
  subject_id uuid not null,
  subject_name text not null,
  subject_link text not null check (subject_link in ('about', 'raised_by', 'other')),
  from_date date not null,
  to_date date not null,
  reason text not null check (length(trim(reason)) between 10 and 1000),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  decided_by uuid,
  decided_by_name text,
  decided_at timestamptz,
  decision_note text check (length(trim(decision_note)) between 10 and 1000),
  access_expires_at timestamptz,
  constraint message_access_dates check (from_date <= to_date and to_date - from_date <= 90),
  constraint message_access_not_self check (subject_id <> requested_by),
  constraint message_access_decided check (
    (status = 'pending') = (decided_at is null)
    and (status = 'pending') = (decision_note is null)
    and (status = 'approved') = (access_expires_at is not null)
  )
);

create index if not exists message_access_requests_concern_idx
  on public.message_access_requests (concern_id);
create index if not exists message_access_requests_subject_idx
  on public.message_access_requests (subject_id);

create table if not exists public.message_access_views (
  id bigint generated always as identity primary key,
  request_id uuid not null references public.message_access_requests (id),
  viewed_by uuid not null,
  viewed_by_name text not null,
  viewed_at timestamptz not null default now(),
  -- Null when the list was loaded, the message when one was opened.
  message_id uuid,
  kind text not null check (kind in ('listed', 'opened')),
  constraint message_access_views_kind check ((kind = 'opened') = (message_id is not null))
);

create index if not exists message_access_views_request_idx
  on public.message_access_views (request_id, viewed_at);

-- Reached only through the functions below.
alter table public.message_access_requests enable row level security;
alter table public.message_access_views enable row level security;
revoke all on public.message_access_requests from public, anon, authenticated;
revoke all on public.message_access_views from public, anon, authenticated;
grant all on public.message_access_requests to service_role;
grant all on public.message_access_views to service_role;

-- The signed-in member's safeguarding post, when they can act in it now.
create or replace function public.my_safeguarding_post()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when not public.can_be_safeguarding_contact(auth.uid()) then null
    when s.child_safety_officer_id = auth.uid() then 'child_safety_officer'
    when s.complaints_manager_id = auth.uid() then 'complaints_manager'
  end
  from public.safeguarding_settings s
  where s.id and auth.uid() is not null;
$$;

revoke execute on function public.my_safeguarding_post() from public, anon, authenticated;

-- Whether an admin other than these people could decide the request. Admin
-- here means the admin role, not the committee.
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
      and p.id is distinct from (select c.about_member_id from public.concerns c where c.id = p_request.concern_id)
  );
$$;

revoke execute on function public.message_access_other_admin(public.message_access_requests) from public, anon, authenticated;

-- Whether the signed-in member may approve or refuse this request: never the
-- requester, the member whose messages it asks for, or the person the
-- concern is about; an admin, or the other safeguarding officer only when no
-- such admin exists.
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
    and auth.uid() is distinct from (select c.about_member_id from public.concerns c where c.id = p_request.concern_id)
    and (
      public.has_role('admin')
      or (public.my_safeguarding_post() is not null and not public.message_access_other_admin(p_request))
    );
$$;

revoke execute on function public.message_access_can_decide(public.message_access_requests) from public, anon, authenticated;

-- Whether the signed-in member may see this request and its log: the
-- requester, admins and the safeguarding officers, but never the member it's
-- about or the person the concern is about.
create or replace function public.message_access_can_see(p_request public.message_access_requests)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null
    and auth.uid() <> p_request.subject_id
    and auth.uid() is distinct from (select c.about_member_id from public.concerns c where c.id = p_request.concern_id)
    and (
      auth.uid() = p_request.requested_by
      or public.has_role('admin')
      or public.my_safeguarding_post() is not null
    );
$$;

revoke execute on function public.message_access_can_see(public.message_access_requests) from public, anon, authenticated;

-- Who a request can name for a concern: the person it's about and the person
-- who raised it (unless they asked not to be named). Anyone else is chosen
-- from concern_about_people() as "someone else involved".
create or replace function public.message_access_people(p_concern_id uuid)
returns table (link text, profile_id uuid, name text)
language sql
stable
security definer
set search_path = ''
as $$
  select x.link, p.id, public.display_name(p)
  from public.concerns c
  cross join lateral (values ('about', c.about_member_id), ('raised_by', case when not c.anonymous then c.raised_by end)) x (link, pid)
  join public.profiles p on p.id = x.pid
  where c.id = p_concern_id
    and public.my_safeguarding_post() is not null
    and public.can_handle_concern(c.id)
    and p.id <> auth.uid();
$$;

revoke execute on function public.message_access_people(uuid) from public, anon;
grant execute on function public.message_access_people(uuid) to authenticated;

-- Asks for access. Returns the new request's id.
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
  if p_link = 'about' and v_concern.about_member_id is distinct from p_subject_id then
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

revoke execute on function public.request_message_access(uuid, uuid, text, date, date, text) from public, anon;
grant execute on function public.request_message_access(uuid, uuid, text, date, date, text) to authenticated;

-- Approves (with a justification) or refuses (with reasons) a request.
create or replace function public.decide_message_access(
  p_request_id uuid,
  p_approve boolean,
  p_note text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.message_access_requests;
  v_me public.profiles;
begin
  select * into v_request from public.message_access_requests where id = p_request_id for update;
  if not found or not public.message_access_can_see(v_request) then
    raise exception 'Request not found';
  end if;
  if v_request.status <> 'pending' then
    raise exception 'This request has already been answered';
  end if;
  if not public.message_access_can_decide(v_request) then
    raise exception 'Someone else must answer this request';
  end if;
  if p_approve is null then
    raise exception 'Approve or refuse the request';
  end if;
  if length(trim(coalesce(p_note, ''))) < 10 then
    raise exception '%', case when p_approve
      then 'Record why you''re approving it, in at least 10 characters'
      else 'Record why you''re refusing it, in at least 10 characters' end;
  end if;
  if length(trim(p_note)) > 1000 then
    raise exception 'The note can be up to 1,000 characters';
  end if;

  select * into v_me from public.profiles where id = auth.uid();
  update public.message_access_requests
  set status = case when p_approve then 'approved' else 'rejected' end,
      decided_by = auth.uid(),
      decided_by_name = public.display_name(v_me),
      decided_at = now(),
      decision_note = trim(p_note),
      access_expires_at = case when p_approve then now() + interval '24 hours' end
  where id = p_request_id;
end;
$$;

revoke execute on function public.decide_message_access(uuid, boolean, text) from public, anon;
grant execute on function public.decide_message_access(uuid, boolean, text) to authenticated;

-- Requests the signed-in member can see, newest first.
create or replace function public.message_access_requests()
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
  views integer
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
    (select count(*)::int from public.message_access_views v where v.request_id = r.id and v.kind = 'opened')
  from public.message_access_requests r
  join public.concerns c on c.id = r.concern_id
  where public.message_access_can_see(r)
  order by r.status <> 'pending', r.created_at desc;
$$;

revoke execute on function public.message_access_requests() from public, anon;
grant execute on function public.message_access_requests() to authenticated;

-- The approved request the signed-in member made, while its 24 hours last.
create or replace function public.message_access_open_request(p_request_id uuid)
returns public.message_access_requests
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_request public.message_access_requests;
begin
  select * into v_request from public.message_access_requests r
  where r.id = p_request_id
    and r.requested_by = auth.uid()
    and r.status = 'approved'
    and r.access_expires_at > now();
  if not found or public.my_safeguarding_post() is null then
    raise exception 'This access isn''t open. It lasts 24 hours from approval';
  end if;
  return v_request;
end;
$$;

revoke execute on function public.message_access_open_request(uuid) from public, anon, authenticated;

-- The messages an open request covers: sent or received by the member
-- between the two dates in the club's time zone. Date, sender and who it went
-- to only; the text needs open_accessed_message. Logged.
create or replace function public.accessed_messages(p_request_id uuid)
returns table (
  message_id uuid,
  created_at timestamptz,
  sender_name text,
  sent_by_member boolean,
  audience public.message_audience,
  audience_role public.app_role,
  audience_label text,
  member_read_at timestamptz,
  member_archived_at timestamptz,
  text_removed boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.message_access_requests := public.message_access_open_request(p_request_id);
  v_tz text := coalesce((select s.timezone from public.club_settings s where s.id), 'Australia/Perth');
  v_me public.profiles;
begin
  select * into v_me from public.profiles where id = auth.uid();
  insert into public.message_access_views (request_id, viewed_by, viewed_by_name, kind)
  values (v_request.id, auth.uid(), public.display_name(v_me), 'listed');

  return query
  select m.id, m.created_at, coalesce(m.sender_name, 'Club'),
    m.sender_id is not distinct from v_request.subject_id,
    m.audience, m.audience_role, m.audience_label,
    r.read_at, r.archived_at, m.body_removed_at is not null
  from public.messages m
  left join public.message_recipients r on r.message_id = m.id and r.profile_id = v_request.subject_id
  where (m.sender_id = v_request.subject_id or r.profile_id is not null)
    and (m.created_at at time zone v_tz)::date between v_request.from_date and v_request.to_date
  order by m.created_at desc;
end;
$$;

revoke execute on function public.accessed_messages(uuid) from public, anon;
grant execute on function public.accessed_messages(uuid) to authenticated;

-- One message's text, under an open request. Logged.
create or replace function public.open_accessed_message(p_request_id uuid, p_message_id uuid)
returns table (message_id uuid, created_at timestamptz, sender_name text, body text, answer_options text[])
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_request public.message_access_requests := public.message_access_open_request(p_request_id);
  v_tz text := coalesce((select s.timezone from public.club_settings s where s.id), 'Australia/Perth');
  v_message public.messages;
  v_me public.profiles;
begin
  select m.* into v_message from public.messages m
  where m.id = p_message_id
    and (m.sender_id = v_request.subject_id or exists (
      select 1 from public.message_recipients r
      where r.message_id = m.id and r.profile_id = v_request.subject_id
    ))
    and (m.created_at at time zone v_tz)::date between v_request.from_date and v_request.to_date;
  if not found then
    raise exception 'That message isn''t covered by this request';
  end if;

  select * into v_me from public.profiles where id = auth.uid();
  insert into public.message_access_views (request_id, viewed_by, viewed_by_name, message_id, kind)
  values (v_request.id, auth.uid(), public.display_name(v_me), v_message.id, 'opened');

  return query select v_message.id, v_message.created_at, coalesce(v_message.sender_name, 'Club'),
    v_message.body, v_message.answer_options;
end;
$$;

revoke execute on function public.open_accessed_message(uuid, uuid) from public, anon;
grant execute on function public.open_accessed_message(uuid, uuid) to authenticated;

-- Every list and opening under a request, for anyone who can see the request.
create or replace function public.message_access_log(p_request_id uuid)
returns table (viewed_at timestamptz, viewed_by_name text, kind text, message_sent_at timestamptz, message_sender_name text)
language sql
stable
security definer
set search_path = ''
as $$
  select v.viewed_at, v.viewed_by_name, v.kind, m.created_at, m.sender_name
  from public.message_access_views v
  join public.message_access_requests r on r.id = v.request_id
  left join public.messages m on m.id = v.message_id
  where v.request_id = p_request_id and public.message_access_can_see(r)
  order by v.viewed_at desc, v.id desc;
$$;

revoke execute on function public.message_access_log(uuid) from public, anon;
grant execute on function public.message_access_log(uuid) to authenticated;

-- To-dos: requests waiting for the signed-in member's answer, their own
-- approved access still open, and (for admins) a warning when the club has
-- only one admin, who couldn't answer a request about themselves.
create or replace function public.message_access_todo()
returns table (to_decide integer, open_access integer, only_one_admin boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select count(*)::int from public.message_access_requests r
     where r.status = 'pending' and public.message_access_can_decide(r)),
    (select count(*)::int from public.message_access_requests r
     where r.requested_by = auth.uid() and r.status = 'approved' and r.access_expires_at > now()
       and public.my_safeguarding_post() is not null),
    public.has_role('admin') and (
      select count(*) from public.profiles p
      where p.status = 'approved' and p.stood_down_at is null
        and 'admin' = any (public.roles_of(p.role, p.extra_roles))
    ) < 2
  where auth.uid() is not null;
$$;

revoke execute on function public.message_access_todo() from public, anon;
grant execute on function public.message_access_todo() to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Legal hold
-- ---------------------------------------------------------------------------

-- As before, and also a member named in a message access request for a
-- concern that is still open.
create or replace function public.on_legal_hold(p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_profile_id is not null and (
    exists (select 1 from public.concerns c where c.about_member_id = p_profile_id)
    or exists (
      select 1 from public.message_access_requests r
      join public.concerns c on c.id = r.concern_id
      where r.subject_id = p_profile_id and c.status <> 'closed'
    )
  );
$$;

revoke execute on function public.on_legal_hold(uuid) from public, anon, authenticated;

commit;
