#!/usr/bin/env bash
# Publishes an over-the-air update to the installed apps on one channel,
# built with that channel's Supabase project. See docs/environments.md.
#
#   scripts/publish-update.sh preview "Fix the calendar colours"
#   scripts/publish-update.sh production "Fix the calendar colours"
#   scripts/publish-update.sh production "Fix the calendar colours" android
#
# The "OTA update" GitHub workflow runs this too (docs/environments.md,
# "Publishing an update from GitHub").
#
# The Supabase address is built into the update, and your own .env points at
# the test project. So this builds the update with the EAS environment's
# values, checks the result really uses them, and only then publishes it.
#
# An update only reaches installed apps whose native code matches it (the
# fingerprint runtime version in app.json). So it first checks that the channel
# has a finished build with this code's runtime version on each platform, and
# stops if one hasn't: that change needs a new build, not an update.
#
# CHECK_ONLY=1 does every check and builds the update, but doesn't publish it.
# EAS_CLI picks the EAS CLI release (the workflow pins one).
set -euo pipefail

channel=${1:-}
message=${2:-}
platform=${3:-all}
if [[ "$channel" != "preview" && "$channel" != "production" ]] || [ -z "$message" ] \
  || [[ "$platform" != "all" && "$platform" != "android" && "$platform" != "ios" ]]; then
  echo 'Usage: scripts/publish-update.sh preview|production "What changed" [all|android|ios]'
  exit 1
fi

eas() { npx "${EAS_CLI:-eas-cli@latest}" "$@"; }

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

eas env:pull --environment "$channel" --path "$work/env" --non-interactive >/dev/null
url=$(sed -n 's/^EXPO_PUBLIC_SUPABASE_URL=//p' "$work/env" | tr -d "\"'")
key=$(sed -n 's/^EXPO_PUBLIC_SUPABASE_ANON_KEY=//p' "$work/env" | tr -d "\"'")
if [ -z "$url" ] || [ -z "$key" ]; then
  echo "The EAS '$channel' environment has no EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY."
  exit 1
fi

# Is there an installed app this update can reach? The runtime version is
# worked out the same way "eas update" works it out, from this code.
if [ "$platform" = all ]; then platforms=(android ios); else platforms=("$platform"); fi
for p in "${platforms[@]}"; do
  runtime=$(npx expo-updates runtimeversion:resolve --platform "$p" \
    | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).runtimeVersion||""))')
  if [ -z "$runtime" ]; then
    echo "Couldn't work out the $p runtime version, so nothing was published."
    exit 1
  fi
  builds=$(eas build:list --platform "$p" --channel "$channel" --runtime-version "$runtime" \
    --status finished --limit 1 --json --non-interactive \
    | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const b=JSON.parse(s||"[]");console.log(Array.isArray(b)?b.length:0)})')
  if [ "$builds" = 0 ]; then
    echo "No finished $p build on the $channel channel has runtime version $runtime, so nothing was published."
    echo "This code changes the app's native side (a new native library, app.json or a package upgrade),"
    echo "so installed apps can't run it. Make a new build instead (Actions > Beta build)."
    exit 1
  fi
  echo "The $channel channel has a $p build with runtime version $runtime."
done

# The demo club (docs/environments.md, "The demo club") comes from the same EAS
# environment, so an update keeps it in builds that have it and leaves it out
# of builds that don't. It's the test project, never the live one.
demo_url=$(sed -n 's/^EXPO_PUBLIC_DEMO_CLUB_URL=//p' "$work/env" | tr -d "\"'")
demo_key=$(sed -n 's/^EXPO_PUBLIC_DEMO_CLUB_ANON_KEY=//p' "$work/env" | tr -d "\"'")
if [ -n "$demo_url" ] && [ "$demo_url" = "$url" ]; then
  echo "The EAS '$channel' demo club points at the live project, so nothing was published."
  exit 1
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
  EXPO_PUBLIC_TEST_CLUB_2_URL= EXPO_PUBLIC_TEST_CLUB_2_ANON_KEY= \
  EXPO_PUBLIC_TEST_CLUB_3_URL= EXPO_PUBLIC_TEST_CLUB_3_ANON_KEY= \
  npx expo export --platform "$platform" --clear --output-dir dist

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

if [ "${CHECK_ONLY:-}" = 1 ]; then
  echo "Every check passed. CHECK_ONLY is set, so nothing was published to the $channel channel."
  exit 0
fi

echo "Publishing to the $channel channel ($platform), using $url"
eas update --skip-bundler --channel "$channel" --environment "$channel" --platform "$platform" \
  --message "$message" --non-interactive
