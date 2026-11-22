#!/usr/bin/env bash
# Tests supabase/demo-club.sql, the "Reset demo club" script, on a local
# Postgres with the app's migrations: it makes all 20 demo accounts with the
# shared password, makes the club the Perth Pumpkins (never a real club's
# name, colours or logo), puts back what reviewers and testers change, never
# prints the password, and refuses a database that looks live or a missing
# password.
# Run by the "Tests" workflow, with the same Postgres settings as
# run-sql-tests.sh.
set -uo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
db=firstpass_demo_club_test
password='demo-test-password-1234'
log=$(mktemp)
trap 'rm -f "$log"; psql -X -q -d postgres -c "drop database if exists $db" >/dev/null 2>&1' EXIT
export PGOPTIONS="${PGOPTIONS:-} -c client_min_messages=warning"
failed=0

q() { psql -X -qAt -v ON_ERROR_STOP=1 -d "$db" -c "$1"; }
logo='demo-club-logo-0123456789ab.png'
# reset <password> [the logo's name]: without a name, as on a local database.
reset() {
  psql -X -q -v ON_ERROR_STOP=1 -d "$db" -v demo_password="$1" ${2:+-v demo_logo="$2"} \
    -f "$root/supabase/demo-club.sql" >"$log" 2>&1
}
look() { q "select concat_ws('|', club_name, short_name, background_colour, text_colour, hero_colour, coalesce(logo_path, 'no logo')) from public.club_settings where id"; }
check() {
  local label=$1 got=$2 want=$3
  if [ "$got" = "$want" ]; then echo "PASS $label"; else echo "FAIL $label (got '$got', want '$want')"; failed=1; fi
}
# The answer the app would get, signed in as a demo account.
as() { q "set request.jwt.claim.sub = '$1'; $2" | tail -n 1; }
id() { printf 'de000000-0000-4000-8000-0000000000%02d' "$1"; }

# A database like the test project: the stubs, the migrations, and the parts
# of Supabase's auth schema that password sign-in uses.
psql -X -q -d postgres -c "drop database if exists $db" -c "create database $db" >/dev/null || exit 1
psql -X -q -v ON_ERROR_STOP=1 -d "$db" -f "$root/supabase/tests/setup/supabase-stubs.sql" >"$log" 2>&1 || { cat "$log"; exit 1; }
for m in "$root"/supabase/migrations/*.sql; do
  sed 's/^create extension if not exists pg_net;//' "$m" | psql -X -q -v ON_ERROR_STOP=1 -d "$db" >"$log" 2>&1 || { cat "$log"; exit 1; }
done
q "create unique index on auth.users (email);
   create table auth.identities (
     id uuid primary key default gen_random_uuid(), provider_id text not null,
     user_id uuid not null references auth.users on delete cascade, identity_data jsonb not null,
     provider text not null, last_sign_in_at timestamptz, created_at timestamptz, updated_at timestamptz,
     unique (provider_id, provider));" || exit 1

# Refused without a usable password, or anywhere but the test project,
# changing nothing.
reset ''
check 'no password is refused' "$?:$(grep -c 'Set the demo password' "$log")" '3:1'
reset 'short'
check 'a short password is refused' "$(grep -c 'at least 12 characters' "$log")" 1
check 'nothing is made when refused' "$(q "select count(*) from auth.users")" 0
reset "$password"
check 'an empty database is refused: it is not known to be the test project' \
  "$?:$(grep -c 'Run supabase/test-data.sql on the test project first; never run this on the live database' "$log")" '3:1'
check 'nothing is made on an empty database' "$(q "select count(*) from auth.users")" 0

# The test project holds test-data.sql's sample people (which need a squad).
q "insert into public.teams (name, kind, season, sort_order) values ('Open Squad', 'squad', extract(year from now())::int, 50)" >/dev/null
psql -X -q -v ON_ERROR_STOP=1 -d "$db" -f "$root/supabase/test-data.sql" >"$log" 2>&1 || { cat "$log"; exit 1; }

# The test project began as a copy of a real club, with that club's look.
real_club="update public.club_settings set club_name = 'West Coast Thunder', short_name = 'Thunder',
  background_colour = '#000000', text_colour = '#FFFFFF', hero_colour = '#02CCFE', logo_path = 'logo-1759900000000.png' where id"
q "$real_club" >/dev/null
reset 'short' "$logo"
check "a refused run leaves the club's look alone" "$(look)" 'West Coast Thunder|Thunder|#000000|#FFFFFF|#02CCFE|logo-1759900000000.png'

# The first reset.
reset "$password" "$logo"
check 'the reset runs' "$?" 0
check 'the club is the Perth Pumpkins: its name, colours and logo, and nothing of the real club' \
  "$(look)" "Perth Pumpkins|Pumpkins|#0F2A1B|#FFFFFF|#FF7518|$logo"
check 'the app gets that look for a signed-in demo member' \
  "$(as "$(id 8)" "select concat_ws('|', club_name, short_name, background_colour, text_colour, hero_colour, logo_path) from public.club_profile()")" \
  "Perth Pumpkins|Pumpkins|#0F2A1B|#FFFFFF|#FF7518|$logo"
check 'the reset says which club it made' "$(grep -c 'The demo club is reset: the Perth Pumpkins' "$log")" 1
check 'the password is never printed' "$(grep -c -- "$password" "$log")" 0
check '20 demo accounts' "$(q "select count(*) from auth.users where email like '%@demo.firstpass.example'")" 20
check 'every account signs in with the shared password' \
  "$(q "select count(*) from auth.users where encrypted_password = extensions.crypt('$password', encrypted_password)")" 20
check 'every account has an email identity' "$(q "select count(*) from auth.identities where provider = 'email'")" 20
check 'every demo address is confirmed' "$(q "select count(*) from auth.users where email like '%@demo.firstpass.example' and email_confirmed_at is null")" 0
check '18 approved demo members' "$(q "select count(*) from public.profiles where email like '%@demo.firstpass.example' and status = 'approved'")" 18
check 'newcomer and newparent have signed in but not asked to join' \
  "$(q "select string_agg(email, ',' order by email) from public.profiles where status = 'pending' and requested_role is null and join_requested_at is null")" \
  'newcomer@demo.firstpass.example,newparent@demo.firstpass.example'
check 'committee is the Secretary' "$(q "select title from public.profiles where id = '$(id 2)'")" Secretary
check 'headphysio is the Head Physio' "$(q "select head_physio from public.profiles where id = '$(id 7)'")" t
check 'athlete16 is under 18 with two verified guardians' \
  "$(q "select count(*) from public.guardianships g join public.profiles p on p.id = g.guardian_id where g.athlete_id = '$(id 9)' and p.verified_at is not null")" 2
check 'athlete16 is not locked' "$(q "select public.is_locked_child('$(id 9)')")" f
check 'locked15 is locked' "$(q "select public.is_locked_child('$(id 10)')")" t
check 'locked15 has a fresh link code' \
  "$(q "select count(*) from public.guardian_link_codes where athlete_id = '$(id 10)' and used_at is null and replaced_at is null and expires_at > now()")" 1
check "lapsedcoach's check expired yesterday" "$(q "select wwcc_expires_on = public.club_today() - 1 from public.profiles where id = '$(id 13)'")" t
check 'headcoach is Head Coach of the 20 & Under team' \
  "$(q "select m.coach_title from public.team_members m join public.teams t on t.id = m.team_id where m.profile_id = '$(id 3)' and t.name = '20 & Under'")" head_coach
check 'coachparent coaches Open A and is a guardian' \
  "$(q "select role || ':' || extra_roles::text from public.profiles where id = '$(id 14)'")" 'coach:{guardian}'
check 'helper is a temporary helper for Carnival this week' \
  "$(q "select role || ':' || volunteer_task || ':' || (volunteer_until - volunteer_from) from public.profiles where id = '$(id 16)'")" 'volunteer:Carnival:7'
check 'helper has accepted the policies' "$(q "select count(*) from public.policy_acknowledgements where profile_id = '$(id 16)'")" 1
check 'the 20 & Under team is the only pilot team' "$(q "select string_agg(name, ',') from public.teams where pilot")" '20 & Under'
check 'Messages and Calendar are pilot only' "$(q "select pilot_features from public.club_settings where id")" '{"calendar": true, "messages": true}'
check 'every other feature is off' "$(q "select count(*) from public.club_settings s, jsonb_each(s.features) f where s.id and f.value = 'true'")" 2
check 'athlete19 in the pilot sees Messages' "$(as "$(id 8)" "select public.member_features() ->> 'messages'")" true
check 'guardian of a pilot athlete sees Messages' "$(as "$(id 11)" "select public.member_features() ->> 'messages'")" true
check 'openathlete outside the pilot sees no Messages' "$(as "$(id 12)" "select public.member_features() ->> 'messages'")" false
check 'a game is coming up for each team' "$(q "select count(*) from public.fixtures where playhq_game_id like 'demo-game-%' and starts_at > now()")" 2

# What testers and reviewers do, then a second reset. Each step must work, or
# the checks after the reset prove nothing.
setup() { q "$1" >/dev/null || { echo "FAIL setting up: $1"; failed=1; }; }
setup "insert into public.messages (sender_id, sender_name, body, audience) values ('$(id 3)', 'Harley Headcoach', 'Training moved', 'club')"
setup "update auth.users set encrypted_password = extensions.crypt('changed-by-a-reviewer', extensions.gen_salt('bf')) where id = '$(id 1)'"
setup "update public.profiles set requested_role = 'athlete', join_requested_at = now() where id = '$(id 20)'"
setup "delete from auth.users where id = '$(id 19)'"
setup "insert into public.guardianships (guardian_id, athlete_id) values ('$(id 11)', '$(id 10)')"
setup "update public.teams set pilot = true where name = 'Open A'; update public.club_settings set features = features || '{\"injuries\": true}' where id"
setup "insert into auth.users (id, email) values ('11111111-1111-4111-8111-111111111111', 'squatter@demo.firstpass.example')"
setup "delete from auth.users where id = '$(id 4)'; insert into auth.users (id, email) values ('22222222-2222-4222-8222-222222222222', 'asstcoach@demo.firstpass.example')"
setup "$real_club"

check 'a demo message was sent before the reset' "$(q "select count(*) from public.messages where sender_id = '$(id 3)'")" 1
reset "$password" "$logo"
check 'the second reset runs' "$?" 0
check "a look changed in Club settings goes back to the Perth Pumpkins'" \
  "$(look)" "Perth Pumpkins|Pumpkins|#0F2A1B|#FFFFFF|#FF7518|$logo"
check 'demo messages are gone' "$(q "select count(*) from public.messages where sender_id = '$(id 3)'")" 0
check 'a changed password is put back' \
  "$(q "select encrypted_password = extensions.crypt('$password', encrypted_password) from auth.users where id = '$(id 1)'")" t
check 'a deleted newcomer is back, signed in with no join request' \
  "$(q "select status || ':' || coalesce(requested_role::text, '-') || ':' || coalesce(join_requested_at::text, '-') from public.profiles where id = '$(id 19)'")" 'pending:-:-'
check "newparent's join request is cleared" "$(q "select requested_role is null from public.profiles where id = '$(id 20)'")" t
check 'locked15 is locked again' "$(q "select public.is_locked_child('$(id 10)')")" t
check 'the pilot is back to the 20 & Under team' "$(q "select string_agg(name, ',') from public.teams where pilot")" '20 & Under'
check 'Injuries is off again' "$(q "select features ->> 'injuries' from public.club_settings where id")" false
check 'someone else holding a demo address loses it' \
  "$(q "select id from auth.users where email = 'asstcoach@demo.firstpass.example'")" "$(id 4)"
check 'other addresses on the demo domain are left alone' \
  "$(q "select count(*) from auth.users where email = 'squatter@demo.firstpass.example'")" 1
check 'still 20 demo accounts, one place each' \
  "$(q "select count(*) from public.team_members m where m.profile_id::text like 'de000000-%'")" 22

# The test project's own sample data still loads beside the demo club, and
# leaves the demo accounts' roles alone.
psql -X -q -v ON_ERROR_STOP=1 -d "$db" -f "$root/supabase/test-data.sql" >"$log" 2>&1
check 'test-data.sql still runs beside the demo club' "$?" 0
check 'and makes no demo account an admin' \
  "$(q "select count(*) from public.profiles where email like '%@demo.firstpass.example' and role = 'admin'")" 1
setup "$real_club"
reset "$password"
check 'the demo club resets after test-data.sql' "$?" 0
check "a reset with no logo named, as on a local database, shows the app's own mark, never the real club's logo" \
  "$(look)" 'Perth Pumpkins|Pumpkins|#0F2A1B|#FFFFFF|#FF7518|no logo'

# Real people signing in to the test project don't stop it.
q "insert into auth.users (email) select 'tester' || n || '@gmail.com' from generate_series(1, 10) n" >/dev/null
check 'ten real accounts sit beside the sample people' \
  "$(q "select count(*) from public.profiles where email like '%@gmail.com'")" 10
reset "$password"
check 'the reset still runs with ten real accounts on the test project' "$?" 0

# A database with members but none of the sample people, like the live club:
# refused, nothing changed.
q "delete from auth.users where email like '%@example.com'" >/dev/null
q "update auth.users set encrypted_password = 'unchanged' where id = '$(id 1)'" >/dev/null
reset "$password"
check 'a database with real members and no sample people is refused' \
  "$?:$(grep -c 'never run this on the live database' "$log")" '3:1'
check 'nothing changes on a refused run' "$(q "select encrypted_password from auth.users where id = '$(id 1)'")" unchanged

# The workflow: by hand only, the test project's secrets only, and it stops
# when the test project id is the live one.
wf="$root/.github/workflows/reset-demo-club.yml"
check 'the workflow runs by hand only' \
  "$(awk '/^on:/{on=1;next} on&&/^[^ ]/{on=0} on&&/^  [a-z_]+:/{print $1}' "$wf" | tr -d '\n')" 'workflow_dispatch:'
check 'the workflow never reads the live database password' \
  "$(grep -c 'secrets.SUPABASE_DB_PASSWORD' "$wf")" 0
check 'the workflow links the test project' "$(grep -c 'SUPABASE_PROJECT_ID: ${{ secrets.SUPABASE_TEST_PROJECT_ID }}' "$wf")" 1
check 'the workflow refuses the live project id' "$(grep -c '"$SUPABASE_PROJECT_ID" = "$LIVE_PROJECT_ID"' "$wf")" 1
check "the workflow names the club's logo for the reset" \
  "$(grep -c 'logo=$(scripts/demo-club-logo.sh name)' "$wf"):$(grep -c -- '-v demo_logo="$logo"' "$wf")" '1:1'
check 'the workflow uploads the logo after the reset and the sign-in' \
  "$(awk '/^    steps:/{on=1} on' "$wf" | grep -e '-f supabase/demo-club.sql' -e 'run: scripts/check-demo-sign-in.sh' -e 'run: scripts/demo-club-logo.sh upload' | sed -E 's/.*(demo-club.sql|check-demo-sign-in.sh|logo.sh upload).*/\1/' | tr '\n' ' ')" \
  'demo-club.sql check-demo-sign-in.sh logo.sh upload '

[ $failed -eq 0 ]
