#!/usr/bin/env bash
# Signs in once as admin@demo.firstpass.example through the test project's Auth
# API, the way the app's demo club does, so a reset proves a demo account
# really signs in before any build does. Run by the "Reset demo club"
# workflow after the reset; see docs/environments.md, "The demo club".
#
# Needs SUPABASE_PROJECT_ID (the TEST project), SUPABASE_ACCESS_TOKEN and
# DEMO_PASSWORD. It reads the project's public key from the Supabase
# Management API and never prints the key, the password or the answer.
set -uo pipefail

ref=${SUPABASE_PROJECT_ID:?}
email=admin@demo.firstpass.example
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
fail() { echo "::error::$1"; exit 1; }

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
if [ "$code" = 200 ] && jq -e '.access_token | strings' "$work/answer" >/dev/null 2>&1; then
  echo "$email signed in to the test project with the demo password."
  exit 0
fi
case $(jq -r '.error_code // .code // empty' "$work/answer" 2>/dev/null) in
  email_provider_disabled)
    fail "The Email provider is off in the test project. Turn it on (Authentication > Sign In / Providers > Email) and run this again." ;;
  invalid_credentials)
    fail "$email didn't sign in with DEMO_PASSWORD, though the reset set it. Run this again; if it fails twice, the reset didn't reach the project the app uses." ;;
  email_not_confirmed)
    fail "$email isn't confirmed. Run this again." ;;
  *)
    fail "The demo sign-in failed (HTTP $code). If the test project is paused, restore it in the Supabase dashboard and run this again." ;;
esac
