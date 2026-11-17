#!/usr/bin/env bash
# Tests that scripts/run-sql-tests.sh rebuilds the test database when the date
# changes during a run. The migrations and sample members fill in dates from
# today, so a run that crossed midnight UTC used to compare yesterday's data
# with today and fail (statistician-checks, volunteer-exemptions, wwcc-records
# and others). SQL_TESTS_DATE_QUERY stands in for the clock: a query that gives
# a new answer each time is a date that keeps moving. Run by the "Tests"
# workflow, with the same Postgres settings as run-sql-tests.sh.
set -uo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
log=$(mktemp)
# A test file that fails the first time and passes once it has run before,
# standing in for a file that midnight passed through.
tmp="$root/supabase/tests/zz-runner-self-test.sql"
marker=sqltests_rerun_marker
drop_marker() { psql -X -q -d postgres -c "drop database if exists $marker" >/dev/null 2>&1; }
trap 'rm -f "$log" "$tmp"; drop_marker' EXIT
failed=0
files=(committee-checks-from statistician-checks)

count() { grep -c "$1" "$log"; }

check() {
  local label=$1 ok=$2
  if [ "$ok" = yes ]; then echo "PASS $label"; else echo "FAIL $label"; cat "$log"; failed=1; fi
}

# The date stays put: one build, no rebuild.
"$root/scripts/run-sql-tests.sh" "${files[@]}" >"$log" 2>&1
status=$?
check 'a run on one day passes' "$([ $status -eq 0 ] && echo yes || echo no)"
check 'a run on one day builds the database once' "$([ "$(count '^Building the test database')" -eq 1 ] && echo yes || echo no)"
check 'a run on one day does not rebuild' "$([ "$(count 'rebuilding it')" -eq 0 ] && echo yes || echo no)"

# The date moves before every file: rebuilt before each one, and still passes.
SQL_TESTS_DATE_QUERY='select clock_timestamp()::text' \
  "$root/scripts/run-sql-tests.sh" "${files[@]}" >"$log" 2>&1
status=$?
check 'a run across midnight passes' "$([ $status -eq 0 ] && echo yes || echo no)"
check 'a run across midnight rebuilds before each file' "$([ "$(count 'rebuilding it')" -eq ${#files[@]} ] && echo yes || echo no)"
check 'a run across midnight still runs every file' "$([ "$(count '^ok ')" -eq ${#files[@]} ] && echo yes || echo no)"

cat >"$tmp" <<SQL
\\set ON_ERROR_STOP 0
select exists (select from pg_database where datname = '$marker') as seen \\gset
\\if :seen
\\echo PASS ran again on a rebuilt database
\\else
\\echo FAIL first run
create database $marker;
\\endif
SQL

# Midnight passes while a file runs: it fails, so it runs once more and passes.
drop_marker
SQL_TESTS_DATE_QUERY='select clock_timestamp()::text' \
  "$root/scripts/run-sql-tests.sh" zz-runner-self-test >"$log" 2>&1
status=$?
check 'a file midnight passed through runs again' "$([ "$(count 'while zz-runner-self-test ran; running it again')" -eq 1 ] && echo yes || echo no)"
check 'its second run counts' "$([ $status -eq 0 ] && [ "$(count '^ok ')" -eq 1 ] && echo yes || echo no)"

# On one day the same failure is a real one: it runs once and fails.
drop_marker
"$root/scripts/run-sql-tests.sh" zz-runner-self-test >"$log" 2>&1
status=$?
check 'a failure on one day is not run again' "$([ "$(count 'running it again')" -eq 0 ] && echo yes || echo no)"
check 'a failure on one day fails the run' "$([ $status -ne 0 ] && [ "$(count '^FAILED zz-runner-self-test')" -eq 1 ] && echo yes || echo no)"

[ $failed -eq 0 ]
