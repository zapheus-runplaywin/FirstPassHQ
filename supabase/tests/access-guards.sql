-- Schema-wide access guards, so a new table, function, policy or bucket that
-- forgets the club's security rules fails here without anyone writing a test
-- for it: every table in public has row level security; every SECURITY
-- DEFINER function pins its search_path; signed-out visitors (anon) run no
-- SECURITY DEFINER function outside a short allow-list, and read or write no
-- row of any table; the clean-up jobs run only as the service role; no policy
-- is written for signed-out visitors; and the app's storage buckets are
-- private. Run on a fresh database with the migrations and seed-members.sql
-- loaded. Prints one line per check.
\set ON_ERROR_STOP 0
\pset tuples_only on
\pset format unaligned

-- Table privileges come from the migrations themselves, as on a Supabase
-- project created after it stopped granting new tables automatically (30
-- October 2026): 20261021000000_explicit_table_grants and each later table's
-- own grants. The local stubs give anon and authenticated nothing else.
-- Supabase's storage API reads storage.objects as the signed-in role.
grant select, insert, update, delete on storage.objects to anon, authenticated;

create or replace function pg_temp.as_member(n text) returns void language sql as
$$ select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000' || n, false) $$;
create or replace function pg_temp.ok(label text, actual boolean, expected boolean) returns text language sql as
$$ select case when actual is not distinct from expected then 'PASS ' else 'FAIL ' end || label || ' (got ' || coalesce(actual::text, 'null') || ')' $$;
create or replace function pg_temp.fails(label text, statement text) returns text language plpgsql as
$$ begin execute statement; return 'FAIL ' || label || ' (no error)';
   exception when others then return 'PASS ' || label || ' (' || sqlerrm || ')'; end $$;
create or replace function pg_temp.works(label text, statement text) returns text language plpgsql as
$$ begin execute statement; return 'PASS ' || label;
   exception when others then return 'FAIL ' || label || ' (' || sqlerrm || ')'; end $$;
-- Rows a query returns, and rows a write changed, for the role in use now.
create or replace function pg_temp.n(q text) returns bigint language plpgsql as
$$ declare r bigint; begin execute 'select count(*) from (' || q || ') x' into r; return r; end $$;
create or replace function pg_temp.changed(statement text) returns bigint language plpgsql as
$$ declare r bigint; begin execute statement; get diagnostics r = row_count; return r; end $$;
-- A refusal by privileges or row level security (SQLSTATE 42501), not some
-- other error that would hide a missing rule.
create or replace function pg_temp.refused(label text, statement text) returns text language plpgsql as
$$ begin execute statement; return 'FAIL ' || label || ' (no error)';
   exception when insufficient_privilege then return 'PASS ' || label || ' (' || sqlerrm || ')';
   when others then return 'FAIL ' || label || ' (wrong error: ' || sqlerrm || ')'; end $$;

create temp view public_tables as
select c.oid, c.relname as t, c.relrowsecurity as rls
from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p');
create temp view definer_functions as
select p.oid, p.oid::regprocedure::text as sig, p.proname, p.prorettype = 'trigger'::regtype as is_trigger, p.proconfig
from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prosecdef;
grant select on public_tables, definer_functions to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 1. Row level security on every table in public, one line per table.
-- ---------------------------------------------------------------------------
select pg_temp.ok('public tables found', (select count(*) > 50 from public_tables), true);
select pg_temp.ok(t || ' has row level security', rls, true) from public_tables order by t;

-- Views skip row level security unless they run as the caller.
select 'FAIL view ' || c.relname || ' runs as its owner; add security_invoker = true'
from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('v', 'm')
  and (c.relkind = 'm' or not coalesce(c.reloptions @> array['security_invoker=true'], false));
select pg_temp.ok('no view in public runs as its owner',
  (select count(*) = 0 from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('v', 'm')
     and (c.relkind = 'm' or not coalesce(c.reloptions @> array['security_invoker=true'], false))), true);

-- ---------------------------------------------------------------------------
-- 2. Every SECURITY DEFINER function sets its search_path, so nobody can
-- shadow a table or function it uses.
-- ---------------------------------------------------------------------------
select pg_temp.ok('SECURITY DEFINER functions found', (select count(*) > 100 from definer_functions), true);
select 'FAIL ' || sig || ' is SECURITY DEFINER without set search_path'
from definer_functions where not coalesce(exists (select 1 from unnest(proconfig) c where c like 'search_path=%'), false) order by sig;
select pg_temp.ok('every SECURITY DEFINER function sets search_path',
  (select count(*) = 0 from definer_functions where not coalesce(exists (select 1 from unnest(proconfig) c where c like 'search_path=%'), false)), true);

-- ---------------------------------------------------------------------------
-- 3. Signed-out visitors (anon) run no SECURITY DEFINER function except the
-- ones listed here. Joining starts with signing up, so even the join flow
-- runs as authenticated; the only exceptions are trigger functions, which
-- Postgres refuses to run except from their trigger. Add a function here only
-- with the reason a signed-out visitor needs it.
-- ---------------------------------------------------------------------------
create temp table anon_allowed (sig text, reason text);
insert into anon_allowed values
  ('handle_new_user()', 'trigger on auth.users that creates the profile at sign-up; cannot be called directly'),
  ('notify_admins_of_join_request()', 'trigger on profiles that tells admins about a join request; cannot be called directly'),
  ('check_coach_athlete_groups()', 'trigger on team_members that checks coach and athlete places; cannot be called directly'),
  ('broadcast_game_event()', 'trigger on game_events that sends live stats; cannot be called directly');
grant select on anon_allowed to anon;
select 'FAIL anon can run SECURITY DEFINER ' || sig || '; revoke execute from public, anon or add it to anon_allowed with a reason'
from definer_functions where has_function_privilege('anon', oid, 'execute') and sig not in (select sig from anon_allowed) order by sig;
select pg_temp.ok('anon runs no SECURITY DEFINER function outside the allow-list',
  (select count(*) = 0 from definer_functions where has_function_privilege('anon', oid, 'execute') and sig not in (select sig from anon_allowed)), true);
select pg_temp.ok('allow-listed ' || a.sig || ' still exists as a SECURITY DEFINER function', exists (select 1 from definer_functions d where d.sig = a.sig), true)
from anon_allowed a order by a.sig;
select pg_temp.ok('allow-listed ' || a.sig || ' is a trigger function', (select is_trigger from definer_functions d where d.sig = a.sig), true)
from anon_allowed a where a.reason like 'trigger%' order by a.sig;
set role anon;
select pg_temp.fails('anon cannot call trigger function ' || sig || ' directly', 'select public.' || sig) from anon_allowed order by sig;
reset role;

-- The join flow and the club's public details need a sign-in. Checked by
-- name, so every version of each function counts.
select pg_temp.ok('anon cannot ' || what || ' (' || f || ')',
  exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = f)
  and not exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = f
                  and has_function_privilege('anon', p.oid, 'execute')), true)
from (values
  ('ask to join', 'submit_join_request'),
  ('save a member', 'admin_save_member'),
  ('read a team roster', 'team_roster'),
  ('check who is approved', 'is_approved'),
  ('check who is an admin', 'is_admin'),
  ('log a record view', 'log_record_view'),
  ('read the record access history', 'record_access_history'),
  ('give a child consent', 'set_child_consent'),
  ('read the safeguarding contacts', 'safeguarding_contacts')
) as v(what, f) order by what;

-- ---------------------------------------------------------------------------
-- 4. Clean-up jobs run only as the service role (the scheduled functions),
-- never as a member or a signed-out visitor.
-- ---------------------------------------------------------------------------
create temp table service_only (f text);
insert into service_only values
  ('public.purge_expired_injuries()'), ('public.expired_injury_documents()'),
  ('public.purge_expired_records()'), ('public.expired_certificate_documents()'),
  ('public.cleared_injury_documents()'), ('public.mark_removed_injury_documents()'),
  ('public.expired_session_plan_files()'), ('public.purge_expired_surveys()');
select pg_temp.ok(f || ': service role can run it', has_function_privilege('service_role', f, 'execute'), true) from service_only order by f;
select pg_temp.ok(f || ': members cannot run it', has_function_privilege('authenticated', f, 'execute'), false) from service_only order by f;
select pg_temp.ok(f || ': anon cannot run it', has_function_privilege('anon', f, 'execute'), false) from service_only order by f;
-- Any function granted to the service role, and any purge or clean-up
-- function added later, is for the service role only.
select 'FAIL ' || p.oid::regprocedure || ' is for the service role but authenticated or anon can run it'
from pg_proc p where p.pronamespace = 'public'::regnamespace
  and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute'))
  and (p.proname ~ '^(purge_|expired_|cleared_|mark_removed_)'
       or exists (select 1 from aclexplode(p.proacl) a where a.grantee = 'service_role'::regrole and a.privilege_type = 'EXECUTE'))
order by 1;
select pg_temp.ok('every service-role function is closed to members and anon',
  (select count(*) = 0 from pg_proc p where p.pronamespace = 'public'::regnamespace
    and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute'))
    and (p.proname ~ '^(purge_|expired_|cleared_|mark_removed_)'
         or exists (select 1 from aclexplode(p.proacl) a where a.grantee = 'service_role'::regrole and a.privilege_type = 'EXECUTE'))), true);
select pg_temp.ok('deleting a member at once is not for members', has_function_privilege('authenticated', 'public.delete_member_now(uuid)', 'execute'), false);
select pg_temp.ok('writing the record access log is not for members', has_function_privilege('authenticated', 'public.write_record_access(uuid, text, uuid, boolean)', 'execute'), false);

-- ---------------------------------------------------------------------------
-- 5. No policy is written for signed-out visitors or for every role, so
-- anon's only way in is a policy someone meant for it.
-- ---------------------------------------------------------------------------
select 'FAIL policy "' || p.polname || '" on ' || p.polrelid::regclass || ' applies to anon or every role'
from pg_policy p join pg_class c on c.oid = p.polrelid
where c.relnamespace in ('public'::regnamespace, 'storage'::regnamespace)
  and (0::oid = any (p.polroles) or 'anon'::regrole::oid = any (p.polroles))
order by 1;
select pg_temp.ok('no policy in public or storage applies to anon or every role',
  (select count(*) = 0 from pg_policy p join pg_class c on c.oid = p.polrelid
   where c.relnamespace in ('public'::regnamespace, 'storage'::regnamespace)
     and (0::oid = any (p.polroles) or 'anon'::regrole::oid = any (p.polroles))), true);

-- ---------------------------------------------------------------------------
-- 6. Signed-out visitors read and write no row of any table. With the
-- privileges Supabase gives anon, row level security must hide every row;
-- where the migrations took the privilege away, the read is refused.
-- ---------------------------------------------------------------------------
-- Rows to find: the seed's members, groups, guardians, injury and check-in,
-- plus a message, a concern and a consent.
do $$ begin
  perform set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000041', false);
  perform public.set_child_consent('00000000-0000-0000-0000-000000000031', true, true);
end $$;
insert into public.messages (id, sender_id, sender_name, body, audience, team_id) values
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-000000000011', 'Casey Coach', 'Squad message', 'group', '00000000-0000-0000-0000-0000000000a1');
insert into public.message_recipients (message_id, profile_id) values
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-000000000031');
insert into public.concerns (raised_by, raised_by_name, body)
values ('00000000-0000-0000-0000-000000000031', 'Jordan Junior', 'Something worried me');
select pg_temp.ok('tables with rows to find', (select count(*) >= 10 from public_tables where pg_temp.n(format('select 1 from public.%I', t)) > 0), true);
select set_config('request.jwt.claim.sub', '', false);

create temp table anon_tables as
select t, pg_temp.n(format('select 1 from public.%I', t)) as total,
  has_table_privilege('anon', oid, 'select') as can_select,
  has_table_privilege('anon', oid, 'insert') as can_insert,
  has_table_privilege('anon', oid, 'update') as can_update,
  has_table_privilege('anon', oid, 'delete') as can_delete,
  (select format('update public.%I set %I = %I', t, a.attname, a.attname)
   from pg_attribute a where a.attrelid = public_tables.oid and a.attnum > 0 and not a.attisdropped
     and a.attgenerated = '' and a.attidentity = '' order by a.attnum limit 1) as upd
from public_tables;
grant select on anon_tables to anon;

set role anon;
select pg_temp.ok(t || ': anon reads no rows (of ' || total || ')', pg_temp.n(format('select 1 from public.%I', t)) = 0, true)
from anon_tables where can_select order by t;
select pg_temp.fails(t || ': anon cannot select', format('select 1 from public.%I', t))
from anon_tables where not can_select order by t;
select pg_temp.refused(t || ': anon cannot insert', format('insert into public.%I default values', t))
from anon_tables order by t;
select pg_temp.ok(t || ': anon updates nothing', pg_temp.changed(upd) = 0, true)
from anon_tables where can_update order by t;
select pg_temp.fails(t || ': anon cannot update', upd)
from anon_tables where not can_update order by t;
select pg_temp.ok(t || ': anon deletes nothing', pg_temp.changed(format('delete from public.%I', t)) = 0, true)
from anon_tables where can_delete order by t;
select pg_temp.fails(t || ': anon cannot delete', format('delete from public.%I', t))
from anon_tables where not can_delete order by t;
reset role;
select pg_temp.ok('every table still has its rows',
  (select bool_and(pg_temp.n(format('select 1 from public.%I', t)) = total) from anon_tables), true);

-- ---------------------------------------------------------------------------
-- 7. Storage. The app's buckets are private, except the club's logo, which
-- shows before sign-in. Signed-out visitors read no file in any bucket.
-- ---------------------------------------------------------------------------
create temp table public_buckets (id text, reason text);
insert into public_buckets values
  ('club-branding', 'the club logo and colours show on the sign-in screen, before anyone signs in');
select pg_temp.ok(b || ' bucket exists', exists (select 1 from storage.buckets where id = b), true)
from unnest(array['injury-documents', 'training-certificates', 'session-plans', 'club-branding']) b order by b;
select pg_temp.ok(id || ' bucket is private', public, false)
from storage.buckets where id not in (select id from public_buckets) order by id;
select pg_temp.ok('allow-listed public bucket ' || id || ' still exists', exists (select 1 from storage.buckets b where b.id = p.id), true)
from public_buckets p order by id;
insert into storage.objects (bucket_id, name, metadata)
select id, '00000000-0000-0000-0000-000000000031/sample/file.pdf', '{"mimetype": "application/pdf"}' from storage.buckets;
set role anon;
select pg_temp.ok(b.id || ': anon reads no files', pg_temp.n(format('select 1 from storage.objects where bucket_id = %L', b.id)) = 0, true)
from (values ('injury-documents'), ('training-certificates'), ('session-plans'), ('club-branding')) b(id) order by b.id;
select pg_temp.refused(b.id || ': anon cannot upload', format($$insert into storage.objects (bucket_id, name) values (%L, '00000000-0000-0000-0000-000000000031/x/upload.pdf')$$, b.id))
from (values ('injury-documents'), ('training-certificates'), ('session-plans'), ('club-branding')) b(id) order by b.id;
select pg_temp.ok('anon deletes no files', pg_temp.changed('delete from storage.objects') = 0, true);
reset role;
select pg_temp.ok('every sample file is still there', (select count(*) = 4 from storage.objects), true);
