#!/usr/bin/env bash
# Makes the one-time setup code for a new club's first admin, so nobody has
# to edit the club's database by hand (Matt, 18 November 2026).
# docs/new-club-setup.md, "Make the first admin", says when to run it.
#
#   CLUB_DB_URL=postgresql://... scripts/first-admin-code.sh [days]
#
# CLUB_DB_URL  the club project's database connection string (session pooler,
#              with the database password), from the Supabase dashboard under
#              Connect.
# days         how long the code lasts: 1 to 30, 7 if left out.
#
# Prints the code once. Only its hash is kept, so it can't be read back:
# running this again makes a new code and cancels the last. Give the code to
# the person setting the club up, by a private message. They sign in to the
# club in the app and enter it on "Request to join". It works once, and only
# while the club has no admin: once a club has one, this refuses, and that
# admin approves every other admin from Members.
set -euo pipefail

usage() { echo "Usage: CLUB_DB_URL=... scripts/first-admin-code.sh [days]" >&2; exit 2; }
[ $# -le 1 ] || usage
days=${1:-7}
[[ "$days" =~ ^[0-9]{1,2}$ ]] || usage
[ -n "${CLUB_DB_URL:-}" ] || { echo "Set CLUB_DB_URL to the club's database connection string." >&2; exit 2; }

if ! code=$(psql -X -q -At -v ON_ERROR_STOP=1 -d "$CLUB_DB_URL" \
  -c "select public.issue_first_admin_code($days)" 2>&1); then
  # The database's own reason, such as the club already having an admin.
  echo "No setup code was made: ${code#*ERROR:  }" >&2
  exit 1
fi
if ! [[ "$code" =~ ^[2-9A-HJKMNP-Z]{4}(-[2-9A-HJKMNP-Z]{4}){2}$ ]]; then
  echo "No setup code was made: the database answered something else." >&2
  exit 1
fi

cat <<MSG
Setup code: $code

It lasts $days days and works once. Send it privately to the person setting the
club up. They open FirstPass HQ, enter the club's code, sign in, tap
"Request to join", and enter their name and this code under
"Setting up this club?".
MSG
