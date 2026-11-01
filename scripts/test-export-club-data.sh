#!/usr/bin/env bash
# Tests scripts/export-club-data.sh against a local Postgres loaded with the
# migrations and the sample members, and a small local web server standing in
# for Supabase Storage. Run by the "Tests" workflow.
set -uo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
setup="$root/supabase/tests/setup"
db=firstpass_export_test
work=$(mktemp -d)
server=""
cleanup() { [ -n "$server" ] && kill "$server" 2>/dev/null; rm -rf "$work"; }
trap cleanup EXIT
failed=0

export PGOPTIONS="${PGOPTIONS:-} -c client_min_messages=warning"
psql_q() { psql -X -q -v ON_ERROR_STOP=1 "$@"; }
pass() { echo "PASS $1"; }
fail() { echo "FAIL $1"; failed=1; }
check() { if eval "$2"; then pass "$1"; else fail "$1"; fi; }

echo "Building the database"
psql_q -d postgres -c "drop database if exists $db" -c "create database $db" >/dev/null || exit 1
psql_q -d "$db" -f "$setup/supabase-stubs.sql" >/dev/null || exit 1
for m in "$root"/supabase/migrations/*.sql; do
  sed 's/^create extension if not exists pg_net;//' "$m" | psql_q -d "$db" >"$work/migration.log" 2>&1 || { cat "$work/migration.log"; exit 1; }
done
psql_q -d "$db" -f "$setup/seed-members.sql" >/dev/null || exit 1

# Three stored files, one with a space in its name, and their contents.
store="$work/store"
mkdir -p "$store/object/injury-documents/00000000-0000-0000-0000-000000000031" "$store/object/club-assets"
printf 'x-ray report' >"$store/object/injury-documents/00000000-0000-0000-0000-000000000031/x-ray.pdf"
printf 'second letter' >"$store/object/injury-documents/00000000-0000-0000-0000-000000000031/letter 2.pdf"
printf 'logo' >"$store/object/club-assets/logo.png"
psql_q -d "$db" -c "insert into storage.objects (bucket_id, name) values
  ('injury-documents', '00000000-0000-0000-0000-000000000031/x-ray.pdf'),
  ('injury-documents', '00000000-0000-0000-0000-000000000031/letter 2.pdf'),
  ('club-assets', 'logo.png')" >/dev/null

port=$(python3 -I -c 'import socket; s = socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1])')
python3 -I -m http.server "$port" --bind 127.0.0.1 --directory "$store" >/dev/null 2>&1 &
server=$!
for _ in $(seq 1 50); do curl -s -o /dev/null "http://127.0.0.1:$port/" && break; sleep 0.1; done

url="postgresql://${PGUSER:-postgres}:${PGPASSWORD:-}@${PGHOST:-localhost}:${PGPORT:-5432}/$db"
export_club() { CLUB_DB_URL="$url" CLUB_STORAGE_URL="http://127.0.0.1:$port" CLUB_SERVICE_KEY=test-key \
  "$root/scripts/export-club-data.sh" "$@"; }

# Refusals.
CLUB_DB_URL="" "$root/scripts/export-club-data.sh" "$work/none" >/dev/null 2>&1
check 'refuses without a database connection string' "[ $? -eq 2 ] && [ ! -e '$work/none' ]"
mkdir "$work/existing"; touch "$work/existing/keep.txt"
export_club "$work/existing" --no-files >/dev/null 2>&1
check 'refuses a folder that already exists, leaving it alone' "[ $? -eq 2 ] && [ -f '$work/existing/keep.txt' ] && [ ! -e '$work/existing/tables' ]"
CLUB_DB_URL="$url" CLUB_STORAGE_URL="http://127.0.0.1:$port" "$root/scripts/export-club-data.sh" "$work/nokey" >/dev/null 2>&1
check 'refuses to download files without the service key' "[ $? -eq 2 ] && [ ! -e '$work/nokey' ]"
export_club "$work/bad" --everything >/dev/null 2>&1
check 'refuses an unknown option' "[ $? -eq 2 ]"

# The database only.
out="$work/db-only"
export_club "$out" --no-files >"$work/db-only.log" 2>&1
check 'exports the database only' "[ $? -eq 0 ]"
profiles=$(psql_q -d "$db" -At -c 'select count(*) from public.profiles')
check 'writes every table as a CSV with a header row' "head -1 '$out/tables/profiles.csv' | grep -q '^id,' && [ \$(ls '$out/tables' | wc -l) -eq \$(psql -X -At -d $db -c \"select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r','p')\") ]"
check 'the CSV holds every member' "python3 -I -c 'import csv,sys; print(sum(1 for _ in csv.DictReader(open(sys.argv[1]))))' '$out/tables/profiles.csv' | grep -qx '$profiles'"
check 'the manifest counts each table' "grep -qx '  profiles: $profiles' '$out/manifest.txt'"
check 'the dump can be read by pg_restore' "pg_restore --list '$out/database.dump' | grep -c 'TABLE DATA public profiles' >/dev/null"
check 'the plain SQL copy holds the members' "grep -q 'Jordan Junior' '$out/database.sql'"
check 'the database copy leaves out roles and grants' "! grep -q 'GRANT \\|OWNER TO' '$out/database.sql'"
check 'no files folder without files' "[ ! -e '$out/files' ]"
check 'every file has a checksum that verifies' "(cd '$out' && sha256sum -c --quiet SHA256SUMS) && grep -q 'tables/profiles.csv' '$out/SHA256SUMS'"
check 'the README says what it holds' "grep -q 'children' '$out/README.txt'"
check 'only the owner can open the folder' "[ \$(stat -c %a '$out') = 700 ]"

# With the files.
out="$work/full"
export_club "$out" >"$work/full.log" 2>&1
check 'exports the database and the files' "[ $? -eq 0 ]"
check 'downloads each file into its bucket' "[ \"\$(cat '$out/files/injury-documents/00000000-0000-0000-0000-000000000031/x-ray.pdf')\" = 'x-ray report' ] && [ \"\$(cat '$out/files/club-assets/logo.png')\" = 'logo' ]"
check 'downloads a file with a space in its name' "[ \"\$(cat '$out/files/injury-documents/00000000-0000-0000-0000-000000000031/letter 2.pdf')\" = 'second letter' ]"
check 'the manifest counts files per bucket' "grep -qx '  injury-documents: 2' '$out/manifest.txt' && grep -qx '  club-assets: 1' '$out/manifest.txt' && grep -qx '  total: 3' '$out/manifest.txt'"
check 'the downloaded files have checksums too' "(cd '$out' && sha256sum -c --quiet SHA256SUMS) && grep -q 'files/club-assets/logo.png' '$out/SHA256SUMS'"
check 'no working list is left behind' "[ ! -e '$out/.files' ]"

# A file the storage can't hand over stops the export.
psql_q -d "$db" -c "insert into storage.objects (bucket_id, name) values ('club-assets', 'missing.png')" >/dev/null
export_club "$work/missing" >/dev/null 2>&1
check 'stops when a file can’t be downloaded' "[ $? -ne 0 ]"
psql_q -d "$db" -c "delete from storage.objects where name = 'missing.png'" >/dev/null

# A stored name that would climb out of the folder stops the export.
psql_q -d "$db" -c "insert into storage.objects (bucket_id, name) values ('club-assets', '../../outside.txt')" >/dev/null
export_club "$work/unsafe" >"$work/unsafe.log" 2>&1
check 'stops at a file name that would leave the folder' "[ $? -ne 0 ] && grep -q 'unsafe file name' '$work/unsafe.log' && [ ! -e '$work/outside.txt' ]"

psql_q -d postgres -c "drop database if exists $db" >/dev/null
[ $failed -eq 0 ]
