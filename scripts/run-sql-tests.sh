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

echo "Building the test database"
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
  checks=$((checks + pass))
  if [ "$fail" -gt 0 ] || [ "$errors" -gt 0 ] || [ $status -ne 0 ] || { [ "$printed" -gt 0 ] && [ "$pass" -eq 0 ]; }; then
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
