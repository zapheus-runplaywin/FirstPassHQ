#!/usr/bin/env bash
# Gives the demo club (the Perth Pumpkins) its logo on the TEST project. Run
# by the "Reset demo club" workflow; see docs/environments.md, "The demo club".
#
#   scripts/demo-club-logo.sh name     prints the name the logo is stored under
#   scripts/demo-club-logo.sh upload   puts the logo in the test project
#
# The logo is supabase/demo-club-logo.png (drawn in demo-club-logo.svg). A
# club's logo is a file in its project's public club-branding bucket, named in
# its Club settings. The name here is made from the file's contents, so a
# changed logo gets a new name and phones never show an old copy. The reset
# (supabase/demo-club.sql) saves that name; "upload" then makes sure the
# bucket serves this very file.
#
# "upload" needs SUPABASE_PROJECT_ID (the TEST project) and, only when the
# logo isn't there yet, SUPABASE_ACCESS_TOKEN and DEMO_PASSWORD: it signs in
# as admin@demo.firstpass.example and uploads the way the app's Club settings
# screen does, so it needs no key with more access than an admin has. It never
# prints the key, the password or the sign-in.
set -uo pipefail

root=$(cd "$(dirname "$0")/.." && pwd)
logo=${DEMO_LOGO_FILE:-$root/supabase/demo-club-logo.png}
fail() { echo "::error::$1"; exit 1; }

[ -s "$logo" ] || fail "The demo club's logo is missing: $logo"
sum=$({ sha256sum "$logo" 2>/dev/null || shasum -a 256 "$logo"; } | cut -c1-12)
[ ${#sum} -eq 12 ] || fail "Couldn't work out the logo's name."
name="demo-club-logo-$sum.png"

case ${1:-} in
  name) echo "$name"; exit 0 ;;
  upload) ;;
  *) echo "Usage: $0 name|upload" >&2; exit 2 ;;
esac

ref=${SUPABASE_PROJECT_ID:?}
email=admin@demo.firstpass.example
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
public="https://$ref.supabase.co/storage/v1/object/public/club-branding/$name"

# Whether the bucket serves this very file under the logo's name: yes, no
# (nothing there) or different.
served() {
  local code
  code=$(curl -sS -o "$work/served" -w '%{http_code}' "$public") || code=000
  if [ "$code" != 200 ]; then echo no; elif cmp -s "$work/served" "$logo"; then echo yes; else echo different; fi
}

case $(served) in
  yes) echo "The demo club's logo is already in the test project ($name)."; exit 0 ;;
  different) fail "The test project has a different file under the logo's name ($name). Remove it from the club-branding bucket in the Supabase dashboard and run this again." ;;
esac

: "${SUPABASE_ACCESS_TOKEN:?}" "${DEMO_PASSWORD:?}"

# The headers go in files, so neither the token nor the key is on a command line.
printf 'Authorization: Bearer %s\n' "$SUPABASE_ACCESS_TOKEN" >"$work/token"
code=$(curl -sS -o "$work/keys" -w '%{http_code}' -H @"$work/token" \
  "https://api.supabase.com/v1/projects/$ref/api-keys") || code=000
[ "$code" = 200 ] || fail "Couldn't read the test project's public key (HTTP $code). Check SUPABASE_TEST_ACCESS_TOKEN can read the test project's API keys."
# The legacy anon key, as the app uses, or else a publishable key.
key=$(jq -r 'first(.[] | select(.name == "anon" and (.api_key // "") != "") | .api_key)
  // first(.[] | select(.type == "publishable" and (.api_key // "") != "") | .api_key) // empty' "$work/keys" 2>/dev/null)
[ -n "$key" ] || fail "The test project has no anon or publishable key to sign in with."
[ -n "${GITHUB_ACTIONS:-}" ] && echo "::add-mask::$key"
printf 'apikey: %s\nContent-Type: application/json\n' "$key" >"$work/headers"

code=$(jq -n --arg email "$email" --arg password "$DEMO_PASSWORD" '{email: $email, password: $password}' |
  curl -sS -o "$work/answer" -w '%{http_code}' -H @"$work/headers" --data @- \
    "https://$ref.supabase.co/auth/v1/token?grant_type=password") || code=000
session=$(jq -r '.access_token | strings' "$work/answer" 2>/dev/null)
if [ "$code" != 200 ] || [ -z "$session" ]; then
  fail "$email didn't sign in to upload the logo (HTTP $code). Run \"Reset demo club\" again; its sign-in step says what is wrong."
fi
[ -n "${GITHUB_ACTIONS:-}" ] && echo "::add-mask::$session"

# Uploaded as the demo club's admin, which the bucket allows and nobody else.
printf 'apikey: %s\nAuthorization: Bearer %s\nContent-Type: image/png\n' "$key" "$session" >"$work/upload-headers"
code=$(curl -sS -o "$work/uploaded" -w '%{http_code}' -H @"$work/upload-headers" --data-binary @"$logo" \
  "https://$ref.supabase.co/storage/v1/object/club-branding/$name") || code=000
if [ "$code" != 200 ]; then
  why=$(jq -r '[.error, .message] | map(strings) | join(": ")' "$work/uploaded" 2>/dev/null)
  # Someone else put it there a moment ago: fine, as long as it's this file.
  if ! grep -qi -e duplicate -e 'already exists' "$work/uploaded" 2>/dev/null; then
    fail "The logo didn't upload (HTTP $code${why:+, $why}). Only an admin can upload a club logo: check the reset made $email an admin, and that the test project has every migration."
  fi
fi

# The file is there as soon as the upload answers; allow a moment all the same.
for wait in 0 ${DEMO_LOGO_WAIT:-2} ${DEMO_LOGO_WAIT:-2}; do
  sleep "$wait"
  if [ "$(served)" = yes ]; then
    echo "The demo club's logo is in the test project ($name)."
    exit 0
  fi
done
fail "The logo uploaded, but the test project doesn't serve it at its public address. Check the club-branding bucket is public, then run this again."
