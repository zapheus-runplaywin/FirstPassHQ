-- Reporting a message keeps the message, and anyone can be named as who a
-- concern is about.
--
-- 1. Until now a concern raised with "Report this message" kept only a line
--    such as "Message from Sixteen Athlete, Thursday 19 November, 9:49 pm".
--    The people handling it couldn't see what was said, and the message
--    itself is removed under the club's message keep period. A concern now
--    keeps its own copy of the reported message: its text, who sent it and
--    when. The copy is taken by the database from the message itself, never
--    from what the app sends, and only from a message the person reporting
--    it can see. Concerns are never removed, so the copy stays with the
--    concern whatever happens to the message. Hiding the reporter's name works
--    as before.
--
-- 2. "Who it's about" on a concern listed only coaches, managers, physios,
--    committee members, admins and temporary helpers, so an athlete, a parent
--    or a guest couldn't be found. The Child Safety Officer, the Complaints
--    Manager and admins can now search every approved member. Raise a concern,
--    which guests and people waiting for approval can open, still offers only
--    the adults with club roles, so it never lists the club's children.
--
-- Additive: new nullable columns and functions. raise_concern gains a last
-- parameter with a default, so it is dropped and created again in this
-- transaction (no overload is left behind); concern_register gains three
-- columns at the end, so it is too. No rows are changed.

begin;

alter table public.concerns
  add column if not exists reported_message_id uuid references public.messages (id) on delete set null,
  add column if not exists reported_message_sender_name text,
  add column if not exists reported_message_sent_at timestamptz,
  add column if not exists reported_message_body text check (length(reported_message_body) <= 4000);

drop function if exists public.raise_concern(text, text, uuid, date, text, boolean, text, boolean, text);

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
  -- reading messages (its sender unless stood down, a recipient, or an admin).
  if p_message_id is not null then
    select * into v_message from public.messages m
    where m.id = p_message_id
      and ((m.sender_id = auth.uid() and not public.is_stood_down())
        or public.is_admin()
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
  reported_message_body text
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
    c.reported_message_sender_name, c.reported_message_sent_at, c.reported_message_body
  from public.concerns c
  where public.can_handle_concern(c.id)
  order by c.status = 'closed', c.created_at desc;
$$;

revoke execute on function public.concern_register() from public, anon;
grant execute on function public.concern_register() to authenticated;

-- Everyone approved, for those who handle concerns to name who one is about:
-- athletes, parents, guests and adults with club roles. Anyone else gets
-- nobody.
create or replace function public.concern_about_people()
returns table (id uuid, name text)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, public.display_name(p)
  from public.profiles p
  where (public.is_admin() or public.is_safeguarding_officer())
    and p.status = 'approved'
  order by 2;
$$;

revoke execute on function public.concern_about_people() from public, anon;
grant execute on function public.concern_about_people() to authenticated;

commit;
