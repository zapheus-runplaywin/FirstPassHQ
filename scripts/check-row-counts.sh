#!/usr/bin/env bash
# Checks that a branch's new migrations don't lose rows (AGENTS.md: "confirm
# row counts are unchanged"). Builds a database from the migrations already on
# the base branch, loads the sample members and records, counts the rows in
# every table, applies the new migrations, and counts again. Fails when any
# table has fewer rows, or a table with rows is gone.
#
#   scripts/check-row-counts.sh [base-ref]     # default origin/main
#
# Connects with the usual PGHOST, PGPORT, PGUSER and PGPASSWORD settings; the
# user must be able to create databases. "Check migrations" runs it on pull
# requests, skipped like check-migrations.py when Matt has added the
# data-loss-approved label.
set -uo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
setup="$root/supabase/tests/setup"
base=${1:-origin/main}
db=firstpass_row_counts
out=$(mktemp -d)
trap 'rm -rf "$out"' EXIT

export PGOPTIONS="${PGOPTIONS:-} -c client_min_messages=warning"
psql_q() { psql -X -q -v ON_ERROR_STOP=1 "$@"; }

on_base=$(git -C "$root" ls-tree --name-only "$base" supabase/migrations/) || {
  echo "::error::Can't read the migrations on $base."; exit 1
}
old=(); new=()
for m in "$root"/supabase/migrations/*.sql; do
  rel=${m#"$root"/}
  if grep -qxF "$rel" <<<"$on_base"; then old+=("$m"); else new+=("$m"); fi
done
if [ ${#new[@]} -eq 0 ]; then
  echo "No new migrations."
  exit 0
fi

apply() {
  # pg_net is a Supabase extension; supabase-stubs.sql stands in for it.
  if ! sed 's/^create extension if not exists pg_net;//' "$1" | psql_q -d "$db" >"$out/apply.log" 2>&1; then
    cat "$out/apply.log"; echo "::error file=${1#"$root"/}::This migration did not apply."; exit 1
  fi
}

counts() {
  psql_q -d "$db" -At -F ' ' <<'SQL'
select format('%I.%I', n.nspname, c.relname),
  (xpath('/row/n/text()', query_to_xml(format('select count(*) as n from %I.%I', n.nspname, c.relname), false, true, '')))[1]::text
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where c.relkind in ('r', 'p') and n.nspname in ('public', 'auth', 'storage')
order by 1;
SQL
}

echo "Building the database from $base's migrations"
psql_q -d postgres -c "drop database if exists $db" -c "create database $db" >/dev/null || exit 1
if ! psql_q -d "$db" -f "$setup/supabase-stubs.sql" >"$out/setup.log" 2>&1; then
  cat "$out/setup.log"; echo "::error::The Supabase stubs did not load."; exit 1
fi
for m in "${old[@]}"; do apply "$m"; done
for f in seed-members.sql sample-records.sql; do
  if ! psql_q -d "$db" -f "$setup/$f" >"$out/seed.log" 2>&1; then
    cat "$out/seed.log"; echo "::error file=supabase/tests/setup/$f::The sample data did not load."; exit 1
  fi
done
counts >"$out/before" || exit 1

for m in "${new[@]}"; do
  echo "Applying ${m#"$root"/}"
  apply "$m"
done
counts >"$out/after" || exit 1
psql_q -d postgres -c "drop database $db" >/dev/null

lost=0
while read -r table before; do
  after=$(awk -v t="$table" '$1 == t { print $2 }' "$out/after")
  if [ -z "$after" ]; then
    if [ "$before" -gt 0 ]; then
      echo "::error::$table had $before rows and is gone."; lost=1
    fi
  elif [ "$after" -lt "$before" ]; then
    echo "::error::$table went from $before rows to $after."; lost=1
  fi
done <"$out/before"

tables=$(wc -l <"$out/before")
rows=$(awk '{ s += $2 } END { print s }' "$out/before")
if [ $lost -eq 0 ]; then
  echo "Row counts unchanged or higher in all $tables tables ($rows sample rows)."
fi
[ $lost -eq 0 ]
