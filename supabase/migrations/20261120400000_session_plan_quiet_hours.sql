-- Session plan notifications keep the quiet hours (Matt, 2026-11-20).
--
-- Sharing a session plan sends a phone notification to everyone it is newly
-- shared with: coaches, athletes of any age, and parents and guardians.
-- Until now it went straight away, whatever the time, while to-do
-- notifications wait out the quiet hours (8 pm to 7 am club time). A coach
-- planning late at night could wake a child's phone.
--
-- Now a plan shared in the quiet hours is held and goes out at 7 am, in one
-- notification per person. Someone the plan is no longer shared with by then
-- (the coach changed it, or the member was stood down or left) is not told.
-- Outside the quiet hours nothing changes: the notification goes at once.
--
-- The quiet hours are worked out in one place now, push_quiet_hours, which
-- to-do notifications use too (send_todo_pushes is otherwise unchanged from
-- 20261112050000_todo_push_notifications.sql). Session plan notifications
-- also carry the club's code, as to-do notifications do, so a tap opens the
-- right club.
--
-- Additive only: one new column with a default (people already told keep
-- "not held"), one new function and three replaced ones, and a second
-- scheduled job. No existing row is changed or removed by this migration.

begin;

-- True while a notice is waiting for the quiet hours to end.
alter table public.session_plan_notices
  add column if not exists push_held boolean not null default false;

-- Whether it is quiet hours in the club's time zone: 8 pm to 7 am. Nothing is
-- pushed to members' phones then.
create or replace function public.push_quiet_hours(p_now timestamptz default now())
returns boolean
language sql
stable
set search_path = ''
as $$
  select extract(hour from (p_now at time zone coalesce(
    (select s.timezone from public.club_settings s where s.id), 'Australia/Perth'
  )))::int not between 7 and 19;
$$;
revoke execute on function public.push_quiet_hours(timestamptz) from public, anon, authenticated;

-- Sends the session plan notifications that are waiting, unless it is quiet
-- hours. Someone with several plans waiting gets one notification. Returns
-- how many people were sent one. Runs when a plan is shared and from the
-- scheduled job below.
create or replace function public.send_held_session_plan_pushes(p_now timestamptz default now())
returns integer
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_messages jsonb;
  v_people int;
  v_batch jsonb;
  i int := 0;
begin
  if public.push_quiet_hours(p_now) then
    return 0;
  end if;

  -- A plan that is no longer shared with someone isn't announced to them.
  -- Their notice is forgotten, so sharing it with them again later tells them.
  delete from public.session_plan_notices n
  where n.push_held
    and n.profile_id not in (select a from public.session_plan_audience(n.plan_id) as a);

  with due as (
    update public.session_plan_notices n
    set push_held = false, notified_at = p_now
    where n.push_held
    returning n.plan_id, n.profile_id
  ),
  per_person as (
    select d.profile_id,
      count(*)::int as plans,
      (array_agg(p.id order by p.session_on, p.title, p.id))[1] as plan_id,
      -- The lock screen shows only who shared it, the session's name and group.
      (array_agg(
        p.author_name || ' shared ' || p.title || ' (' || p.team_name || ', '
          || to_char(p.session_on, 'FMDy FMDD Mon') || ').'
        order by p.session_on, p.title, p.id
      ))[1] as one_body,
      string_agg(p.title, ' · ' order by p.session_on, p.title, p.id) as titles
    from due d
    join public.session_plans p on p.id = d.plan_id
    group by d.profile_id
  )
  select jsonb_agg(jsonb_build_object(
      'to', t.token,
      'title', case when pp.plans = 1 then 'New session plan'
        else pp.plans || ' new session plans' end,
      'body', case when pp.plans = 1 then pp.one_body else left(pp.titles, 300) end,
      'data', case when pp.plans = 1
        then jsonb_build_object('planId', pp.plan_id, 'club', t.club_code)
        else jsonb_build_object('href', '/session-plans', 'club', t.club_code) end,
      'sound', 'default'
    )),
    count(distinct pp.profile_id)::int
  into v_messages, v_people
  from per_person pp
  join public.push_tokens t on t.profile_id = pp.profile_id;

  -- Expo takes up to 100 messages per request. Sent once this commits.
  while i < coalesce(jsonb_array_length(v_messages), 0) loop
    select jsonb_agg(m) into v_batch
    from (
      select m from jsonb_array_elements(v_messages) with ordinality as e(m, n)
      where n > i and n <= i + 100
    ) batch;
    perform net.http_post(
      url := 'https://exp.host/--/api/v2/push/send',
      body := v_batch,
      headers := '{"Content-Type": "application/json", "Accept": "application/json"}'::jsonb
    );
    i := i + 100;
  end loop;

  return coalesce(v_people, 0);
end;
$$;
revoke execute on function public.send_held_session_plan_pushes(timestamptz) from public, anon, authenticated;

-- Notes each person a plan has just been shared with for the first time, and
-- sends their notification: at once, or at 7 am when it is quiet hours.
-- Changes to the plan, and people already noted, send nothing. Returns how
-- many people it was newly shared with.
create or replace function public.notify_session_plan_shared(p_plan_id uuid)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_new int;
begin
  if not exists (select 1 from public.session_plans where id = p_plan_id) then
    return 0;
  end if;

  with added as (
    insert into public.session_plan_notices (plan_id, profile_id, push_held)
    select p_plan_id, a, true from public.session_plan_audience(p_plan_id) as a
    on conflict do nothing
    returning profile_id
  )
  select count(*)::int into v_new from added;

  if v_new > 0 then
    perform public.send_held_session_plan_pushes();
  end if;
  return v_new;
end;
$$;
revoke execute on function public.notify_session_plan_shared(uuid) from public, anon, authenticated;

-- To-do notifications read the quiet hours from the same place.
create or replace function public.send_todo_pushes(p_now timestamptz default now())
returns integer
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_member record;
  v_count int;
  v_title text;
  v_body text;
  v_href text;
  v_list jsonb;
  v_text_list text;
  v_messages jsonb := '[]'::jsonb;
  v_sent int := 0;
  v_batch jsonb;
  i int;
begin
  -- Quiet hours. Anything still on the list goes out at 7 am.
  if public.push_quiet_hours(p_now) then
    return 0;
  end if;

  for v_member in
    select p.id, s.baseline_at
    from public.profiles p
    left join public.push_settings s on s.profile_id = p.id
    where p.status = 'approved'
      and coalesce(s.todos, true)
      and exists (select 1 from public.push_tokens t where t.profile_id = p.id)
  loop
    begin
      select coalesce(jsonb_agg(to_jsonb(m)), '[]'::jsonb) into v_list
      from public.member_todos(v_member.id, p_now) m;

      if v_member.baseline_at is null then
        -- First look at this member's list: note what's there, send nothing.
        insert into public.push_todo_log (profile_id, todo_key, sent_at)
          select v_member.id, n.todo_key, p_now
          from jsonb_to_recordset(v_list) as n (todo_key text)
          on conflict (profile_id, todo_key) do nothing;
        insert into public.push_settings (profile_id, todos, baseline_at, updated_at)
          values (v_member.id, true, p_now, p_now)
          on conflict (profile_id) do update set baseline_at = p_now;
        continue;
      end if;

      select count(*)::int, min(n.title), min(n.detail), min(n.href),
        string_agg(n.title, ' · ' order by n.title)
      into v_count, v_title, v_body, v_href, v_text_list
      from jsonb_to_recordset(v_list) as n (todo_key text, title text, detail text, href text)
      where not exists (
        select 1 from public.push_todo_log l
        where l.profile_id = v_member.id and l.todo_key = n.todo_key
      );

      if v_count > 0 then
        if v_count > 1 then
          v_title := v_count || ' new things to do';
          v_body := left(v_text_list, 300);
          v_href := '/';
        end if;

        select v_messages || coalesce(jsonb_agg(jsonb_build_object(
          'to', t.token,
          'title', v_title,
          'body', v_body,
          'data', jsonb_build_object('kind', 'todo', 'href', v_href, 'club', t.club_code),
          'sound', 'default',
          'channelId', 'todos'
        )), '[]'::jsonb)
        into v_messages
        from public.push_tokens t
        where t.profile_id = v_member.id;

        insert into public.push_todo_log (profile_id, todo_key, sent_at)
          select v_member.id, n.todo_key, p_now
          from jsonb_to_recordset(v_list) as n (todo_key text)
          on conflict (profile_id, todo_key) do nothing;
        v_sent := v_sent + 1;
      end if;
    exception when others then
      -- One member's list failing mustn't stop everyone else's.
      raise warning 'To-do push for % failed: %', v_member.id, sqlerrm;
    end;
  end loop;

  -- Expo takes up to 100 messages per request. Sent once this commits.
  i := 0;
  while i < jsonb_array_length(v_messages) loop
    select jsonb_agg(m) into v_batch
    from (
      select m from jsonb_array_elements(v_messages) with ordinality as e(m, n)
      where n > i and n <= i + 100
    ) batch;
    perform net.http_post(
      url := 'https://exp.host/--/api/v2/push/send',
      body := v_batch,
      headers := '{"Content-Type": "application/json", "Accept": "application/json"}'::jsonb
    );
    i := i + 100;
  end loop;

  -- Keys from long ago can't come back (they carry dates or ids), so the log
  -- only needs the last few months.
  delete from public.push_todo_log where sent_at < p_now - interval '120 days';

  return v_sent;
end;
$$;

revoke execute on function public.send_todo_pushes(timestamptz) from public, anon, authenticated;

-- Every 5 minutes, so plans held overnight go out at 7 am. Scheduling again
-- under the same name replaces the job, so this can run twice safely.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule(
      'send-held-session-plan-pushes', '*/5 * * * *',
      'select public.send_held_session_plan_pushes()'
    );
  else
    raise notice 'pg_cron is not available here, so held session plan pushes are not scheduled';
  end if;
end;
$$;

commit;
