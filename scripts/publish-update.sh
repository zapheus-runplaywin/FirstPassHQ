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

# Values already in the environment win over .env, so the build uses these.
rm -rf dist
EXPO_PUBLIC_SUPABASE_URL=$url EXPO_PUBLIC_SUPABASE_ANON_KEY=$key \
  npx expo export --platform all --clear --output-dir dist

local_url=$(sed -n 's/^EXPO_PUBLIC_SUPABASE_URL=//p' .env 2>/dev/null | tr -d "\"'" || true)
if ! grep -rqF "$url" dist/_expo/static/js; then
  echo "The update doesn't use $url, so it wasn't published."
  exit 1
fi
if [ -n "$local_url" ] && [ "$local_url" != "$url" ] && grep -rqF "$local_url" dist/_expo/static/js; then
  echo "The update still uses your .env address ($local_url), so it wasn't published."
  exit 1
fi

echo "Publishing to the $channel channel, using $url"
eas update --skip-bundler --channel "$channel" --environment "$channel" --message "$message"
