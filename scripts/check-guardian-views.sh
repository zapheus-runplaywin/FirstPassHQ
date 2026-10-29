#!/usr/bin/env bash
# Runs the read-only guardian views check (supabase/checks/guardian-views.sql)
# against a database and prints one line per check: OK, GAP or INFO.
#
#   DATABASE_URL=postgresql://... scripts/check-guardian-views.sh
#   PGHOST=localhost PGUSER=postgres PGPASSWORD=... PGDATABASE=... scripts/check-guardian-views.sh
#
# The session is read-only from the start (default_transaction_read_only), so
# nothing in the database can change. It prints member ids and counts, never
# names, notes or message text. Exits 1 when any check finds a GAP.
set -uo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)
export PGOPTIONS="${PGOPTIONS:-} -c default_transaction_read_only=on"
out=$(psql -X -q ${DATABASE_URL:+"$DATABASE_URL"} -f "$root/supabase/checks/guardian-views.sql" 2>&1)
status=$?
printf '%s\n' "$out" | sed -n 's/^psql:[^ ]* NOTICE:  //p'
if [ $status -ne 0 ] || printf '%s\n' "$out" | grep -q 'ERROR:'; then
  printf '%s\n' "$out" | grep 'ERROR:'
  echo "::error::The guardian views check did not run."
  exit 2
fi
if printf '%s\n' "$out" | grep -q 'NOTICE:  GAP'; then
  exit 1
fi
