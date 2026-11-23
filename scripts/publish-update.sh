#!/usr/bin/env bash
# Publishes an over-the-air update to the installed apps on one channel,
# built with that channel's Supabase project. See docs/environments.md.
#
#   scripts/publish-update.sh preview "Fix the calendar colours"
#   scripts/publish-update.sh production "Fix the calendar colours"
#
# The Supabase address is built into the update, and your own .env points at
# the test project. So this builds the update with the EAS environment's
# values, checks the result really uses them, and only then publishes it.
set -euo pipefail

channel=${1:-}
message=${2:-}
if [[ "$channel" != "preview" && "$channel" != "production" ]] || [ -z "$message" ]; then
  echo 'Usage: scripts/publish-update.sh preview|production "What changed"'
  exit 1
fi

eas() { npx eas-cli@latest "$@"; }

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

eas env:pull --environment "$channel" --path "$work/env" --non-interactive >/dev/null
url=$(sed -n 's/^EXPO_PUBLIC_SUPABASE_URL=//p' "$work/env" | tr -d "\"'")
key=$(sed -n 's/^EXPO_PUBLIC_SUPABASE_ANON_KEY=//p' "$work/env" | tr -d "\"'")
if [ -z "$url" ] || [ -z "$key" ]; then
  echo "The EAS '$channel' environment has no EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY."
  exit 1
fi

# The demo club (docs/environments.md, "The demo club") comes from the same EAS
# environment, so an update keeps it in builds that have it and leaves it out
# of builds that don't. It's the test project, never the live one.
demo_url=$(sed -n 's/^EXPO_PUBLIC_DEMO_CLUB_URL=//p' "$work/env" | tr -d "\"'")
demo_key=$(sed -n 's/^EXPO_PUBLIC_DEMO_CLUB_ANON_KEY=//p' "$work/env" | tr -d "\"'")
if [ -n "$demo_url" ] && [ "$demo_url" = "$url" ]; then
  echo "The EAS '$channel' demo club points at the live project, so nothing was published."
  exit 1
fi

# Crash reports (src/lib/crash-reports.ts): the Sentry address is built into
# the update from the same EAS environment, so an update keeps reports on in
# builds that have them. Both settings or neither, as for a build; the token
# must be "Sensitive" on expo.dev (not "Secret") so it can be pulled here.
sentry_dsn=$(sed -n 's/^EXPO_PUBLIC_SENTRY_DSN=//p' "$work/env" | tr -d "\"'")
sentry_token=$(sed -n 's/^SENTRY_AUTH_TOKEN=//p' "$work/env" | tr -d "\"'")
if [ -n "$sentry_dsn" ] || [ -n "$sentry_token" ]; then
  if ! problems=$(EXPO_PUBLIC_SENTRY_DSN=$sentry_dsn SENTRY_AUTH_TOKEN=$sentry_token node -e '
    const { crashReportSettings } = require(process.argv[1]);
    process.exit(crashReportSettings(process.env).on ? 0 : 1);' "$(cd "$(dirname "$0")" && pwd)/check-build-settings.js"); then
    echo "The EAS '$channel' crash report settings aren't both there and sound, so nothing was published."
    echo "If SENTRY_AUTH_TOKEN is set, make it Sensitive rather than Secret so it can be read here."
    echo "See docs/beta-builds.md, \"Crash reports\"."
    exit 1
  fi
fi

# "Build N" (or the commit) on the app's opening screen, Find your club, sign-in
# and home, for the code in this update (docs/beta-builds.md, "Which build is
# this?"). The committed file goes back afterwards. Without git history the
# update still goes out, without a build number.
info=src/constants/build-info.json
if [ -f "$info" ]; then
  cp "$info" "$work/build-info.json"
  trap 'cp "$work/build-info.json" "$info"; rm -rf "$work"' EXIT
fi
git fetch --quiet origin main 2>/dev/null || echo "Couldn't fetch main, so the build number may be missing."
node "$(dirname "$0")/write-build-info.js" || echo "So the update shows no build number."

# Values already in the environment win over .env, so the build uses these.
# The extra test clubs in .env are blanked, so they're never in an update.
rm -rf dist
EXPO_PUBLIC_SUPABASE_URL=$url EXPO_PUBLIC_SUPABASE_ANON_KEY=$key \
  EXPO_PUBLIC_DEMO_CLUB_URL=$demo_url EXPO_PUBLIC_DEMO_CLUB_ANON_KEY=$demo_key \
  EXPO_PUBLIC_SENTRY_DSN=$sentry_dsn \
  EXPO_PUBLIC_TEST_CLUB_2_URL= EXPO_PUBLIC_TEST_CLUB_2_ANON_KEY= \
  EXPO_PUBLIC_TEST_CLUB_3_URL= EXPO_PUBLIC_TEST_CLUB_3_ANON_KEY= \
  npx expo export --platform all --clear --output-dir dist

local_url=$(sed -n 's/^EXPO_PUBLIC_SUPABASE_URL=//p' .env 2>/dev/null | tr -d "\"'" || true)
if ! grep -rqF "$url" dist/_expo/static/js; then
  echo "The update doesn't use $url, so it wasn't published."
  exit 1
fi
# Your .env address is the test project, which the demo club may use too.
if [ -n "$local_url" ] && [ "$local_url" != "$url" ] && [ "$local_url" != "$demo_url" ] && grep -rqF "$local_url" dist/_expo/static/js; then
  echo "The update still uses your .env address ($local_url), so it wasn't published."
  exit 1
fi
for n in 2 3; do
  test_url=$(sed -n "s/^EXPO_PUBLIC_TEST_CLUB_${n}_URL=//p" .env 2>/dev/null | tr -d "\"'" || true)
  if [ -n "$test_url" ] && grep -rqF "$test_url" dist/_expo/static/js; then
    echo "The update includes test club $n ($test_url), so it wasn't published."
    exit 1
  fi
done

echo "Publishing to the $channel channel, using $url"
eas update --skip-bundler --channel "$channel" --environment "$channel" --message "$message"

# The update's source maps, so its crash reports point at our code. The update
# is out already, so a failed upload only warns.
if [ -n "$sentry_dsn" ]; then
  SENTRY_AUTH_TOKEN=$sentry_token npx sentry-expo-upload-sourcemaps dist \
    || echo "The source maps didn't reach Sentry, so this update's crash reports won't show our code's lines."
fi
