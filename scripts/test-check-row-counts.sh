#!/usr/bin/env bash
# Tests scripts/check-row-counts.sh: it passes an additive migration and fails
# one that deletes rows or drops a table. Compares against HEAD, so only the
# temporary migrations written here count as new. Run by the "Tests" workflow.
set -uo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
tmp="$root/supabase/migrations/29991231000000_row_count_self_test.sql"
log=$(mktemp)
trap 'rm -f "$tmp" "$log"' EXIT
failed=0

check() {
  local label=$1 want=$2 pattern=$3
  "$root/scripts/check-row-counts.sh" HEAD >"$log" 2>&1
  local got=$?
  if { [ "$want" = pass ] && [ $got -eq 0 ]; } || { [ "$want" = fail ] && [ $got -ne 0 ]; }; then
    if grep -q -- "$pattern" "$log"; then echo "PASS $label"; return; fi
  fi
  echo "FAIL $label"; cat "$log"; failed=1
}

check 'the branch as it stands passes' pass 'No new migrations\|Row counts unchanged'

echo 'alter table public.personal_tasks add column if not exists row_count_test text;' >"$tmp"
check 'an additive migration passes' pass 'Row counts unchanged'

echo "delete from public.check_ins where athlete_id = '00000000-0000-0000-0000-000000000031';" >"$tmp"
check 'deleting rows fails' fail 'public.check_ins went from 2 rows to 1'

echo 'drop table public.personal_tasks;' >"$tmp"
check 'dropping a table with rows fails' fail 'public.personal_tasks had 1 rows and is gone'

[ $failed -eq 0 ]
