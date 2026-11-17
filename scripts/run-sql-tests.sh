#!/usr/bin/env bash
# Runs the database tests in supabase/tests on a plain Postgres 16, used by the
# "Tests" workflow and before opening a pull request. Builds one database
# with the Supabase stubs, every migration and the sample members, then runs
# each test file on its own copy of it.
#
#   scripts/run-sql-tests.sh                    # every test except the manual ones
#   scripts/run-sql-tests.sh surveys concerns   # just these
#   scripts/run-sql-tests.sh large-club concurrency   # the manual ones
#
# A test whose first line is "-- Manual test" (the 200-member club and two
# saves at once) runs only when named, by hand or from the "Scale tests"
# workflow, to save Actions minutes (Matt, 2026-10-19).
#
# The test database is rebuilt if the date changes during a run, so a run
# across midnight doesn't compare yesterday's sample data with today; a file
# that fails while midnight passes runs once more on the rebuilt database.
#
# Connects with the usual PGHOST, PGPORT, PGUSER and PGPASSWORD settings; the
# user must be able to create databases. A test fails when it prints a line
# starting with FAIL, when any statement errors, or when it checks nothing.
# Tests that expect an error catch it themselves (see pg_temp.fails in
# record-access.sql), so an ERROR always means something broke.
set -uo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
tests="$root/supabase/tests"
template=firstpass_tests
out=$(mktemp -d)
trap 'rm -rf "$out"' EXIT

export PGOPTIONS="${PGOPTIONS:-} -c client_min_messages=warning"
psql_q() { psql -X -q -v ON_ERROR_STOP=1 "$@"; }

# The migrations and sample members fill in dates from "today" (a check date
# 90 days ahead, a child's birthday, today's check-in), and the tests compare
# against today again. A run that crosses midnight in the database's time
# zone (UTC in CI, 8 am in Perth) would compare a template built yesterday
# with today and fail. So the template is rebuilt whenever the date has moved
# on since it was built. SQL_TESTS_DATE_QUERY replaces the query that reads
# the date, only so scripts/test-run-sql-tests.sh can move it.
date_query=${SQL_TESTS_DATE_QUERY:-select current_date}
db_date() { psql -X -qAt -d postgres -c "$date_query"; }

build_template() {
  echo "Building the test database"
  # Read before building, so midnight during the build counts as a change.
  built_on=$(db_date) || exit 1
  psql_q -d postgres -c "drop database if exists $template" -c "create database $template" >/dev/null || exit 1
  if ! psql_q -d "$template" -f "$tests/setup/supabase-stubs.sql" >"$out/setup.log" 2>&1; then
    cat "$out/setup.log"; echo "::error::The Supabase stubs did not load."; exit 1
  fi
  for m in "$root"/supabase/migrations/*.sql; do
    # pg_net is a Supabase extension; supabase-stubs.sql stands in for it.
    if ! sed 's/^create extension if not exists pg_net;//' "$m" | psql_q -d "$template" >"$out/migration.log" 2>&1; then
      cat "$out/migration.log"; echo "::error file=${m#"$root"/}::This migration did not apply."; exit 1
    fi
  done
  if ! psql_q -d "$template" -f "$tests/setup/seed-members.sql" >"$out/seed.log" 2>&1; then
    cat "$out/seed.log"; echo "::error::The sample members did not load."; exit 1
  fi
}

build_template

if [ $# -gt 0 ]; then
  files=(); for n in "$@"; do files+=("$tests/${n%.sql}.sql"); done
else
  files=()
  for f in "$tests"/*.sql; do
    head -n 1 "$f" | grep -q '^-- Manual test' || files+=("$f")
  done
fi

failed=0; checks=0
for f in "${files[@]}"; do
  name=$(basename "$f" .sql)
  db="firstpass_test_$(echo "$name" | tr -c 'a-z0-9\n' '_')"
  # A file runs a second time only when midnight passed while it ran, so its
  # result mixed two dates. The second run starts from a template built today.
  for attempt in 1 2; do
    if [ "$(db_date)" != "$built_on" ]; then
      echo "The date changed since the test database was built; rebuilding it"
      build_template
    fi
    psql_q -d postgres -c "drop database if exists $db" -c "create database $db template $template" >/dev/null || exit 1
    log="$out/$name.log"
    # Files that print PASS and FAIL lines turn ON_ERROR_STOP off themselves;
    # the rest raise on the first failure.
    psql -X -v ON_ERROR_STOP=1 -d "$db" -f "$f" >"$log" 2>&1
    status=$?
    psql_q -d postgres -c "drop database $db" >/dev/null
    # A check from supabase/checks (run with \ir) prints OK and GAP notices.
    pass=$(grep -cE '^PASS|NOTICE:  OK ' "$log")
    fail=$(grep -cE '^FAIL|NOTICE:  GAP ' "$log")
    errors=$(grep -c 'ERROR:' "$log")
    printed=$(grep -c 'ON_ERROR_STOP 0' "$f")
    bad=0
    if [ "$fail" -gt 0 ] || [ "$errors" -gt 0 ] || [ $status -ne 0 ] || { [ "$printed" -gt 0 ] && [ "$pass" -eq 0 ]; }; then bad=1; fi
    if [ $bad -eq 1 ] && [ $attempt -eq 1 ] && [ "$(db_date)" != "$built_on" ]; then
      echo "The date changed while $name ran; running it again"
      continue
    fi
    break
  done
  checks=$((checks + pass))
  if [ $bad -eq 1 ]; then
    failed=$((failed + 1))
    echo "FAILED $name ($pass passed, $fail failed, $errors errors)"
    grep -E '^FAIL|NOTICE:  GAP |ERROR:' "$log" | sed 's/^/    /'
    echo "::error file=supabase/tests/$name.sql::$fail failed checks, $errors errors"
  elif [ "$printed" -gt 0 ]; then
    echo "ok     $name ($pass checks)"
  else
    echo "ok     $name"
  fi
done

psql_q -d postgres -c "drop database $template" >/dev/null
echo
echo "${#files[@]} test files, $checks printed checks passed, $failed files failed"
[ $failed -eq 0 ]
