#!/usr/bin/env bash
# Makes a full copy of one club's data, for a club that asks for it or leaves
# FirstPass HQ (customer review C12, Matt, 23 October 2026: "Statement, export
# on request"). FirstPass runs this, never the app: a download button would
# let one admin take every child's records at once. docs/data-handling.md
# says what clubs are told, and docs/environments.md how to run it.
#
#   CLUB_DB_URL=postgresql://... CLUB_PROJECT_REF=abcd CLUB_SERVICE_KEY=... \
#     scripts/export-club-data.sh <new folder> [--no-files]
#
# CLUB_DB_URL     the club project's database connection string (session
#                 pooler, with the database password), from the Supabase
#                 dashboard under Connect.
# CLUB_PROJECT_REF and CLUB_SERVICE_KEY
#                 the project's ref and its secret (service role) key, to
#                 download the files. CLUB_STORAGE_URL replaces the storage
#                 address built from the ref (the tests use it).
# --no-files      only the database.
#
# The folder it makes holds:
#   database.dump   every table in the app's schema, for pg_restore
#   database.sql    the same as plain SQL, readable in any text editor
#   tables/*.csv    each table as a spreadsheet, with a header row
#   files/<bucket>/ every stored file: injury documents, certificates,
#                   receipts, session plans, logos
#   manifest.txt    rows per table and files per bucket, to check it's whole
#   SHA256SUMS      a checksum of every file, so the club can check the copy
#   README.txt      what each part is
#
# pg_dump must be the same major version as the project's Postgres or newer.
# Send the folder to the club's nominated admin through an encrypted link,
# then delete every copy FirstPass holds.
set -euo pipefail

usage() { echo "Usage: CLUB_DB_URL=... scripts/export-club-data.sh <new folder> [--no-files]" >&2; exit 2; }
[ $# -ge 1 ] || usage
out=$1; shift
files=true
for arg in "$@"; do
  case $arg in
    --no-files) files=false ;;
    *) usage ;;
  esac
done
[ -n "${CLUB_DB_URL:-}" ] || { echo "Set CLUB_DB_URL to the club's database connection string." >&2; exit 2; }
if [ -e "$out" ]; then echo "$out already exists; give a new folder so nothing is overwritten." >&2; exit 2; fi
if $files; then
  storage=${CLUB_STORAGE_URL:-}
  if [ -z "$storage" ]; then
    [ -n "${CLUB_PROJECT_REF:-}" ] || { echo "Set CLUB_PROJECT_REF (or use --no-files)." >&2; exit 2; }
    storage="https://$CLUB_PROJECT_REF.supabase.co/storage/v1"
  fi
  [ -n "${CLUB_SERVICE_KEY:-}" ] || { echo "Set CLUB_SERVICE_KEY to download files (or use --no-files)." >&2; exit 2; }
fi

psql_q() { psql -X -q -v ON_ERROR_STOP=1 -d "$CLUB_DB_URL" "$@"; }

mkdir -p "$out/tables"
# Nothing in the copy is readable by other users of this computer.
chmod 700 "$out"

echo "Copying the database"
pg_dump --dbname="$CLUB_DB_URL" --schema=public --no-owner --no-privileges -Fc -f "$out/database.dump"
pg_dump --dbname="$CLUB_DB_URL" --schema=public --no-owner --no-privileges -f "$out/database.sql"

echo "Writing each table as a CSV file"
: >"$out/manifest.txt"
echo "Tables (rows)" >>"$out/manifest.txt"
while IFS= read -r table; do
  [ -n "$table" ] || continue
  psql_q -c "\\copy (select * from public.\"$table\") to '$out/tables/$table.csv' with (format csv, header)"
  rows=$(psql_q -At -c "select count(*) from public.\"$table\"")
  echo "  $table: $rows" >>"$out/manifest.txt"
done < <(psql_q -At -c "select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
                        where n.nspname = 'public' and c.relkind in ('r', 'p') order by 1")

if $files; then
  echo "Downloading the stored files"
  echo "Files" >>"$out/manifest.txt"
  list="$out/.files"
  psql_q -At -F $'\t' -c "select bucket_id, name from storage.objects
                          where name is not null and name !~ '/$' order by bucket_id, name" >"$list"
  count=0; bucket_counts=""
  while IFS=$'\t' read -r bucket name; do
    [ -n "$name" ] || continue
    # A stored name never leaves the files folder.
    case "/$bucket/$name/" in
      */../*|*/./*|//*) echo "Stopping: an unsafe file name in $bucket: $name" >&2; exit 1 ;;
    esac
    target="$out/files/$bucket/$name"
    mkdir -p "$(dirname "$target")"
    encoded=$(python3 -I -c 'import sys, urllib.parse; print(urllib.parse.quote(sys.argv[1]))' "$name")
    curl --fail --silent --show-error --max-time 300 \
      -H "Authorization: Bearer $CLUB_SERVICE_KEY" -H "apikey: $CLUB_SERVICE_KEY" \
      -o "$target" "$storage/object/$bucket/$encoded"
    count=$((count + 1))
    bucket_counts+="$bucket"$'\n'
  done <"$list"
  rm -f "$list"
  if [ -n "$bucket_counts" ]; then
    printf '%s' "$bucket_counts" | sort | uniq -c | awk '{ print "  " $2 ": " $1 }' >>"$out/manifest.txt"
  fi
  echo "  total: $count" >>"$out/manifest.txt"
fi

cat >"$out/README.txt" <<'TEXT'
This is a full copy of your club's FirstPass HQ data.

database.dump  Every table, for a database administrator: pg_restore loads it
               into PostgreSQL.
database.sql   The same as plain SQL text.
tables/        Each table as a CSV file, which opens in Excel or Google Sheets.
files/         Every file members uploaded, by where it was stored: injury
               documents, training certificates, check receipts, session
               plans and club logos.
manifest.txt   How many rows each table has and how many files there are.
SHA256SUMS     A checksum of every file. "sha256sum -c SHA256SUMS" (Linux) or
               "shasum -a 256 -c SHA256SUMS" (Mac) checks nothing is missing
               or changed.

It holds children's records, health information and safeguarding records.
Keep it somewhere only the people who need it can open, and keep it for the
periods your club's policies set.
TEXT

(cd "$out" && find . -type f ! -name SHA256SUMS -print0 | sort -z | xargs -0 sha256sum >SHA256SUMS)
echo "Done: $out"
cat "$out/manifest.txt"
