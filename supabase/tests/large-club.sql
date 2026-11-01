-- Manual test: run by hand (scripts/run-sql-tests.sh large-club concurrency, or
-- the "Scale tests" workflow), not on every push.
-- The rules at club size: a generated club of 200 sample members
-- (setup/large-club.sql) with brothers and sisters, guardians who also coach,
-- athletes in two teams and every kind of member. Signed in as each member in
-- turn (every one whose role or family makes them a special case, and one in
-- ten of the rest, to keep the run short), as the API role so row level
-- security applies, the rows each one reads are compared with what the rules
-- say they should read, worked out here independently from the rules as
-- docs/user-guide.md section 11 and the migrations' comments state them. Then the recipients of messages sent
-- through the app's own function, and the time the busiest lists and reports
-- take at this size. Prints one line per check.
\set ON_ERROR_STOP 0
\pset tuples_only on
\pset format unaligned
\ir setup/large-club.sql

-- Supabase lets the API role read these tables and relies on row level
-- security; the local stubs give it nothing.
grant select on public.profiles, public.guardianships, public.check_ins, public.injuries,
  public.messages, public.message_recipients to authenticated;

create or replace function pg_temp.ok(label text, actual boolean, expected boolean) returns text language sql as
$$ select case when actual is not distinct from expected then 'PASS ' else 'FAIL ' end || label || ' (got ' || coalesce(actual::text, 'null') || ')' $$;
-- A comparison of two sets of rows: passes when none differ, else names a few.
create or replace function pg_temp.same(label text, checked bigint, wrong bigint, examples text) returns text language sql as
$$ select case when wrong = 0 and checked > 0 then 'PASS ' else 'FAIL ' end || label
     || ' (' || checked || ' checked, ' || wrong || ' wrong' || coalesce(': ' || examples, '') || ')' $$;

-- ---------------------------------------------------------------------------
-- The club's shape: the awkward cases are really there.
-- ---------------------------------------------------------------------------
create temp view lc_members as
select p.* from public.profiles p where p.id::text like '00000000-0000-0000-0001-%';
select pg_temp.ok('200 members', (select count(*) from lc_members) = 200, true);
select pg_temp.ok('69 under 18s (one turned 18 today)',
  (select count(*) from lc_members where public.is_minor(date_of_birth, under_17)) = 69, true);
select pg_temp.ok('a child turning 18 tomorrow is still under 18',
  (select public.is_minor(date_of_birth, under_17) from lc_members where id = pg_temp.lc(28)), true);
select pg_temp.ok('guardians with three or more children',
  (select count(*) from (select guardian_id from public.guardianships group by 1 having count(*) >= 3) x) >= 5, true);
select pg_temp.ok('children with two guardians',
  (select count(*) from (select athlete_id from public.guardianships group by 1 having count(*) = 2) x) >= 20, true);
select pg_temp.ok('brothers and sisters in different squads',
  (select count(*) from (
     select g.guardian_id from public.guardianships g
     join public.team_members tm on tm.profile_id = g.athlete_id
     join public.teams t on t.id = tm.team_id and t.kind = 'squad'
     group by 1 having count(distinct t.id) > 1) x) >= 10, true);
select pg_temp.ok('athletes in two teams of a squad',
  (select count(*) from (
     select tm.profile_id from public.team_members tm join public.teams t on t.id = tm.team_id
     where t.kind = 'team' and tm.team_role = 'athlete' group by 1 having count(*) > 1) x) >= 10, true);
select pg_temp.ok('children with no consents, and with only the check-ins one',
  (select count(*) from lc_members m where public.is_minor(m.date_of_birth, m.under_17)
     and not exists (select 1 from public.child_consents c where c.athlete_id = m.id)) > 0
  and (select count(*) from lc_members m where exists (select 1 from public.child_consents c where c.athlete_id = m.id and c.kind = 'data')
     and not exists (select 1 from public.child_consents c where c.athlete_id = m.id and c.kind = 'health')) > 0, true);

-- ---------------------------------------------------------------------------
-- The rules, worked out independently of the app's functions.
-- ---------------------------------------------------------------------------
-- A locked child (20261101000000): an approved athlete under 18 with no
-- approved, verified parent or guardian linked. They read nothing.
create temp view lc_locked as
select p.id from public.profiles p
where p.status = 'approved' and 'athlete' = any (array[p.role] || p.extra_roles)
  and case when p.date_of_birth is not null then p.date_of_birth > current_date - interval '18 years'
    else coalesce(p.under_17, false) end
  and not exists (
    select 1 from public.guardianships g join public.profiles gp on gp.id = g.guardian_id
    where g.athlete_id = p.id and gp.status = 'approved' and gp.verified_at is not null
      and 'guardian' = any (array[gp.role] || gp.extra_roles));
create temp view lc_rule_people as
select p.id,
  p.status = 'approved' and p.role <> 'volunteer' and p.id not in (select id from lc_locked) as approved,
  p.stood_down_at is not null as stood_down,
  coalesce(trim(p.wwcc_number), '') <> '' and p.wwcc_expires_on >= current_date as current_check,
  case when p.date_of_birth is not null then p.date_of_birth > current_date - interval '18 years'
    else coalesce(p.under_17, false) end as minor,
  array[p.role] || p.extra_roles as roles,
  p.head_physio,
  p.wwcc_exempt_reason, p.wwcc_number
from public.profiles p;

-- A role the member can use now: approved and not stood down; coaches,
-- managers and physios with a current check; committee with a current
-- check, an exemption, or no check recorded before the club's committee
-- checks date (this club has none).
create or replace function pg_temp.holds(v uuid, r public.app_role) returns boolean language sql stable as
$$ select coalesce((
     select p.approved and not p.stood_down and r = any (p.roles) and case
       when r in ('coach', 'manager', 'physio') then p.current_check
       when r = 'committee' then coalesce(trim(p.wwcc_exempt_reason), '') <> ''
         or coalesce(trim(p.wwcc_number), '') = '' or p.current_check
       else true end
     from lc_rule_people p where p.id = v), false) $$;
-- A guardian's link counts while the child is under 18.
create or replace function pg_temp.guardian_of(v uuid, a uuid) returns boolean language sql stable as
$$ select exists (select 1 from public.guardianships g join lc_rule_people c on c.id = g.athlete_id
     where g.guardian_id = v and g.athlete_id = a and c.minor) $$;
-- Coaching the athlete now: a coach place in a current group (not archived,
-- selections not done) the athlete plays in, approved, not stood down and
-- with a current check.
create or replace function pg_temp.coaches(v uuid, a uuid) returns boolean language sql stable as
$$ select exists (
     select 1 from public.team_members c
     join public.team_members x on x.team_id = c.team_id and x.profile_id = a and x.team_role = 'athlete'
     join public.teams t on t.id = c.team_id and not t.archived and t.selections_completed_at is null
     where c.profile_id = v and c.team_role = 'coach')
   and exists (select 1 from lc_rule_people p where p.id = v and p.approved and not p.stood_down and p.current_check) $$;
-- A physio looks after every athlete as Head Physio, otherwise the athletes
-- in their current groups, whatever a squad's phase (20 October).
create or replace function pg_temp.physio_for(v uuid, a uuid) returns boolean language sql stable as
$$ select pg_temp.holds(v, 'physio') and exists (select 1 from public.profiles where id = a) and (
     (select head_physio from lc_rule_people where id = v)
     or exists (
       select 1 from public.team_members ph
       join public.team_members x on x.team_id = ph.team_id and x.profile_id = a and x.team_role = 'athlete'
       join public.teams t on t.id = ph.team_id and not t.archived
       where ph.profile_id = v and ph.team_role = 'physio')) $$;
-- An adult's records need no consent; a child's need their guardian's.
create or replace function pg_temp.consented(a uuid, k public.consent_kind) returns boolean language sql stable as
$$ select not (select minor from lc_rule_people where id = a)
     or exists (select 1 from public.child_consents where athlete_id = a and kind = k and withdrawn_at is null) $$;
create or replace function pg_temp.approved(v uuid) returns boolean language sql stable as
$$ select coalesce((select approved from lc_rule_people where id = v), false) $$;

-- Check-ins: the athlete, their guardians and their coaches, a child's only
-- with the check-ins consent. Not the committee, physios or admins.
create or replace function pg_temp.sees_check_ins(v uuid, a uuid) returns boolean language sql stable as
$$ select pg_temp.approved(v) and (a = v or pg_temp.guardian_of(v, a)
     or (pg_temp.coaches(v, a) and pg_temp.consented(a, 'data'))) $$;
-- Screened for working with children: a current check, or a declared
-- volunteer exemption that still applies (a parent of a child under 18 at
-- the club, or a volunteer who is under 18).
create or replace function pg_temp.screened(v uuid) returns boolean language sql stable as
$$ select coalesce((select current_check from lc_rule_people where id = v), false)
     or exists (
       select 1 from public.volunteer_exemptions e
       where e.profile_id = v and e.ended_at is null and e.declared_at is not null
         and case e.basis
           when 'parent_volunteer' then pg_temp.guardian_of(v, e.child_id)
           when 'under_18_volunteer' then (select minor from lc_rule_people where id = v)
           else false end) $$;
-- Injuries: the athlete, their guardians, their coaches and physios, the
-- committee and admins; a child's only with the health consent, except for
-- the child, their guardians and admins. Never managers. The committee see
-- a child's only when screened (22 October).
create or replace function pg_temp.sees_injuries(v uuid, a uuid) returns boolean language sql stable as
$$ select pg_temp.approved(v)
     and (a = v or pg_temp.guardian_of(v, a) or pg_temp.coaches(v, a) or pg_temp.physio_for(v, a)
       or (pg_temp.holds(v, 'committee')
         and (not (select minor from lc_rule_people where id = a) or pg_temp.screened(v)))
       or pg_temp.holds(v, 'admin'))
     and (a = v or pg_temp.guardian_of(v, a) or pg_temp.holds(v, 'admin') or pg_temp.consented(a, 'health')) $$;

-- ---------------------------------------------------------------------------
-- What each member reads, signed in as them. Who signs in: staff, everyone
-- in more than one role, guardians of three or more children (some with a
-- partner guardian), the children on the 18th birthday edge, guests, helpers and
-- members waiting for approval, and one in ten of everyone else. Check-ins
-- are read one per athlete (the rule is per athlete, and reading every row
-- as every member would take minutes).
-- ---------------------------------------------------------------------------
create temp table lc_viewers as
select p.id from lc_members p
where p.id <= pg_temp.lc(30) or p.id >= pg_temp.lc(188)
  or cardinality(p.extra_roles) > 0
  or (select count(*) from public.guardianships g where g.guardian_id = p.id) > 2
  or right(p.id::text, 3)::int % 10 = 0;
create temp table lc_check_in_rows as
select distinct on (athlete_id) id, athlete_id from public.check_ins order by athlete_id, day;
grant select on lc_check_in_rows to authenticated;
select pg_temp.ok('about 60 members sign in, every kind among them',
  (select count(*) from lc_viewers) between 40 and 80
  and (select count(distinct p.role) from lc_viewers v join public.profiles p on p.id = v.id) = 10, true);

create temp table lc_seen (viewer uuid, what text, subject uuid, rows int);
do $$
declare
  v uuid;
  got jsonb;
begin
  for v in select id from lc_viewers order by id loop
    perform set_config('request.jwt.claim.sub', v::text, false);
    execute 'set role authenticated';
    select jsonb_build_object(
      'profiles', (select coalesce(jsonb_agg(jsonb_build_array(id, 1)), '[]') from public.profiles),
      'guardianships', (select coalesce(jsonb_agg(jsonb_build_array(athlete_id, 1)), '[]') from public.guardianships),
      'check_ins', (select coalesce(jsonb_agg(jsonb_build_array(athlete_id, 1)), '[]')
                    from public.check_ins where id = any (array(select id from lc_check_in_rows))),
      'injuries', (select coalesce(jsonb_agg(jsonb_build_array(athlete_id, n)), '[]')
                   from (select athlete_id, count(*) n from public.injuries group by 1) x),
      'messages', (select coalesce(jsonb_agg(jsonb_build_array(id, 1)), '[]') from public.messages)
    ) into got;
    execute 'reset role';
    insert into lc_seen
    select v, k.key, (e->>0)::uuid, (e->>1)::int
    from jsonb_each(got) k, jsonb_array_elements(k.value) e;
  end loop;
  perform set_config('request.jwt.claim.sub', '', false);
end $$;

create temp view lc_names as
select id, coalesce(full_name, email) || ' (' || array_to_string(array[role] || extra_roles, '+') || ')' as name
from public.profiles;

-- Check-ins: every member against every athlete with check-ins.
with athletes as (select athlete_id, 1 as n from lc_check_in_rows),
expected as (
  select v.id as viewer, a.athlete_id as subject, a.n as rows
  from lc_viewers v cross join athletes a where pg_temp.sees_check_ins(v.id, a.athlete_id)
),
seen as (select viewer, subject, rows from lc_seen where what = 'check_ins'),
diff as (
  (select *, 'should read' as how from expected except select *, 'should read' from seen)
  union all
  (select *, 'should not read' from seen except select *, 'should not read' from expected)
)
select pg_temp.same('check-ins: each member reads exactly the athletes the rules allow',
  (select count(*) from lc_viewers) * (select count(*) from athletes),
  (select count(*) from diff),
  (select string_agg(vn.name || ' ' || d.how || ' ' || sn.name, '; ') from (select * from diff limit 5) d
     join lc_names vn on vn.id = d.viewer join lc_names sn on sn.id = d.subject));

-- Injuries: the same, against every athlete with an injury.
with athletes as (select athlete_id, count(*) n from public.injuries group by 1),
expected as (
  select v.id as viewer, a.athlete_id as subject, a.n as rows
  from lc_viewers v cross join athletes a where pg_temp.sees_injuries(v.id, a.athlete_id)
),
seen as (select viewer, subject, rows from lc_seen where what = 'injuries'),
diff as (
  (select *, 'should read' as how from expected except select *, 'should read' from seen)
  union all
  (select *, 'should not read' from seen except select *, 'should not read' from expected)
)
select pg_temp.same('injuries: each member reads exactly the athletes the rules allow',
  (select count(*) from lc_viewers) * (select count(*) from athletes),
  (select count(*) from diff),
  (select string_agg(vn.name || ' ' || d.how || ' ' || sn.name, '; ') from (select * from diff limit 5) d
     join lc_names vn on vn.id = d.viewer join lc_names sn on sn.id = d.subject));

-- Profiles: your own, and every profile for admins.
with expected as (
  select v.id as viewer, p.id as subject from lc_viewers v cross join public.profiles p
  where p.id = v.id or pg_temp.holds(v.id, 'admin')
),
seen as (select viewer, subject from lc_seen where what = 'profiles'),
diff as ((select * from expected except select * from seen) union all (select * from seen except select * from expected))
select pg_temp.same('profiles: each member reads only their own, admins everyone''s',
  (select count(*) from lc_viewers) * (select count(*) from public.profiles), (select count(*) from diff),
  (select string_agg(vn.name || ' / ' || sn.name, '; ') from (select * from diff limit 5) d
     join lc_names vn on vn.id = d.viewer join lc_names sn on sn.id = d.subject));

-- Guardian links: a member reads their own links (as guardian or child) and
-- admins read every link.
with expected as (
  select v.id as viewer, g.athlete_id as subject from lc_viewers v cross join public.guardianships g
  where g.guardian_id = v.id or g.athlete_id = v.id or pg_temp.holds(v.id, 'admin')
),
seen as (select viewer, subject from lc_seen where what = 'guardianships'),
diff as (
  (select viewer, subject, count(*) from expected group by 1, 2 except select viewer, subject, count(*) from seen group by 1, 2)
  union all
  (select viewer, subject, count(*) from seen group by 1, 2 except select viewer, subject, count(*) from expected group by 1, 2)
)
select pg_temp.same('guardian links: each member reads only their own, admins every link',
  (select count(*) from lc_viewers) * (select count(*) from public.guardianships), (select count(*) from diff),
  (select string_agg(vn.name || ' / ' || sn.name, '; ') from (select * from diff limit 5) d
     join lc_names vn on vn.id = d.viewer join lc_names sn on sn.id = d.subject));

-- Messages: nobody reads a message they didn't get or send, except admins;
-- guests, temporary helpers and members waiting for approval read none; and
-- everyone else who got one reads it.
select pg_temp.same('messages: nobody but admins reads a message they didn''t get or send',
  (select count(*) from lc_seen where what = 'messages'),
  (select count(*) from lc_seen s join public.messages m on m.id = s.subject
   where s.what = 'messages' and not pg_temp.holds(s.viewer, 'admin') and m.sender_id is distinct from s.viewer
     and not exists (select 1 from public.message_recipients r where r.message_id = m.id and r.profile_id = s.viewer)),
  null);
select pg_temp.same('messages: guests, temporary helpers and members waiting for approval read none',
  (select count(*) from lc_viewers v join lc_members p on p.id = v.id where p.role in ('guest', 'volunteer') or p.status <> 'approved'),
  (select count(*) from lc_seen s join lc_members p on p.id = s.viewer
   where s.what = 'messages' and (p.role in ('guest', 'volunteer') or p.status <> 'approved')),
  null);
select pg_temp.same('messages: every approved recipient reads their copy (physios and the stood-down aside)',
  (select count(*) from public.message_recipients r join lc_viewers v on v.id = r.profile_id),
  (select count(*) from public.message_recipients r join lc_viewers v on v.id = r.profile_id join lc_members p on p.id = r.profile_id
   where p.status = 'approved' and p.stood_down_at is null and not ('physio' = any (array[p.role] || p.extra_roles))
     and p.role not in ('guest', 'volunteer') and p.id not in (select id from lc_locked)
     and not exists (select 1 from lc_seen s where s.what = 'messages' and s.viewer = r.profile_id and s.subject = r.message_id)),
  null);
select pg_temp.ok('a stood-down coach reads none of the squad messages they got as a coach',
  exists (select 1 from public.message_recipients r join public.messages m on m.id = r.message_id
          where r.profile_id = pg_temp.lc(21) and m.audience = 'group')
  and not exists (select 1 from lc_seen s join public.messages m on m.id = s.subject
                  where s.what = 'messages' and s.viewer = pg_temp.lc(21) and m.audience = 'group'), true);

-- ---------------------------------------------------------------------------
-- Who a squad message reaches, sent through send_group_message: everyone in
-- the group but the sender (a guardian placed with their child is in it as a
-- guardian only), plus one copy for each approved guardian of the
-- group's children under 18, naming every one of their children in it.
-- ---------------------------------------------------------------------------
create temp view lc_group_messages as
select m.* from public.messages m where m.audience = 'group' and m.team_id::text like '00000000-0000-0000-0002-%';
select pg_temp.ok('four squad and team messages sent', (select count(*) from lc_group_messages) = 4, true);
with expected as (
  select m.id as message_id, tm.profile_id
  from lc_group_messages m
  join public.team_members tm on tm.team_id = m.team_id
  join public.profiles p on p.id = tm.profile_id and p.status = 'approved' and p.role not in ('guest', 'volunteer')
  where tm.profile_id <> m.sender_id
  union
  select m.id, g.guardian_id
  from lc_group_messages m
  join public.team_members tm on tm.team_id = m.team_id
  join lc_rule_people c on c.id = tm.profile_id and c.minor and 'athlete' = any (c.roles)
  join public.guardianships g on g.athlete_id = tm.profile_id
  join public.profiles gp on gp.id = g.guardian_id and gp.status = 'approved'
  where g.guardian_id <> m.sender_id
),
got as (select r.message_id, r.profile_id from public.message_recipients r join lc_group_messages m on m.id = r.message_id),
diff as ((select * from expected except select * from got) union all (select * from got except select * from expected))
select pg_temp.same('squad messages reach the group and each guardian of its children, once',
  (select count(*) from expected), (select count(*) from diff),
  (select string_agg(n.name, '; ') from (select * from diff limit 5) d join lc_names n on n.id = d.profile_id));
with copies as (
  select r.message_id, r.profile_id, r.for_children,
    array(
      select tm.profile_id from public.team_members tm
      join public.guardianships g on g.athlete_id = tm.profile_id and g.guardian_id = r.profile_id
      join lc_rule_people c on c.id = tm.profile_id and c.minor
      where tm.team_id = m.team_id order by 1) as children
  from public.message_recipients r join lc_group_messages m on m.id = r.message_id
  -- A guardian placed in the group with their child is in it only as a
  -- guardian, so gets the copy naming their children.
  where not exists (select 1 from public.team_members tm where tm.team_id = m.team_id and tm.profile_id = r.profile_id
                      and tm.team_role <> 'guardian')
)
select pg_temp.same('a guardian''s copy names every one of their children in the group, and only them',
  (select count(*) from copies),
  (select count(*) from copies where (select array_agg(x order by x) from unnest(for_children) x) is distinct from children),
  null);
select pg_temp.ok('a guardian with two children in one squad gets one copy naming both',
  exists (select 1 from public.message_recipients r join lc_group_messages m on m.id = r.message_id
          where cardinality(r.for_children) >= 2), true);
select pg_temp.ok('a guardian who is also in the group gets their own copy, not a child''s',
  (select count(*) from public.message_recipients r join lc_group_messages m on m.id = r.message_id
   where r.for_children is not null
     and exists (select 1 from public.team_members tm where tm.team_id = m.team_id and tm.profile_id = r.profile_id
                   and tm.team_role <> 'guardian')) = 0, true);
select pg_temp.ok('the club notice reaches all 180-odd approved members but guests and temporary helpers',
  (select count(*) from public.message_recipients r join public.messages m on m.id = r.message_id
     join lc_members p on p.id = r.profile_id
   where m.audience = 'club' and m.body = 'AGM is on the 30th')
  = (select count(*) from lc_members p where p.status = 'approved' and p.role not in ('guest', 'volunteer')
       and not public.is_view_only_member(p.role, p.extra_roles) and p.id <> pg_temp.lc(1)), true);

-- ---------------------------------------------------------------------------
-- The busiest lists and reports at this size: complete, and quick. Each is
-- timed as the member who opens it; anything over two seconds fails.
-- ---------------------------------------------------------------------------
create or replace function pg_temp.timed(label text, who uuid, q text, expected_rows bigint default null)
returns text language plpgsql as
$$ declare started timestamptz; ms int; got bigint; begin
     perform set_config('request.jwt.claim.sub', who::text, false);
     started := clock_timestamp();
     execute 'select count(*) from (' || q || ') x' into got;
     ms := extract(epoch from clock_timestamp() - started) * 1000;
     perform set_config('request.jwt.claim.sub', '', false);
     return case when ms <= 2000 and (expected_rows is null or got = expected_rows) and got > 0 then 'PASS ' else 'FAIL ' end
       || label || ' (' || got || ' rows' || coalesce(', expected ' || expected_rows, '') || ', ' || ms || ' ms)';
   exception when others then return 'FAIL ' || label || ' (' || sqlerrm || ')'; end $$;

select pg_temp.timed('admin: safety to-dos', pg_temp.lc(1), 'select * from public.admin_safety_todos()');
select pg_temp.timed('admin: every child''s consents', pg_temp.lc(1), 'select * from public.admin_child_consents()',
  (select count(*) from lc_members where public.is_minor(date_of_birth, under_17)) + 1);
select pg_temp.timed('committee: check-in overview', pg_temp.lc(3), format('select * from public.check_in_overview(%L)', current_date));
-- The injuries list matches what the Head Physio can read of the table.
select pg_temp.timed('Head Physio: injuries list, every athlete they may see', pg_temp.lc(26), 'select * from public.visible_injuries(true, null)',
  (select count(*) from public.injuries where pg_temp.sees_injuries(pg_temp.lc(26), athlete_id)));
select pg_temp.timed('committee: injuries list matches what they may see', pg_temp.lc(3), 'select * from public.visible_injuries(true, null)',
  (select count(*) from public.injuries where pg_temp.sees_injuries(pg_temp.lc(3), athlete_id)));
select pg_temp.timed('head coach: Open Squad roster', pg_temp.lc(8), format('select * from public.team_roster(%L)', pg_temp.lc_team(1)),
  (select count(*) from public.team_members where team_id = pg_temp.lc_team(1)));
select pg_temp.timed('head coach: Open Squad check-in board', pg_temp.lc(8), format('select * from public.check_in_board(%L, %L)', pg_temp.lc_team(1), current_date));
select pg_temp.timed('head coach: sent messages and receipts', pg_temp.lc(8), 'select * from public.my_sent_messages()');
select pg_temp.timed('guardian of four: their children', pg_temp.lc(7), 'select * from public.my_athletes()',
  (select count(*) from public.guardianships g join lc_rule_people c on c.id = g.athlete_id and c.minor where g.guardian_id = pg_temp.lc(7)));
select pg_temp.timed('guardian of four: their children''s consents', pg_temp.lc(7), 'select * from public.my_child_consents()');

-- The tables the app reads directly, through row level security, as the head
-- coach: every row they may see, in one read, and each rule checked once per
-- read rather than once per row (20261020010000_faster_access_rules.sql).
grant select on public.attendance_sessions, public.attendance_marks to authenticated;
create or replace function pg_temp.timed_read(label text, who uuid, tbl text, expected_rows bigint)
returns text language plpgsql as
$$ declare started timestamptz; ms int; got bigint; begin
     perform set_config('request.jwt.claim.sub', who::text, false);
     execute 'set local role authenticated';
     started := clock_timestamp();
     execute format('select count(*) from public.%I', tbl) into got;
     ms := extract(epoch from clock_timestamp() - started) * 1000;
     execute 'reset role';
     perform set_config('request.jwt.claim.sub', '', false);
     return case when ms <= 500 and got = expected_rows and got > 0 then 'PASS ' else 'FAIL ' end
       || label || ' (' || got || ' rows, expected ' || expected_rows || ', ' || ms || ' ms)';
   exception when others then execute 'reset role'; return 'FAIL ' || label || ' (' || sqlerrm || ')'; end $$;
create or replace function pg_temp.as_member(who uuid, q text) returns bigint language plpgsql as
$$ declare got bigint; begin
     perform set_config('request.jwt.claim.sub', who::text, false);
     execute q into got;
     perform set_config('request.jwt.claim.sub', '', false);
     return got; end $$;

select pg_temp.timed_read('head coach: every attendance mark they may see', pg_temp.lc(8), 'attendance_marks',
  pg_temp.as_member(pg_temp.lc(8), 'select count(*) from public.attendance_marks where public.can_see_attendance_session(session_id)'));
select pg_temp.timed_read('head coach: every attendance session they may see', pg_temp.lc(8), 'attendance_sessions',
  pg_temp.as_member(pg_temp.lc(8), 'select count(*) from public.attendance_sessions where public.can_see_attendance_session(id)'));
select pg_temp.timed_read('head coach: every check-in they may see', pg_temp.lc(8), 'check_ins',
  pg_temp.as_member(pg_temp.lc(8), 'select count(*) from public.check_ins where public.can_view_check_ins(athlete_id)'));
select pg_temp.timed_read('committee: every attendance mark', pg_temp.lc(3), 'attendance_marks',
  (select count(*) from public.attendance_marks));
