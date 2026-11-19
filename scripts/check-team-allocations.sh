#!/usr/bin/env bash
# Runs the read-only team allocations check (supabase/checks/team-allocations.sql)
# against a database and prints one line per check: OK, FOUND or INFO.
#
#   DATABASE_URL=postgresql://... scripts/check-team-allocations.sh
#   PGHOST=localhost PGUSER=postgres PGPASSWORD=... PGDATABASE=... scripts/check-team-allocations.sh
#
# The check runs in one read-only transaction that it rolls back, so nothing
# in the database can change. It prints member ids, counts and squad or team names, never people's
# names, notes or message text. Exits 1 when it finds rows to look at (FOUND).
set -uo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)
out=$(psql -X -q ${DATABASE_URL:+"$DATABASE_URL"} -f "$root/supabase/checks/team-allocations.sql" 2>&1)
status=$?
printf '%s\n' "$out" | sed -n 's/^psql:[^ ]* NOTICE:  //p'
if [ $status -ne 0 ] || printf '%s\n' "$out" | grep -q 'ERROR:'; then
  printf '%s\n' "$out" | grep 'ERROR:'
  echo "::error::The team allocations check did not run."
  exit 2
fi
if printf '%s\n' "$out" | grep -q 'NOTICE:  FOUND'; then
  exit 1
fi
