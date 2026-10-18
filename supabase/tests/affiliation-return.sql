-- Tests for 20261013110000_affiliation_return.sql. Run on a fresh database with the
-- migrations and seed-members.sql loaded. Prints one line per check.
\set ON_ERROR_STOP 0
\pset tuples_only on
\pset format unaligned
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

select pg_temp.as_member('11');
select pg_temp.fails('a coach can''t see returns', $s$ select * from public.admin_affiliation_return() $s$);
select pg_temp.fails('a coach can''t set the email', $s$ select public.admin_set_affiliation_return_email('a@b.org') $s$);
select pg_temp.fails('a coach can''t log a return', $s$ select public.admin_log_affiliation_return(2026) $s$);

select pg_temp.as_member('01');
select pg_temp.ok('starts with no email and nothing sent',
  (select return_email is null and last_sent_at is null from public.admin_affiliation_return()), true);
select pg_temp.fails('a return can''t be logged before there is an email',
  $s$ select public.admin_log_affiliation_return(2026) $s$);
select pg_temp.fails('a bad email is refused', $s$ select public.admin_set_affiliation_return_email('not an email') $s$);
select pg_temp.works('an admin sets the email', $s$ select public.admin_set_affiliation_return_email('  Affiliations@Coastal.org.au ') $s$);
select pg_temp.ok('the email is trimmed and lower case',
  (select return_email = 'affiliations@coastal.org.au' from public.admin_affiliation_return()), true);
select pg_temp.works('an admin logs a return', $s$ select public.admin_log_affiliation_return(2026) $s$);
select pg_temp.ok('the last return shows where it went and who sent it',
  (select last_sent_at is not null and last_sent_to = 'affiliations@coastal.org.au' and last_sent_by_name is not null
   from public.admin_affiliation_return()), true);
select pg_temp.works('a blank email clears it', $s$ select public.admin_set_affiliation_return_email('') $s$);
select pg_temp.ok('cleared, the last return is still kept',
  (select return_email is null and last_sent_to = 'affiliations@coastal.org.au' from public.admin_affiliation_return()), true);
select pg_temp.ok('the rest of the affiliation record is untouched',
  (select member_type = 'club' from public.admin_affiliation()), true);
select pg_temp.ok('anon can''t run the functions',
  (select not has_function_privilege('anon', 'public.admin_affiliation_return()', 'execute')
      and not has_function_privilege('anon', 'public.admin_log_affiliation_return(int)', 'execute')), true);
