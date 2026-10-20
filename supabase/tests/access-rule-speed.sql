-- Faster access rules (migration 20261020010000): check-ins, attendance
-- registers and attendance marks are now checked against sets worked out once
-- per query. For every sample member, before and after consent is given and
-- after a coach is stood down, the rows each one reads under row level
-- security must be exactly the rows the per-row rules (can_view_check_ins and
-- can_see_attendance_session, which still exist) allow. Prints one line per
-- check.
\set ON_ERROR_STOP 0
\pset tuples_only on
\pset format unaligned

grant select on public.check_ins, public.attendance_sessions, public.attendance_marks to authenticated;

-- Registers of every kind: a squad and a team by their coach, one by the
-- lapsed coach, one by the manager and a whole-club one by the committee.
insert into public.attendance_sessions (id, club_wide, team_id, team_name, name, taken_by, taken_by_name) values
  ('00000000-0000-0000-0000-0000000005a1', false, '00000000-0000-0000-0000-0000000000a1', 'Sample Squad', 'Tuesday', '00000000-0000-0000-0000-000000000011', 'Casey Coach'),
  ('00000000-0000-0000-0000-0000000005a2', false, '00000000-0000-0000-0000-0000000000a2', 'Sample Team', 'Thursday', '00000000-0000-0000-0000-000000000011', 'Casey Coach'),
  ('00000000-0000-0000-0000-0000000005a3', false, '00000000-0000-0000-0000-0000000000a1', 'Sample Squad', 'Lapsed', '00000000-0000-0000-0000-000000000012', 'Drew Lapsed'),
  ('00000000-0000-0000-0000-0000000005a4', false, '00000000-0000-0000-0000-0000000000a1', 'Sample Squad', 'Manager', '00000000-0000-0000-0000-000000000013', 'Emery Manager'),
  ('00000000-0000-0000-0000-0000000005a5', true, null, 'Whole club', 'Club day', '00000000-0000-0000-0000-000000000022', 'Harper Committee');
insert into public.attendance_marks (session_id, profile_id, present, marked_by)
select s, a, true, '00000000-0000-0000-0000-000000000011'
from unnest(array['00000000-0000-0000-0000-0000000005a1', '00000000-0000-0000-0000-0000000005a2',
  '00000000-0000-0000-0000-0000000005a3', '00000000-0000-0000-0000-0000000005a4',
  '00000000-0000-0000-0000-0000000005a5']::uuid[]) s,
  unnest(array['00000000-0000-0000-0000-000000000031', '00000000-0000-0000-0000-000000000032']::uuid[]) a;
insert into public.check_ins (athlete_id, day, sleep, soreness, stress, mood)
values ('00000000-0000-0000-0000-000000000032', current_date, 3, 3, 3, 3),
       ('00000000-0000-0000-0000-000000000031', current_date - 1, 3, 3, 3, 3);

-- For every member: rows read under row level security, minus or plus the
-- rows the per-row rules allow. Passes when none differ.
create or replace function pg_temp.compare(label text) returns setof text language plpgsql as $$
declare
  w uuid;
  seen text[];
  allowed text[];
  wrong int;
  t text;
  rows_sql text;
  rule_sql text;
begin
  foreach t in array array['check_ins', 'attendance_sessions', 'attendance_marks'] loop
    rows_sql := case t
      when 'check_ins' then 'select coalesce(array_agg(id::text order by id), ''{}'') from public.check_ins'
      when 'attendance_sessions' then 'select coalesce(array_agg(id::text order by id), ''{}'') from public.attendance_sessions'
      else 'select coalesce(array_agg(session_id::text || profile_id::text order by session_id, profile_id), ''{}'') from public.attendance_marks'
    end;
    rule_sql := rows_sql || case t
      when 'check_ins' then ' where public.can_view_check_ins(athlete_id)'
      when 'attendance_sessions' then ' where public.can_see_attendance_session(id)'
      else ' where public.can_see_attendance_session(session_id)'
    end;
    wrong := 0;
    for w in select id from public.profiles order by id loop
      perform set_config('request.jwt.claim.sub', w::text, false);
      execute 'set local role authenticated';
      execute rows_sql into seen;
      execute 'reset role';
      execute rule_sql into allowed;
      if seen is distinct from allowed then wrong := wrong + 1; end if;
    end loop;
    return next case when wrong = 0 then 'PASS ' else 'FAIL ' end || label || ': ' || t
      || ' match the per-row rule for every member (' || wrong || ' differ)';
  end loop;
end $$;

-- The rows are really there to see, and some members see none.
select case when (select count(*) from public.attendance_marks) >= 10 and (select count(*) from public.check_ins) >= 3
  then 'PASS ' else 'FAIL ' end || 'sample registers, marks and check-ins are there';

select pg_temp.compare('without consent');

insert into public.child_consents (athlete_id, kind, given_by, given_by_name, policy_version)
values ('00000000-0000-0000-0000-000000000031', 'data', '00000000-0000-0000-0000-000000000041', 'Logan Parent', '1');
select pg_temp.compare('with consent');

update public.profiles set stood_down_at = now() where id = '00000000-0000-0000-0000-000000000011';
select pg_temp.compare('with the coach stood down');
