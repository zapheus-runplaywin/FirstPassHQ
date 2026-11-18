#!/usr/bin/env bash
# Tests scripts/first-admin-code.sh against a local Postgres loaded with the
# migrations and the sample members: it prints a code that makes someone the
# first admin of a club with none, refuses in a club that has an admin, and
# says why in plain words. Run by the "Tests" workflow.
set -uo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
setup="$root/supabase/tests/setup"
db=firstpass_first_admin_test
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
failed=0

export PGOPTIONS="${PGOPTIONS:-} -c client_min_messages=warning"
psql_q() { psql -X -q -v ON_ERROR_STOP=1 "$@"; }
check() { if eval "$2"; then echo "PASS $1"; else echo "FAIL $1"; cat "$work/out" "$work/err" 2>/dev/null; failed=1; fi; }
run() { CLUB_DB_URL="${url-}" "$root/scripts/first-admin-code.sh" "$@" >"$work/out" 2>"$work/err"; status=$?; }

echo "Building the database"
psql_q -d postgres -c "drop database if exists $db" -c "create database $db" >/dev/null || exit 1
psql_q -d "$db" -f "$setup/supabase-stubs.sql" >/dev/null || exit 1
for m in "$root"/supabase/migrations/*.sql; do
  sed 's/^create extension if not exists pg_net;//' "$m" | psql_q -d "$db" >"$work/migration.log" 2>&1 || { cat "$work/migration.log"; exit 1; }
done
psql_q -d "$db" -f "$setup/seed-members.sql" >/dev/null || exit 1
url="postgresql:///$db"
sql() { psql_q -At -d "$db" -c "$1"; }

# The sample club has admins.
run
check "a club with an admin: refused" '[ "$status" = 1 ]'
check "a club with an admin: says why, without the database's wrapping" \
  'grep -qx "No setup code was made: This club already has an admin, who approves other admins from Members" "$work/err"'
check "a club with an admin: prints no code" '[ ! -s "$work/out" ]'
check "a club with an admin: saved no code" '[ "$(sql "select count(*) from public.club_setup_codes")" = 0 ]'

# A new club: nobody is an admin yet, and someone has signed in.
sql "update public.profiles set role = 'guest' where role = 'admin'" >/dev/null
sql "insert into auth.users (id, email, email_confirmed_at) values ('00000000-0000-0000-0000-000000000071', 'first.admin@example.test', now())" >/dev/null

run
code=$(sed -n 's/^Setup code: //p' "$work/out")
check "a new club: makes a code" '[ "$status" = 0 ] && [[ "$code" =~ ^[2-9A-HJKMNP-Z]{4}(-[2-9A-HJKMNP-Z]{4}){2}$ ]]'
check "a new club: says it lasts 7 days and where to enter it" \
  'grep -q "It lasts 7 days and works once" "$work/out" && grep -q "Setting up this club?" "$work/out"'
check "a new club: the code is kept only as a hash" \
  '[ "$(sql "select count(*) from public.club_setup_codes where code_hash like '"'"'%${code//-/}%'"'"'")" = 0 ]'

run 3
code3=$(sed -n 's/^Setup code: //p' "$work/out")
check "run again with 3 days: a different code, lasting 3 days" \
  '[ "$status" = 0 ] && [ -n "$code3" ] && [ "$code3" != "$code" ] && grep -q "It lasts 3 days" "$work/out"'
check "run again: the first code is cancelled, one is open" \
  '[ "$(sql "select count(*) filter (where cancelled_at is null) || '"'"'/'"'"' || count(*) from public.club_setup_codes")" = 1/2 ]'

claim() { sql "select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000071', false); select coalesce(public.claim_first_admin('$1', 'Sam First'), 'ok')" | tail -1; }
check "the cancelled code is refused in the app" '[[ "$(claim "$code")" == "That setup code"* ]]'
check "the printed code makes the person the club's admin" '[ "$(claim "$code3")" = ok ]'
check "they are an approved admin" \
  '[ "$(sql "select role || '"'"'/'"'"' || status from public.profiles where id = '"'"'00000000-0000-0000-0000-000000000071'"'"'")" = admin/approved ]'
run
check "once the club has its admin: refused again" '[ "$status" = 1 ] && grep -q "already has an admin" "$work/err"'

# Asked for wrongly: nothing reaches the database.
for bad in 0 31; do
  run "$bad"
  check "$bad days: refused with the database's reason" '[ "$status" = 1 ] && grep -q "between 1 and 30 days" "$work/err"'
done
run "7; drop table public.profiles"
check "days that aren't a number: usage, exit 2" '[ "$status" = 2 ] && grep -q "^Usage:" "$work/err"'
run 7 8
check "too many arguments: usage, exit 2" '[ "$status" = 2 ] && grep -q "^Usage:" "$work/err"'
url=""
run
check "no CLUB_DB_URL: says to set it, exit 2" '[ "$status" = 2 ] && grep -q "Set CLUB_DB_URL" "$work/err"'
url="postgresql:///no_such_database_here"
run
check "a database that can't be reached: fails, with no code" '[ "$status" = 1 ] && [ ! -s "$work/out" ] && grep -q "No setup code was made" "$work/err"'

psql_q -d postgres -c "drop database $db" >/dev/null
[ "$failed" = 0 ] && echo "All checks passed." || { echo "Some checks failed."; exit 1; }
